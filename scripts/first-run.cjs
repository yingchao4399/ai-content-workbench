const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { runStage } = require('../lib/agent.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const store = createStore(path.join(root, 'data'));
  const sourcePath = path.resolve(root, '..', 'AI嵌入式智能开发工作台-复盘与方案.md');
  const source = fs.readFileSync(sourcePath, 'utf8').split('## 三、')[0];
  let item = store.create('wechat');
  item = store.save({ ...item,
    title: 'AI 产品经理做 AI 硬件：一个按键打开应用，为什么需要四级验证？',
    idea: '写一篇面向 AI 产品经理的公众号文章。用自己第二课 EasyInput 实操说明：编译、烧录、App 配置回执、实体按键打开应用是四级不同证据。给读者一个可复用的验收方法，不夸大尚未实测的蓝牙和双连接场景。',
    materials: `真实素材来源：${sourcePath}\n\n${source}`
  });
  console.log('created', item.id);
  const collected = await runStage(store, item.id, 'collect', {}, root);
  item = store.save({ ...item, topicCard: collected.topicCard, needsConfirmation: collected.missingInfo,
    recordEvent: { stage: 'collect', summary: '基于第二课实操记录生成选题卡' } });
  console.log('collect done', collected.topicCard.length);
  const continued = await runStage(store, item.id, 'continue', { prefix: '', suffix: '', selection: '' }, root);
  const chosen = continued.continuations?.[0] || '';
  if (!chosen) throw new Error('AI 未返回可用的三个续写版本');
  item = store.save({ ...item, draft: chosen, reviewNotes: continued.reviewNotes,
    needsConfirmation: [...new Set([...item.needsConfirmation, ...continued.unknowns])],
    recordEvent: { stage: 'continue', summary: '生成公众号文章初稿' } });
  console.log('continue done', chosen.length);
  const organized = await runStage(store, item.id, 'organize', { prefix: '', suffix: '', selection: '' }, root);
  item = store.save({ ...item, draft: organized.revisedBody,
    reviewNotes: `${item.reviewNotes}\n\n${organized.reviewNotes}`,
    needsConfirmation: [...new Set([...item.needsConfirmation, ...organized.needsConfirmation])],
    recordEvent: { stage: 'organize', summary: '整理公众号文章结构和表述' } });
  console.log('organize done', organized.revisedBody.length);
  console.log('item', path.join(store.root, 'items', `${item.id}.json`));
  console.log('needsConfirmation', item.needsConfirmation.length);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
