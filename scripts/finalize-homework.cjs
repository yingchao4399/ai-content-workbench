const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createMaterialStore } = require('../lib/materials.cjs');

function main() {
  const root = path.resolve(__dirname, '..');
  const data = path.join(root, 'data');
  const store = createStore(data), library = createMaterialStore(data);
  const id = '20261013T162112-dec575f3';
  let article = store.get(id);
  const preview = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'skill-iteration-preview.json'), 'utf8'));
  if (!preview.revisedBody?.includes('四级证据') || !preview.revisedBody?.includes('蓝牙单连') || !preview.revisedBody?.includes('saved=true')) throw new Error('Skill 试跑稿未通过关键事实检查');
  if (article.history.some(entry => entry.summary === '使用自定义四级证据 Skill 整理，并与一手复盘逐项核对')) {
    console.log(JSON.stringify({ archivedPath: article.archivedPath, alreadyFinalized: true })); return;
  }
  const source = library.list().find(material => material.title === '第二课 EasyInput 实操复盘原文');
  if (!source) throw new Error('一手复盘材料未入库');
  let topic = library.list().find(material => material.type === 'generated' && material.source === `作品 ${id} · 选题卡`);
  if (!topic) topic = library.addText({ type: 'generated', title: 'AI 搜集：四级证据选题卡', category: 'AI 搜集', content: article.topicCard, source: `作品 ${id} · 选题卡`, storeMarkdown: true });
  const needsConfirmation = [
    '核对原始编译、烧录和 App 保存回执记录，确认版本、镜像大小与日志表述。',
    '补齐实体按键演示时的连接方式、按键编号、目标应用、电脑环境和视频或截图，并检查演示画面是否可公开。',
    '若进一步写入 UUID 协议细节或双连接去重，补充对应源码位置；目前仅作为设计约定。',
    '对外发布前核对课程第二课“方式②”的正式名称与表述。'
  ];
  article = store.save({ ...article,
    draft: preview.revisedBody,
    reviewNotes: `${article.reviewNotes}\n\n自定义 Skill 试跑：使用“AI 硬件四级证据写作”再次整理，并与第二课一手复盘核对方式②、源码标签、镜像大小、COM10、HID、saved=true 和设计约定。保留待核实清单；本次核对由助手执行，尚未标记为用户审稿。\n\n${preview.reviewNotes}`,
    needsConfirmation,
    materialIds: [...new Set([...(article.materialIds || []), source.id, topic.id])],
    recordEvent: { stage: 'organize', summary: '使用自定义四级证据 Skill 整理，并与一手复盘逐项核对' }
  });
  const references = article.materialIds.map(materialId => library.get(materialId));
  article = store.archive(id, references);
  console.log(JSON.stringify({ archivedPath: article.archivedPath, status: article.needsConfirmation.length ? '待核实' : '初稿', references: references.length, draftLength: article.draft.length, reviewedAt: article.reviewedAt }));
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
