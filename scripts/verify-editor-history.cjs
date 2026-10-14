const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9227);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('工作台未运行');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.onopen = resolve);
  let serial = 0; const pending = new Map();
  ws.onmessage = event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { pending.get(data.id)(data.result); pending.delete(data.id); } };
  const send = (method, params) => new Promise(resolve => { const id = ++serial; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const id = await evalJs('(async()=>{const x=await window.workbench.create("note");return x.id})()');
  const file = path.join(process.env.WORKBENCH_DATA_DIR || path.join(__dirname, '..', 'data'), 'items', `${id}.json`);
  try {
    await send('Page.reload', { ignoreCache: true });
    await new Promise(resolve => setTimeout(resolve, 1200));
    await evalJs('(()=>{const e=document.querySelector("#draft");e.focus();e.value="甲";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"甲"}));e.value="甲乙";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"乙"}));return e.value})()');
    if (await evalJs('document.querySelector("#undoAi").disabled')) throw new Error('手动输入后无法撤销');
    await evalJs('undoAi()');
    if (await evalJs('document.querySelector("#draft").value') !== '') throw new Error('撤销手动输入失败');
    await evalJs('redoAi()');
    if (await evalJs('document.querySelector("#draft").value') !== '甲乙') throw new Error('恢复手动输入失败');
    await evalJs('(()=>{const e=document.querySelector("#draft");e.focus();e.setSelectionRange(2,2);repeatAi();return e.value})()');
    if (await evalJs('document.querySelector("#draft").value') !== '甲乙甲乙') throw new Error('重复手动输入失败');
    await evalJs('(()=>{const e=document.querySelector("#draft");e.focus();e.setSelectionRange(e.value.length,e.value.length);e.value+="丙";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertFromPaste",data:"丙"}));return e.value})()');
    await evalJs('undoAi()');
    if (await evalJs('document.querySelector("#draft").value') !== '甲乙甲乙') throw new Error('撤销粘贴失败');
    await evalJs('redoAi()');
    if (await evalJs('document.querySelector("#draft").value') !== '甲乙甲乙丙') throw new Error('恢复粘贴失败');
    await evalJs('(()=>{const e=document.querySelector("#draft");e.focus();e.setSelectionRange(e.value.length,e.value.length);repeatAi();return e.value})()');
    const final = await evalJs('document.querySelector("#draft").value');
    if (final !== '甲乙甲乙丙丙') throw new Error(`重复粘贴失败：${final}`);
    console.log(JSON.stringify({ typingUndoRedo: true, typingRepeat: true, pasteUndoRedo: true, pasteRepeat: true, final }));
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await send('Page.reload', { ignoreCache: true });
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
