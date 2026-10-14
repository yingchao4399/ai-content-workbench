const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9227);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('没有找到工作台页面');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) { const { resolve, reject } = pending.get(data.id); pending.delete(data.id); data.error ? reject(new Error(data.error.message)) : resolve(data.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const state = await send('Runtime.evaluate', { expression: '({title:document.title, editor:!!document.querySelector("#draft"), settings:!!document.querySelector("#settingsButton"), items:document.querySelectorAll(".item").length})', returnByValue: true });
  console.log(JSON.stringify(state.result.value));
  if (!state.result.value.editor || !state.result.value.settings) throw new Error('界面缺少主要控件');
  const folder = path.join(__dirname, '..', 'artifacts'); fs.mkdirSync(folder, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(folder, 'workbench.png'), Buffer.from(shot.data, 'base64'));
  await send('Runtime.evaluate', { expression: 'document.querySelector("#settingsButton").click()' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const dialog = await send('Runtime.evaluate', { expression: '({open:document.querySelector("#settingsDialog").open, rows:document.querySelectorAll("#mapping select").length, capabilities:document.querySelectorAll(".capability-card").length, length:document.querySelector("#continueCharacters").value, text:document.querySelector("#keyboardStatus").textContent})', returnByValue: true });
  console.log(JSON.stringify(dialog.result.value));
  if (!dialog.result.value.open || dialog.result.value.rows !== 8 || dialog.result.value.capabilities !== 4 || !dialog.result.value.length) throw new Error('八键、多模态或续写设置窗口没有正确打开');
  const settingsShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(folder, 'settings.png'), Buffer.from(settingsShot.data, 'base64'));
  const slash = await send('Runtime.evaluate', { expression: '(()=>{document.querySelector("#settingsDialog").close();const e=document.querySelector("#draft");e.focus();e.setSelectionRange(Math.min(4,e.value.length),Math.min(4,e.value.length));e.dispatchEvent(new KeyboardEvent("keydown",{key:"/",bubbles:true,cancelable:true}));return {visible:!document.querySelector("#commandMenu").classList.contains("hidden"),options:document.querySelectorAll(".command-option").length}})()', returnByValue: true });
  console.log(JSON.stringify(slash.result.value));
  if (!slash.result.value.visible || slash.result.value.options !== 3) throw new Error('斜杠命令没有弹出三项 AI 操作');
  await send('Runtime.evaluate', { expression: 'document.querySelector("#commandMenu").classList.add("hidden");window.__choice="pending";chooseContinuation(["方案甲","方案乙","方案丙"]).then(x=>window.__choice=x)' });
  const candidates = await send('Runtime.evaluate', { expression: '({open:document.querySelector("#continuationDialog").open,cards:document.querySelectorAll(".continuation-card").length})', returnByValue: true });
  if (!candidates.result.value.open || candidates.result.value.cards !== 3) throw new Error('三个续写候选没有显示');
  await send('Runtime.evaluate', { expression: 'document.querySelector("#regenerateContinuation").click()' });
  const regenerate = await send('Runtime.evaluate', { expression: 'window.__choice', returnByValue: true });
  if (regenerate.result.value !== 'regenerate') throw new Error('重新抽卡按钮没有返回重新生成动作');
  await send('Runtime.evaluate', { expression: 'window.__choice="pending";chooseContinuation(["版本一","版本二","版本三"]).then(x=>window.__choice=x);document.querySelectorAll(".continuation-card button")[1].click()' });
  const picked = await send('Runtime.evaluate', { expression: 'window.__choice', returnByValue: true });
  if (picked.result.value !== 1) throw new Error('续写候选选择没有返回版本编号');
  const library = await send('Runtime.evaluate', { expression: 'document.querySelector("#commandMenu").classList.add("hidden");document.querySelector("#libraryButton").click();({visible:!document.querySelector("#libraryView").classList.contains("hidden"),upload:!!document.querySelector("#importFiles"),search:!!document.querySelector("#materialSearch")})', returnByValue: true });
  console.log(JSON.stringify(library.result.value));
  if (!library.result.value.visible || !library.result.value.upload || !library.result.value.search) throw new Error('材料库页面没有正确打开');
  const libraryShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(folder, 'materials.png'), Buffer.from(libraryShot.data, 'base64'));
  const add = await send('Runtime.evaluate', { expression: 'document.querySelector("#addLink").click();({open:document.querySelector("#materialDialog").open,originalText:!document.querySelector("#newMaterialTextWrap").classList.contains("hidden"),category:!!document.querySelector("#newMaterialCategory")})', returnByValue: true });
  console.log(JSON.stringify(add.result.value));
  if (!add.result.value.open || !add.result.value.originalText || !add.result.value.category) throw new Error('链接原文导入窗口没有正确打开');
  socket.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
