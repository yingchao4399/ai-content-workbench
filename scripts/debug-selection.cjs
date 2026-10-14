const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const pages = await (await fetch('http://127.0.0.1:9227/json')).json();
  const page = pages.find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('工作台页面未运行');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.onopen = resolve);
  let serial = 0; const waiting = new Map();
  ws.onmessage = event => { const data = JSON.parse(event.data); if (waiting.has(data.id)) { waiting.get(data.id)(data.result); waiting.delete(data.id); } };
  const send = (method, params) => new Promise(resolve => { const id = ++serial; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const data = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (data.exceptionDetails) throw new Error(data.exceptionDetails.text);
    return data.result.value;
  };
  await send('Page.reload', { ignoreCache: true });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const id = await evaluate('(async()=>{const x=await window.workbench.create("note");await window.workbench.save({...x,title:"UI 续写调试",draft:"这是一段待续写的开头。"});return x.id})()');
  try {
    await send('Page.reload', { ignoreCache: true });
    await new Promise(resolve => setTimeout(resolve, 1200));
    const before = await evaluate('(()=>{const e=document.querySelector("#draft");e.focus();e.setSelectionRange(0,2);e.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:500,clientY:350}));return {menu:!document.querySelector("#commandMenu").classList.contains("hidden"),options:[...document.querySelectorAll(".command-option")].map(x=>x.textContent)}})()');
    if (!before.menu) throw new Error('选区没有弹出 AI 菜单');
    console.log(JSON.stringify(before));
    await evaluate('document.querySelectorAll(".command-option")[1].click()');
    let result;
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await evaluate('({toast:document.querySelector("#toast").textContent,draft:document.querySelector("#draft").value,save:document.querySelector("#saveState").textContent,preview:document.querySelector("#continuationDialog").open,cards:document.querySelectorAll(".continuation-card").length})');
      if (result.preview || (/失败|返回|错误|无法|缺少|超时|接口/.test(result.toast) && !/正在/.test(result.toast))) break;
    }
    if (!result.preview || result.cards !== 3) throw new Error(`未得到三个候选版本：${JSON.stringify(result)}`);
    await evaluate('document.querySelector(".continuation-card button").click()');
    await new Promise(resolve => setTimeout(resolve, 1300));
    result = await evaluate('({toast:document.querySelector("#toast").textContent,draft:document.querySelector("#draft").value,save:document.querySelector("#saveState").textContent,undoDisabled:document.querySelector("#undoAi").disabled})');
    if (!result.draft.startsWith('这是') || !result.draft.endsWith('一段待续写的开头。') || result.draft.length <= 13) throw new Error(`续写插入位置错误：${JSON.stringify(result)}`);
    if (result.undoDisabled) throw new Error('续写后撤回键不可用');
    console.log(JSON.stringify({ toast: result.toast, draftLength: result.draft.length, insertedAfterSelection: true, save: result.save }));
  } finally {
    const file = path.join(__dirname, '..', 'data', 'items', `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await send('Page.reload', { ignoreCache: true });
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
