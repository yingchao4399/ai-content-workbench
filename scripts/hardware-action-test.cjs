async function main() {
  const action = process.argv[2] || 'status';
  if (!['prepare', 'prepare-sequence', 'status', 'cleanup'].includes(action)) throw new Error('用法：node scripts/hardware-action-test.cjs prepare|prepare-sequence|status|cleanup');
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
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve: result => result.exceptionDetails ? reject(new Error(result.exceptionDetails.text)) : resolve(result.result.value), reject });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  try {
    let result;
    if (action === 'prepare' || action === 'prepare-sequence') {
      result = await evaluate(`(async()=>{
        if(document.querySelector('#settingsDialog').open) document.querySelector('#closeSettings').click();
        await createItem(${action === 'prepare-sequence' ? "'wechat'" : "'note'"});
        ${action === 'prepare-sequence' ? "choosePane('idea');" : ""}
        document.querySelector('#title').value=${action === 'prepare-sequence' ? "'实体三键链路联调（临时）'" : "'实体 KEY3 整理联调（临时）'"};
        document.querySelector('#sideText').value=${action === 'prepare-sequence' ? "'写给 AI 产品经理：一个实体按键触发创作动作，需要区分电脑识别、配置同步和真实动作。只使用本次联调事实。'" : "''"};
        document.querySelector('#draft').value=${action === 'prepare-sequence' ? "'我们用 EasyInput 八键设备连接本地 AI 内容工作台。Windows 识别到 USB 设备，EasyInput 报告同步成功。随后用实体按键检验工作台收到的动作。'" : "'第一点：更换 USB 数据线后，电脑识别到 EasyInput 设备。第二点：EasyInput 显示同步成功。第三点：八个实体键还需要分别检查触发次数和执行结果。'"};
        await saveNow({stage:'manual',summary:'实体键临时测试笔记'});
        window.__hardwareActionTestId=(await window.workbench.list()).find(x=>x.title===${action === 'prepare-sequence' ? "'实体三键链路联调（临时）'" : "'实体 KEY3 整理联调（临时）'"})?.id;
        document.querySelector('#draft').focus();
        return {id:window.__hardwareActionTestId,settingsOpen:document.querySelector('#settingsDialog').open,detecting:keyCheckActive,draftLength:document.querySelector('#draft').value.length};
      })()`);
    } else if (action === 'status') {
      result = await evaluate(`(async()=>{
        const id=window.__hardwareActionTestId;
        const item=(await window.workbench.list()).find(x=>x.id===id);
        return {id,exists:!!item,draftLength:item?.draft.length,topicCardLength:item?.topicCard?.length,history:item?.history?.map(x=>({stage:x.stage,summary:x.summary})),busy,continuationOpen:document.querySelector('#continuationDialog').open,continuationCount:document.querySelectorAll('#continuationOptions article').length,settingsOpen:document.querySelector('#settingsDialog').open,detecting:keyCheckActive,saveState:document.querySelector('#saveState').textContent};
      })()`);
    } else {
      result = await evaluate(`(async()=>{
        if(busy) throw new Error('AI 还在运行，暂不清理');
        const id=window.__hardwareActionTestId;
        if(!id || !(await window.workbench.list()).some(x=>x.id===id)) throw new Error('找不到临时笔记，未清理');
        const before=window.confirm;window.confirm=()=>true;
        try{await deleteCurrent();}finally{window.confirm=before;}
        return {id,trashed:(await window.workbench.listTrash()).some(x=>x.id===id)};
      })()`);
    }
    console.log(JSON.stringify(result));
  } finally { socket.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
