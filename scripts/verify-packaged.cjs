const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9228);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台');
  if (!page || !page.url.includes('app.asar/index.html')) throw new Error('未找到打包版工作台页面');
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
    const home = await evaluate('(async()=>({title:document.title, info:await window.workbench.info(), draft:!!document.querySelector("#draft")}))()');
    if (!home.draft || home.info.shortcuts.length !== 8 || (process.env.WORKBENCH_ALLOW_SHORTCUT_CONFLICT !== '1' && home.info.shortcuts.some(key => !key.active))) throw new Error('打包版首页或八键快捷键未就绪');
    await evaluate('(async()=>{for(let i=0;i<50 && !document.querySelector("#settingsButton").onclick;i++) await new Promise(r=>setTimeout(r,100));return !!document.querySelector("#settingsButton").onclick})()');
    const settings = await evaluate('(async()=>{const d=document.querySelector("#settingsDialog");if(d.open)d.close();document.querySelector("#settingsButton").click();for(let i=0;i<100&&!d.open;i++)await new Promise(r=>setTimeout(r,100));return {open:d.open,keys:document.querySelectorAll("#mapping select").length,capabilities:document.querySelectorAll(".capability-card").length}})()');
    if (!settings.open || settings.keys !== 8 || settings.capabilities !== 4) throw new Error(`打包版设置页缺少键位或多模态配置：${JSON.stringify(settings)}`);
    const keyCheck = await evaluate('(()=>{document.querySelector("#toggleKeyCheck").click();const first={text:document.querySelector("#toggleKeyCheck").textContent,badges:document.querySelectorAll("#keyCheckCounts span").length};document.querySelector("#resetKeyCheck").click();document.querySelector("#toggleKeyCheck").click();return first})()');
    if (keyCheck.text !== '结束检测' || keyCheck.badges !== 8) throw new Error('打包版八键检测模式未就绪');
    const folder = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(folder, { recursive: true });
    await evaluate('document.querySelector("#toggleKeyCheck").scrollIntoView({block:"center"})');
    const settingsShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(folder, 'packaged-v2-settings.png'), Buffer.from(settingsShot.data, 'base64'));
    const library = await evaluate('(()=>{document.querySelector("#settingsDialog").close();document.querySelector("#libraryButton").click();return {visible:!document.querySelector("#libraryView").classList.contains("hidden"),upload:!!document.querySelector("#importFiles")}})()');
    if (!library.visible || !library.upload) throw new Error('打包版材料库未正常打开');
    const studio = await evaluate('(async()=>{document.querySelector("#skillStudioButton").click();await new Promise(r=>setTimeout(r,250));return {visible:!document.querySelector("#studioView").classList.contains("hidden"),references:document.querySelectorAll(".studio-builtin").length}})()');
    if (!studio.visible || studio.references < 5) throw new Error('打包版 Skills 工作室未正常打开');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(folder, 'packaged-skills-studio.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ packaged: true, dataRoot: home.info.root, shortcuts: home.info.shortcuts.length, registeredShortcuts: home.info.shortcuts.filter(key => key.active).length, settings, keyCheck, library, studio }));
  } finally { socket.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
