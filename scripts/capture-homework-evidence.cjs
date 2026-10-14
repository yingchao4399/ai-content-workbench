const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9236);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台');
  if (!page) throw new Error('未找到工作台');
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
    pending.set(id, { resolve: result => result.exceptionDetails ? reject(new Error(result.exceptionDetails.text)) : resolve(result.result?.value ?? result), reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const folder = path.join(__dirname, '..', 'artifacts', 'homework-evidence');
  fs.mkdirSync(folder, { recursive: true });
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(folder, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  };
  let originalId;
  try {
    const selected = await evaluate(`(async()=>{
      const all=await window.workbench.list();
      const target=all.find(x=>x.id==='20261013T162112-dec575f3');
      if(!target) throw new Error('未找到真实公众号作品');
      window.__evidenceOriginalId=current?.id;
      await selectItem(target.id);
      document.querySelector('#homeButton').click();
      return {originalId:window.__evidenceOriginalId,targetId:target.id,title:target.title,mode:target.mode};
    })()`);
    originalId = selected.originalId;
    const files = { article: await shot('01-real-article') };
    await evaluate(`document.querySelector('#libraryButton').click()`);
    files.materials = await shot('02-material-library');
    await evaluate(`document.querySelector('#skillStudioButton').click()`);
    files.skills = await shot('03-skills-studio');
    await evaluate(`(async()=>{
      document.querySelector('#homeButton').click();
      document.querySelector('#settingsButton').click();
      for(let i=0;i<50&&!document.querySelector('#settingsDialog').open;i++) await new Promise(r=>setTimeout(r,50));
      document.querySelector('#modelPicker').scrollIntoView({block:'center'});
      for(let i=0;i<100&&document.querySelector('#modelStatus').textContent.includes('正在读取');i++) await new Promise(r=>setTimeout(r,100));
    })()`);
    files.models = await shot('04-deepseek-models');
    await evaluate(`document.querySelector('#mapping').scrollIntoView({block:'start'})`);
    files.keys = await shot('05-key-mapping');
    console.log(JSON.stringify({ selected, files }));
  } finally {
    if (originalId) {
      try { await evaluate(`(async()=>{if(document.querySelector('#settingsDialog').open)document.querySelector('#settingsDialog').close();document.querySelector('#homeButton').click();await selectItem(${JSON.stringify(originalId)});})()`); }
      catch (error) { console.error(`未能还原原作品视图：${error.message}`); }
    }
    socket.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
