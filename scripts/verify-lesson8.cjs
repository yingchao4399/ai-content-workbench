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
    const ready = await evaluate('(async()=>{for(let i=0;i<50 && !document.querySelector("#captureButton")?.onclick;i++)await new Promise(r=>setTimeout(r,100));const info=await window.workbench.info();return {ready:!!document.querySelector("#captureButton")?.onclick, count:(await window.workbench.list()).length, materialCount:(await window.workbench.listMaterials()).length, shortcutCount:info.shortcuts.length, key4:info.keyActions[3]}})()');
    if (!ready.ready || ready.shortcutCount !== 8 || ready.key4 !== 'capture_clipboard_note') throw new Error(`速记入口或八键未就绪：${JSON.stringify(ready)}`);
    const rejected = await evaluate('(async()=>{await captureClipboardNote("");await captureClipboardNote("字".repeat(200001));return {open:document.querySelector("#captureDialog").open,count:(await window.workbench.list()).length}})()');
    if (rejected.open || rejected.count !== ready.count) throw new Error(`空内容或超长内容未拦截：${JSON.stringify(rejected)}`);
    const preview = await evaluate('(async()=>{document.querySelector("#captureButton").click();for(let i=0;i<30 && !document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));return {open:document.querySelector("#captureDialog").open,text:document.querySelector("#captureText").value,count:(await window.workbench.list()).length}})()');
    if (!preview.open || preview.text !== '第八课实测：从网页复制一段观察，先预览再落入本地笔记。' || preview.count !== ready.count) throw new Error(`预览不符：${JSON.stringify(preview)}`);
    const repeated = await evaluate('(async()=>{document.querySelector("#captureSource").value="课程网页 https://example.com/lesson8";await captureClipboardNote("另一段内容");return {open:document.querySelector("#captureDialog").open,text:document.querySelector("#captureText").value,source:document.querySelector("#captureSource").value}})()');
    if (!repeated.open || repeated.text !== preview.text || repeated.source !== '课程网页 https://example.com/lesson8') throw new Error(`重复触发覆盖了当前预览：${JSON.stringify(repeated)}`);
    const folder = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(folder, { recursive: true });
    const previewShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const previewFile = path.join(folder, 'lesson8-quick-capture-preview.png');
    fs.writeFileSync(previewFile, Buffer.from(previewShot.data, 'base64'));
    const cancelled = await evaluate('(async()=>{document.querySelector("#cancelCapture").click();return {open:document.querySelector("#captureDialog").open,count:(await window.workbench.list()).length,materialCount:(await window.workbench.listMaterials()).length}})()');
    if (cancelled.open || cancelled.count !== ready.count || cancelled.materialCount !== ready.materialCount) throw new Error(`取消未生效：${JSON.stringify(cancelled)}`);
    const saved = await evaluate('(async()=>{document.querySelector("#captureButton").click();for(let i=0;i<30 && !document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));document.querySelector("#captureSource").value="课程网页 https://example.com/lesson8";document.querySelector("#saveCapture").click();document.querySelector("#saveCapture").click();for(let i=0;i<70 && document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));const list=await window.workbench.list(),materials=await window.workbench.listMaterials();return {open:document.querySelector("#captureDialog").open,count:list.length,materialCount:materials.length,title:list[0].title,draft:list[0].draft,materials:list[0].materials,materialIds:list[0].materialIds,capturedMaterial:materials[0]&&{id:materials[0].id,content:materials[0].content,source:materials[0].source,markdownPath:materials[0].markdownPath},history:list[0].history.at(-1)?.summary,visible:document.querySelector("#draft").value}})()');
    if (saved.open || saved.count !== ready.count + 1 || saved.materialCount !== ready.materialCount + 1 || saved.draft !== preview.text || saved.visible !== preview.text || saved.materials !== '来源：课程网页 https://example.com/lesson8' || saved.materialIds.length !== 1 || saved.materialIds[0] !== saved.capturedMaterial?.id || saved.capturedMaterial.content !== preview.text || saved.capturedMaterial.source !== '课程网页 https://example.com/lesson8' || !fs.existsSync(saved.capturedMaterial.markdownPath) || saved.history !== '从剪贴板创建速记') throw new Error(`笔记和材料未正确关联：${JSON.stringify(saved)}`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(__dirname, '..', 'artifacts', 'lesson8-quick-capture.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    const libraryShown = await evaluate('(async()=>{document.querySelector("#libraryButton").click();for(let i=0;i<40 && !document.querySelector("#materialDetail").innerText.includes("课程网页 https://example.com/lesson8");i++)await new Promise(r=>setTimeout(r,100));return {visible:!document.querySelector("#libraryView").classList.contains("hidden"),count:(await window.workbench.listMaterials()).length,detail:document.querySelector("#materialDetail").innerText.includes("课程网页 https://example.com/lesson8")}})()');
    if (!libraryShown.visible || libraryShown.count !== ready.materialCount + 1 || !libraryShown.detail) throw new Error(`材料库中未显示速记来源：${JSON.stringify(libraryShown)}`);
    const libraryShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const libraryFile = path.join(folder, 'lesson8-material-library.png');
    fs.writeFileSync(libraryFile, Buffer.from(libraryShot.data, 'base64'));
    await evaluate('document.querySelector("#homeButton").click()');
    const noteOnly = await evaluate('(async()=>{document.querySelector("#captureButton").click();for(let i=0;i<30 && !document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));document.querySelector("#captureAddToLibrary").checked=false;document.querySelector("#saveCapture").click();for(let i=0;i<70 && document.querySelector("#captureDialog").open;i++)await new Promise(r=>setTimeout(r,100));const list=await window.workbench.list();return {open:document.querySelector("#captureDialog").open,count:list.length,materialCount:(await window.workbench.listMaterials()).length,materialIds:list[0].materialIds}})()');
    if (noteOnly.open || noteOnly.count !== ready.count + 2 || noteOnly.materialCount !== ready.materialCount + 1 || noteOnly.materialIds.length) throw new Error(`仅保存笔记选项未生效：${JSON.stringify(noteOnly)}`);
    console.log(JSON.stringify({ ready, rejected, preview, repeated, cancelled, saved, libraryShown, noteOnly, previewScreenshot: previewFile, screenshot: file, libraryScreenshot: libraryFile }));
  } finally { socket.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
