const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { runStage } = require('../lib/agent.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const store = createStore(path.join(root, 'data'));
  let item = store.list().find(x => x.title.startsWith('AI 产品经理做 AI 硬件'));
  if (!item) throw new Error('没有找到首轮实测文章');
  item = store.save({ ...item,
    needsConfirmation: [
      '核对原始编译、烧录和 App 保存回执记录，确认版本、镜像大小与日志表述。',
      '补齐实体按键演示时的连接方式、按键编号、目标应用、电脑环境和视频或截图。',
      '若进一步写入 UUID 协议细节或双连接去重，补充对应源码位置；目前仅作为设计约定。'
    ],
    reviewNotes: `${item.reviewNotes}\n\n第一次试跑复核：正文与第二课记录相符；待核实清单 8 项语义重复，已人工合并为 3 项。后续应核对原始日志和实体演示资料，暂不标记为用户已审稿。`,
    recordEvent: { stage: 'manual', summary: '复核首轮文章并合并重复待核实事项；修改三个 Skill 的去重规则' }
  });
  const output = await runStage(store, item.id, 'organize', {}, root);
  item = store.save({ ...item, draft: output.revisedBody,
    reviewNotes: `${item.reviewNotes}\n\n第二次整理：${output.reviewNotes}`,
    needsConfirmation: [...new Set([...item.needsConfirmation, ...output.needsConfirmation])],
    recordEvent: { stage: 'organize', summary: '按收紧后的 Skill 再整理全文，检查新增待核实项' }
  });
  console.log('item', item.id, 'draftLength', item.draft.length, 'confirmationCount', item.needsConfirmation.length, 'newConfirmationCount', output.needsConfirmation.length);
  console.log('newConfirmation', JSON.stringify(output.needsConfirmation));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
