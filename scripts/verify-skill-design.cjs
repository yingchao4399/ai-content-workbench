const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9227/json')).json()).find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('工作台未运行');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => ws.onopen = resolve);
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.workbench.designSkill({title:"散文场景观察",purpose:"把用户亲身经历的散文素材写成有细节、有回望的短文，同时避免编造记忆。",modes:["essay"],testInput:"一段旧车站的亲身观察",expected:"细节来自素材，无法确认的记忆不写成事实"})', awaitPromise: true, returnByValue: true } }));
  const result = await new Promise((resolve, reject) => { ws.onmessage = event => { const data = JSON.parse(event.data); if (data.id !== 1) return; if (data.exceptionDetails) reject(new Error(data.exceptionDetails.text)); else resolve(data.result?.result?.value); }; ws.onerror = reject; });
  ws.close();
  if (!result?.body || result.body.length < 60 || !result.description || !result.testInput || !result.expected) throw new Error('AI Skill 设计结果不完整');
  const output = path.join(__dirname, '..', 'artifacts', 'ai-skill-design-preview.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ description: result.description, bodyLength: result.body.length, hasTestInput: true, hasExpected: true, preview: output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
