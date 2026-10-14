const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9227/json')).json()).find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('工作台未运行');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => ws.onopen = resolve);
  const id = 1;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'window.workbench.run("20261013T162112-dec575f3","organize",{selection:"",prefix:"",suffix:"",origin:"direct",targetField:"draft"})', awaitPromise: true, returnByValue: true } }));
  const result = await new Promise((resolve, reject) => { ws.onmessage = event => { const data = JSON.parse(event.data); if (data.id !== id) return; if (data.exceptionDetails) reject(new Error(data.exceptionDetails.text)); else resolve(data.result?.result?.value); }; ws.onerror = reject; });
  ws.close();
  if (!result?.revisedBody || !result?.reviewNotes || !Array.isArray(result?.needsConfirmation)) throw new Error(`Skill 试跑返回格式不完整：${JSON.stringify(result).slice(0, 500)}`);
  const output = path.join(__dirname, '..', 'artifacts', 'skill-iteration-preview.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ revisedLength: result.revisedBody.length, reviewNotes: result.reviewNotes, newUnknowns: result.needsConfirmation.length, preview: output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
