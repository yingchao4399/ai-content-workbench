const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createMaterialStore } = require('../lib/materials.cjs');
const { saveDraft, setInstalled, packageSkill } = require('../lib/skill-studio.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const data = path.join(root, 'data');
  const store = createStore(data), materials = createMaterialStore(data);
  const id = '20261013T162112-dec575f3';
  const article = store.get(id);
  const sourcePath = path.resolve(root, '..', 'AI嵌入式智能开发工作台-复盘与方案.md');
  if (!fs.existsSync(sourcePath)) throw new Error('第二课一手复盘材料不存在');
  let source = materials.list().find(item => item.source === sourcePath || item.originalName === path.basename(sourcePath));
  if (!source) source = await materials.importFile(sourcePath, { title: '第二课 EasyInput 实操复盘原文', category: '一手实操记录', storeMarkdown: true });

  const design = {
    name: 'hardware-evidence-wechat',
    title: 'AI 硬件四级证据写作',
    description: '写或审阅 AI 硬件产品经理公众号文章时，按构建、设备、配置和实体行为四级证据核对结论。',
    modes: ['wechat', 'note'],
    body: `# 目标\n\n把 AI 硬件项目中的“成功”写成可核查的观察，而非笼统结论。用于基于真实实操记录写公众号文章或复盘笔记。\n\n## 输入\n\n读取用户给出的操作记录、源码或日志、配置回执、实体键演示结果及其来源。找不到的材料写入待核实，不补造截图、时间、版本或测试。\n\n## 写作方法\n\n按四级证据说明：一是源码和工具链构建出什么；二是目标设备识别、写入与重启状态；三是 App 使用什么连接通道保存配置、得到什么回执；四是按下实体键后电脑出现什么可观察结果。每级都写清其能证明的范围，不能把前一级结果推断为后一级通过。对设计协议、源码约定和实板观察分别标明性质。\n\n面向 AI 产品经理，以读者问题开篇，给出具体故障、排查路径、可复用验收清单和仍未验证的边界。相同待核实问题只保留一条；没有来源的事实陈述加待核实提示。\n\n## 输出与检查\n\n输出适合手机阅读的标题、小标题和短段落。检查每一项数字、版本、端口、回执和实体行为是否能回指原始材料；对蓝牙、双连接、其他按键等未实测场景不得写成已验证。文章由用户最终审阅决定是否发布。`,
    testInput: '用第二课 EasyInput 实操复盘，审阅一篇关于实体键打开应用的 AI 产品经理公众号文章。',
    expected: '文章分别说明构建、写入启动、配置回执和实体行为的证据边界；待核实事项不重复；未实测连接方式不被写成已通过。',
    source: ''
  };
  const previous = materials.list();
  let skill = require('../lib/skill-studio.cjs').listCustomSkills(data).find(item => item.name === design.name);
  if (!skill) skill = saveDraft(data, design);
  if (skill.status !== 'installed') skill = setInstalled(data, skill.id, true);
  const output = path.join(root, 'artifacts', `${design.name}.zip`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  packageSkill(data, skill.id, output);
  const selected = [...new Set([...(article.optionalSkills || []), skill.id])];
  const references = [...new Set([...(article.materialIds || []), source.id])];
  store.save({ ...article, optionalSkills: selected, materialIds: references, recordEvent: { stage: 'manual', summary: '安装自定义 AI 硬件四级证据 Skill，并引用第二课一手复盘原件' } });
  console.log(JSON.stringify({ articleId: id, sourceId: source.id, skillId: skill.id, skillZip: output, materialsBefore: previous.length, materialsAfter: materials.list().length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
