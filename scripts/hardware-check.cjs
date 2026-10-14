const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const action = process.argv[2] || 'snapshot';
  if (!['prepare', 'snapshot', 'finish'].includes(action)) throw new Error('用法：node scripts/hardware-check.cjs prepare|snapshot|finish');
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9233);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台');
  if (!page) throw new Error('未找到正在运行的 AI 内容工作台');
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
    if (action === 'prepare') {
      await evaluate(`(async()=>{
        for(let i=0;i<50&&!document.querySelector('#settingsButton').onclick;i++) await new Promise(r=>setTimeout(r,100));
        const d=document.querySelector('#settingsDialog');
        if(!d.open) document.querySelector('#settingsButton').click();
        for(let i=0;i<50&&!d.open;i++) await new Promise(r=>setTimeout(r,100));
        if(document.querySelector('#toggleKeyCheck').textContent==='结束检测') document.querySelector('#toggleKeyCheck').click();
        document.querySelector('#resetKeyCheck').click();
        window.__hardwareTrace=[];
        window.__hardwareDialogTrace=[];
        window.__hardwareSafetyActive=true;
        if(!window.__hardwareDialogTraceInstalled){
          d.addEventListener('cancel',()=>window.__hardwareDialogTrace.push({event:'cancel',at:new Date().toISOString()}),true);
          d.addEventListener('close',()=>window.__hardwareDialogTrace.push({event:'close',at:new Date().toISOString()}));
          document.querySelector('#closeSettings').addEventListener('click',()=>window.__hardwareDialogTrace.push({event:'close-button',at:new Date().toISOString()}),true);
          window.__hardwareDialogTraceInstalled=true;
        }
        if(!window.__hardwareSafetyInstalled){
          d.addEventListener('cancel',event=>{if(window.__hardwareSafetyActive) event.preventDefault();},true);
          d.addEventListener('close',()=>{
            if(window.__hardwareSafetyActive){keyCheckActive=true;renderKeyCheck();}
          });
          window.__hardwareSafetyInstalled=true;
        }
        if(!window.__hardwareTraceSubscribed){
          window.workbench.onShortcut(index=>window.__hardwareTrace.push({key:index+1,at:new Date().toISOString()}));
          window.__hardwareTraceSubscribed=true;
        }
        document.querySelector('#toggleKeyCheck').click();
        document.querySelector('#toggleKeyCheck').scrollIntoView({block:'center'});
      })()`);
    }
    const snapshot = await evaluate(`(async()=>({
      at:new Date().toISOString(),
      settingsOpen:document.querySelector('#settingsDialog').open,
      detecting:document.querySelector('#toggleKeyCheck').textContent==='结束检测',
      counts:[...document.querySelectorAll('#keyCheckCounts span')].map(x=>Number(x.textContent.split('：')[1])),
      trace:window.__hardwareTrace||[],
      dialogTrace:window.__hardwareDialogTrace||[],
      keyboard:(()=>{const k=document.querySelector('#keyboardStatus');return k?.textContent||''})(),
      shortcuts:(await window.workbench.info()).shortcuts.map(x=>({key:x.keyIndex+1,active:x.active}))
    }))()`);
    if (action === 'finish') {
      if (!snapshot.settingsOpen) {
        await evaluate(`(async()=>{document.querySelector('#settingsButton').click();for(let i=0;i<50&&!document.querySelector('#settingsDialog').open;i++) await new Promise(r=>setTimeout(r,100));})()`);
      }
      await evaluate(`window.__hardwareSafetyActive=false`);
      if (snapshot.detecting) await evaluate(`document.querySelector('#toggleKeyCheck').click()`);
      const folder = path.join(__dirname, '..', 'artifacts');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'easyinput-hardware-check.json'), JSON.stringify(snapshot, null, 2));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(folder, 'easyinput-hardware-check.png'), Buffer.from(shot.data, 'base64'));
    }
    console.log(JSON.stringify(snapshot));
  } finally { socket.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
