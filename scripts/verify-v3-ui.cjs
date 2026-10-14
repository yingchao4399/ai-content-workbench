async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9234);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(entry => entry.title === 'AI 内容工作台');
  if (!page) throw new Error('未找到工作台测试窗口');
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
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve: result => result.exceptionDetails ? reject(new Error(result.exceptionDetails.text)) : resolve(result.result.value), reject });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  try {
    const result = await evaluate(`(async()=>{
      document.querySelector('#homeButton').click();
      const dialog=document.querySelector('#settingsDialog');
      if(dialog.open) dialog.close();
      const start=performance.now(); document.querySelector('#settingsButton').click();
      for(let i=0;i<100&&!dialog.open;i++) await new Promise(r=>setTimeout(r,10));
      const openMs=Math.round(performance.now()-start);
      const statusAtOpen=document.querySelector('#keyboardStatus').textContent;
      const picker=!!document.querySelector('#modelPicker');
      dialog.close();
      const before=(await window.workbench.list()).length;
      document.querySelector('#newButton').click();
      [...document.querySelectorAll('#newMenu button')].find(x=>x.textContent.includes('笔记')).click();
      for(let i=0;i<100&&(await window.workbench.list()).length===before;i++) await new Promise(r=>setTimeout(r,10));
      const title=document.querySelector('#title'), draft=document.querySelector('#draft');
      title.value='回收站界面验证';title.dispatchEvent(new Event('input',{bubbles:true}));
      draft.value='应能恢复的正文';draft.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,800));
      const id=(await window.workbench.list()).find(x=>x.title==='回收站界面验证')?.id;
      if(!id) throw new Error('笔记尚未保存');
      const originalConfirm=window.confirm;window.confirm=()=>true;
      document.querySelector('#deleteItem').click();
      for(let i=0;i<100&&!(await window.workbench.listTrash()).some(x=>x.id===id);i++) await new Promise(r=>setTimeout(r,20));
      window.confirm=originalConfirm;
      const trashed=(await window.workbench.listTrash()).some(x=>x.id===id);
      document.querySelector('#trashButton').click();
      for(let i=0;i<100&&!document.querySelector('#trashDialog').open;i++) await new Promise(r=>setTimeout(r,20));
      const restoreVisible=[...document.querySelectorAll('#trashList button')].some(x=>x.textContent==='恢复');
      const row=[...document.querySelectorAll('#trashList .trash-row')].find(x=>x.textContent.includes('回收站界面验证'));
      row?.querySelector('button')?.click();
      for(let i=0;i<100&&!(await window.workbench.list()).some(x=>x.id===id);i++) await new Promise(r=>setTimeout(r,20));
      const restored=(await window.workbench.list()).find(x=>x.id===id);
      return {openMs,statusAtOpen,picker,trashed,restoreVisible,restored:restored?.draft==='应能恢复的正文'};
    })()`);
    if (!result.picker || !result.trashed || !result.restoreVisible || !result.restored) throw new Error(`界面验证失败：${JSON.stringify(result)}`);
    console.log(JSON.stringify(result));
  } finally { socket.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
