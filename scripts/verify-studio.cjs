const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.WORKBENCH_CDP_PORT || 9227);
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.title === 'AI 内容工作台');
  if (!page) throw new Error('工作台未运行');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => ws.onopen = resolve);
  let serial = 0; const pending = new Map();
  ws.onmessage = event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { pending.get(data.id)(data.result); pending.delete(data.id); } };
  const send = (method, params) => new Promise(resolve => { const id = ++serial; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const name = `test-studio-${Date.now()}`;
  const root = process.env.WORKBENCH_DATA_DIR || path.join(__dirname, '..', 'data');
  let itemId;
  try {
    await send('Page.reload', { ignoreCache: true }); await new Promise(resolve => setTimeout(resolve, 1000));
    itemId = await evaluate('(async()=>{const x=await window.workbench.create("note");return x.id})()');
    await send('Page.reload', { ignoreCache: true }); await new Promise(resolve => setTimeout(resolve, 1000));
    const opened = await evaluate('(()=>{document.querySelector("#skillStudioButton").click();return {visible:!document.querySelector("#studioView").classList.contains("hidden"),builtins:document.querySelectorAll(".studio-builtin").length}})()');
    if (!opened.visible || opened.builtins < 5) throw new Error(`工作室未打开：${JSON.stringify(opened)}`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'skills-studio.png'), Buffer.from(shot.data, 'base64'));
    const filled = await evaluate(`(async()=>{document.querySelector("#newSkill").click();document.querySelector("#studioName").value=${JSON.stringify(name)};document.querySelector("#studioTitle").value="测试笔记方法";document.querySelector("#studioDescription").value="记录笔记时检查每条观点的来源。";document.querySelector("#studioBody").value="# 目标\\n核对笔记观点与材料来源。\\n\\n## 方法\\n逐条审看观点，保留原文位置，无法找到来源的内容标为待核实。\\n\\n## 输出\\n列出来源与可修改建议，交给用户审阅。";document.querySelector("#studioView fieldset input[value=note]").checked=true;await document.querySelector("#validateSkill").onclick();return document.querySelector("#studioStatus").textContent})()`);
    if (!filled.includes('结构检查通过')) throw new Error(`Skill 结构检查失败：${filled}`);
    await evaluate('document.querySelector("#installSkill").click()');
    let installed = false;
    for (let i = 0; i < 20; i++) { await new Promise(resolve => setTimeout(resolve, 300)); installed = await evaluate('document.querySelector("#studioStatus").textContent.includes("已安装")'); if (installed) break; }
    if (!installed) throw new Error('Skill 安装未完成');
    const catalog = await evaluate('window.workbench.skillCatalog().then(x=>x.filter(y=>y.kind==="custom").map(y=>y.id))');
    if (!catalog.includes(`custom:${name}`)) throw new Error('已安装 Skill 未进入作品技能目录');
    await evaluate('document.querySelector("#useSkill").click()');
    await new Promise(resolve => setTimeout(resolve, 500));
    const used = await evaluate(`window.workbench.list().then(x=>x.find(y=>y.id===${JSON.stringify(itemId)})?.optionalSkills||[])`);
    if (!used.includes(`custom:${name}`)) throw new Error('作品未启用自定义 Skill');
    console.log(JSON.stringify({ studioVisible: true, builtins: opened.builtins, installed: true, usedInItem: true }));
  } finally {
    const item = path.join(root, 'items', `${itemId}.json`);
    const skill = path.join(root, 'skills', name);
    if (itemId && fs.existsSync(item)) fs.unlinkSync(item);
    if (path.resolve(skill).startsWith(`${path.resolve(root, 'skills')}${path.sep}`) && fs.existsSync(skill)) fs.rmSync(skill, { recursive: true, force: true });
    await send('Page.reload', { ignoreCache: true }); ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
