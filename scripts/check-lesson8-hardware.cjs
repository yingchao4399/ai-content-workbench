const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const phase = process.argv[2];
  if (!['arm', 'inspect'].includes(phase)) throw new Error('用法：node scripts/check-lesson8-hardware.cjs arm|inspect');
  const pages = await (await fetch('http://127.0.0.1:9338/json')).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台' && entry.type === 'page');
  if (!page) throw new Error('未找到第八课测试窗口');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    if (phase === 'arm') {
      await send('Page.reload');
      const state = await evaluate('(async()=>{for(let i=0;i<60 && !document.querySelector("#captureButton")?.onclick;i++)await new Promise(r=>setTimeout(r,100));const info=await window.workbench.info();return {ready:!!document.querySelector("#captureButton")?.onclick,key4:info.keyActions[3],registered:info.shortcuts[3].active,allRegistered:info.shortcuts.every(x=>x.active),dialogOpen:document.querySelector("#captureDialog").open,count:(await window.workbench.list()).length}})()');
      if (!state.ready || state.key4 !== 'capture_clipboard_note' || !state.registered || state.dialogOpen) throw new Error(`未准备好：${JSON.stringify(state)}`);
      console.log(JSON.stringify({ phase, state }));
    } else {
      const state = await evaluate('(async()=>{const list=await window.workbench.list();return {dialogOpen:document.querySelector("#captureDialog").open,text:document.querySelector("#captureText").value,count:list.length,rendererKey4:keyActions[3],currentTitle:document.querySelector("#title").value,lastDraft:list[0]?.draft,lastHistory:list[0]?.history.at(-1)?.summary}})()');
      const expected = '第八课真机验证：EasyInput KEY4 采集成功。';
      if (!state.dialogOpen || state.text !== expected) throw new Error(`实体键未触发预期预览：${JSON.stringify({ dialogOpen: state.dialogOpen, textLength: state.text.length, textHasExpected: state.text.includes(expected), count: state.count, rendererKey4: state.rendererKey4, currentTitle: state.currentTitle, lastDraftLength: state.lastDraft?.length, lastDraftHasExpected: state.lastDraft?.includes(expected), lastHistory: state.lastHistory })}`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const screenshot = path.join(__dirname, '..', 'artifacts', 'lesson8-hardware-key4-preview.png');
      fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
      const saved = await evaluate('(async()=>{document.querySelector("#saveCapture").click();for(let i=0;i<60 && document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));const list=await window.workbench.list();return {dialogOpen:document.querySelector("#captureDialog").open,count:list.length,title:list[0].title,draft:list[0].draft,history:list[0].history.at(-1)?.summary}})()');
      if (saved.dialogOpen || saved.count !== state.count + 1 || saved.draft !== expected || saved.history !== '从剪贴板创建速记') throw new Error(`实体键笔记保存失败：${JSON.stringify(saved)}`);
      console.log(JSON.stringify({ phase, preview: { dialogOpen: state.dialogOpen, countBefore: state.count }, saved: { dialogOpen: saved.dialogOpen, count: saved.count, title: saved.title, history: saved.history }, screenshot }));
    }
  } finally { socket.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
