const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9338);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台' && entry.type === 'page');
  if (!page) throw new Error('未找到开发版工作台窗口');
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
    const ready = await evaluate('(async()=>{for(let i=0;i<50 && !document.querySelector("#captureButton")?.onclick;i++)await new Promise(r=>setTimeout(r,100));return {ready:!!document.querySelector("#captureButton")?.onclick, count:(await window.workbench.list()).length, shortcutCount:(await window.workbench.info()).shortcuts.length}})()');
    if (!ready.ready || ready.shortcutCount !== 8) throw new Error(`速记入口或八键未就绪：${JSON.stringify(ready)}`);
    const preview = await evaluate('(async()=>{document.querySelector("#captureButton").click();for(let i=0;i<30 && !document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));return {open:document.querySelector("#captureDialog").open,text:document.querySelector("#captureText").value,count:(await window.workbench.list()).length}})()');
    if (!preview.open || preview.text !== '第八课实测：从网页复制一段观察，先预览再落入本地笔记。' || preview.count !== ready.count) throw new Error(`预览不符：${JSON.stringify(preview)}`);
    const folder = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(folder, { recursive: true });
    const previewShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const previewFile = path.join(folder, 'lesson8-quick-capture-preview.png');
    fs.writeFileSync(previewFile, Buffer.from(previewShot.data, 'base64'));
    const cancelled = await evaluate('(async()=>{document.querySelector("#cancelCapture").click();return {open:document.querySelector("#captureDialog").open,count:(await window.workbench.list()).length}})()');
    if (cancelled.open || cancelled.count !== ready.count) throw new Error(`取消未生效：${JSON.stringify(cancelled)}`);
    const saved = await evaluate('(async()=>{document.querySelector("#captureButton").click();for(let i=0;i<30 && !document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));document.querySelector("#saveCapture").click();for(let i=0;i<50 && document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));const list=await window.workbench.list();return {open:document.querySelector("#captureDialog").open,count:list.length,title:list[0].title,draft:list[0].draft,history:list[0].history.at(-1)?.summary,visible:document.querySelector("#draft").value}})()');
    if (saved.open || saved.count !== ready.count + 1 || saved.draft !== preview.text || saved.visible !== preview.text || saved.history !== '从剪贴板创建速记') throw new Error(`保存未落盘：${JSON.stringify(saved)}`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(__dirname, '..', 'artifacts', 'lesson8-quick-capture.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ ready, preview, cancelled, saved, previewScreenshot: previewFile, screenshot: file }));
  } finally { socket.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
