async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9233);
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
    const result = await evaluate(`(async()=>{
      const start=performance.now();
      const settings=await window.workbench.settings();
      const settingsMs=Math.round(performance.now()-start);
      let models=[],modelError='';
      if(settings.ai.apiProfiles.deepseek.hasApiKey){
        try{
          const result=await window.workbench.listModels('deepseek',{baseUrl:settings.ai.apiProfiles.deepseek.baseUrl,apiKey:''});
          models=result.models;
        }catch(error){modelError=error.message;}
      }
      document.querySelector('#settingsButton').click();
      for(let i=0;i<100&&!document.querySelector('#settingsDialog').open;i++) await new Promise(r=>setTimeout(r,20));
      for(let i=0;i<150&&document.querySelector('#modelStatus')?.textContent?.includes('正在读取');i++) await new Promise(r=>setTimeout(r,100));
      return {settingsMs,provider:settings.ai.provider,deepseekSaved:settings.ai.apiProfiles.deepseek.hasApiKey,models,modelError,uiOptions:[...document.querySelectorAll('#modelPicker option')].map(x=>x.value).filter(Boolean),modelStatus:document.querySelector('#modelStatus')?.textContent||''};
    })()`);
    console.log(JSON.stringify(result));
  } finally { socket.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
