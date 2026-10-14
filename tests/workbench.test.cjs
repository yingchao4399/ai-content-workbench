const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStore } = require('../lib/store.cjs');
const { runStage, buildPrompt, limitContinuations } = require('../lib/agent.cjs');
const { readSettings, publicSettings, saveSettings, saveCapability, capabilityCredentials } = require('../lib/settings.cjs');
const { listModels, parseZhipuModels } = require('../lib/providers.cjs');
const { createMaterialStore } = require('../lib/materials.cjs');
const { transcribeChunk } = require('../lib/transcription.cjs');
const { understandMedia, responseText } = require('../lib/multimodal.cjs');
const { saveDraft, setInstalled, packageSkill, importSkill, listCustomSkills } = require('../lib/skill-studio.cjs');

const appRoot = path.resolve(__dirname, '..');
function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-test-')); }

test('作品保存、归档和待核实状态形成完整本地记录', () => {
  const root = tempDir();
  try {
    const store = createStore(root);
    const created = store.create('wechat');
    const saved = store.save({ ...created, title: '真实案例', draft: '正文', topicCard: '选题卡', needsConfirmation: ['待核实连接方式'], recordEvent: { stage: 'manual', summary: '人工修改' } });
    const archived = store.archive(saved.id);
    assert.equal(store.list().length, 1);
    assert.equal(archived.needsConfirmation.length, 1);
    assert.match(fs.readFileSync(archived.archivedPath, 'utf8'), /状态：待核实/);
    assert.match(fs.readFileSync(archived.archivedPath, 'utf8'), /人工修改|正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('作品移入回收站后可恢复，正文与归档文件保留', () => {
  const root = tempDir();
  try {
    const store = createStore(root);
    const item = store.create('note');
    store.save({ ...item, title: '待恢复笔记', draft: '保留正文' });
    const archived = store.archive(item.id);
    store.trash(item.id);
    assert.equal(store.list().length, 0);
    assert.equal(store.listTrash()[0].draft, '保留正文');
    assert.ok(fs.existsSync(archived.archivedPath));
    const restored = store.restore(item.id);
    assert.equal(restored.title, '待恢复笔记');
    assert.equal(store.listTrash().length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('五种文体和三类动作都有可读规则', () => {
  for (const mode of ['note', 'wechat', 'fiction', 'poetry', 'essay']) {
    for (const stage of ['collect', 'continue', 'organize']) {
      const prompt = buildPrompt({ mode, title: '题目', idea: '想法', materials: '', topicCard: '', draft: '' }, stage, {}, appRoot);
      assert.match(prompt, /用户保留最终编辑权/);
      assert.ok(prompt.length > 250);
    }
  }
});

test('API 密钥经加密接口存储，公开设置不含密钥', () => {
  const root = tempDir();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`wrapped:${text}`), decryptString: bytes => bytes.toString().slice(8) };
  try {
    saveSettings(root, { provider: 'api', baseUrl: 'http://localhost:9999/v1', model: 'local-test', apiKey: 'secret-test-key' }, safeStorage);
    assert.equal(publicSettings(root).apiProfiles.custom.hasApiKey, true);
    assert.equal(publicSettings(root).apiProfiles.custom.encryptedKey, undefined);
    assert.equal(readSettings(root).provider, 'custom');
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), /secret-test-key/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('可选 Skill 仅在勾选且文体匹配时进入提示词', () => {
  const base = { mode: 'wechat', title: '产品复盘', idea: '', materials: '', topicCard: '', draft: '' };
  assert.doesNotMatch(buildPrompt(base, 'collect', {}, appRoot), /公众号证据审稿（根据来源独立改写）/);
  assert.match(buildPrompt({ ...base, optionalSkills: ['wechat-evidence'] }, 'collect', {}, appRoot), /公众号证据审稿（根据来源独立改写）/);
  assert.doesNotMatch(buildPrompt({ ...base, optionalSkills: ['fiction-continuity'] }, 'collect', {}, appRoot), /小说人物与连续性（根据来源独立改写）/);
});

test('官方模型列表解析 DeepSeek、千问与智谱文档', async () => {
  const fake = async url => ({ ok: true, json: async () => url.includes('/api/v1/models') ? { output: { models: [{ model: 'qwen-a' }], total: 1 } } : { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] } });
  assert.deepEqual((await listModels('deepseek', { baseUrl: 'https://api.deepseek.com' }, 'key', fake)).models, ['deepseek-flash', 'deepseek-v4-pro']);
  assert.deepEqual((await listModels('qwen', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, 'key', fake)).models, ['qwen-a']);
  assert.deepEqual(parseZhipuModels('            - glm-5.3\n            - glm-4.7-flash\n            - other'), ['glm-5.3', 'glm-4.7-flash']);
});

test('材料库保存原文、链接、分类和 Markdown 副本', async () => {
  const root = tempDir();
  try {
    const store = createMaterialStore(root);
    const text = store.addText({ title: '观察', category: '笔记', content: '原文内容', storeMarkdown: true });
    assert.match(fs.readFileSync(text.markdownPath, 'utf8'), /原文内容/);
    const link = await store.addLink({ url: 'https://example.com/article', category: '公众号', content: '用户粘贴的原文' });
    assert.equal(link.url, 'https://example.com/article');
    assert.equal(link.content, '用户粘贴的原文');
    assert.equal(store.list().length, 2);
    assert.equal(store.update(text.id, { summary: '摘要' }).summary, '摘要');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('语音分段调用千问官方兼容接口并读取逐字稿', async () => {
  const root = tempDir();
  try {
    const file = path.join(root, 'part.mp3'); fs.writeFileSync(file, 'fake audio');
    const fake = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'qwen3-asr-flash');
      assert.match(body.messages[0].content[0].input_audio.data, /^data:audio\/mpeg;base64,/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '这是一段转录' } }] }) };
    };
    assert.equal(await transcribeChunk(file, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'key' }, fake), '这是一段转录');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('兼容 API 能完成一次搜集并校验结构化结果', async () => {
  const root = tempDir();
  const store = createStore(root);
  const item = store.create('wechat');
  store.save({ ...item, idea: '真实项目复盘' });
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestedTitle: '复盘', topicCard: '真实材料', missingInfo: [] }) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const result = await runStage(store, item.id, 'collect', { provider: 'api', ai: { apiKey: 'test', model: 'local', baseUrl: `http://127.0.0.1:${port}/v1` } }, appRoot);
    assert.equal(result.topicCard, '真实材料');
  } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('续写设置保存并隔离多模态模型和加密密钥', () => {
  const root = tempDir();
  const safe = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`wrapped:${text}`), decryptString: bytes => bytes.toString().slice(8) };
  try {
    saveSettings(root, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'text-key', slashContext: 'all_before', continuation: { characters: 180, paragraphs: 2, perParagraph: 90 } }, safe);
    saveCapability(root, 'image', { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'vision-key' }, safe);
    assert.deepEqual(publicSettings(root).continuation, { characters: 180, paragraphs: 2, perParagraph: 90 });
    assert.equal(publicSettings(root).slashContext, 'all_before');
    assert.equal(capabilityCredentials(root, 'image', safe).apiKey, 'vision-key');
    assert.equal(publicSettings(root).capabilities.image.hasOwnKey, true);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), /vision-key|text-key/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('斜杠续写按设置限定前文，选区续写保留选中锚点，三个版本受字数上限约束', () => {
  const item = { mode: 'note', title: '测试', idea: '', materials: '', topicCard: '', draft: '最早段\n最后一段' };
  const context = { origin: 'slash', targetField: 'draft', prefix: item.draft, suffix: '', slashContext: 'paragraph', continuation: { characters: 80, paragraphs: 2, perParagraph: 40 } };
  const paragraph = buildPrompt(item, 'continue', context, appRoot);
  assert.match(paragraph, /"prefix":"最后一段"/);
  assert.doesNotMatch(paragraph, /最早段/);
  const full = buildPrompt(item, 'continue', { ...context, slashContext: 'all_before' }, appRoot);
  assert.match(full, /最早段/);
  assert.match(buildPrompt(item, 'continue', { origin: 'selection', prefix: '前文被选', selection: '被选' }, appRoot), /选区末尾/);
  const limited = limitContinuations({ continuations: ['一'.repeat(70), '二'.repeat(70), '三'.repeat(70)] }, { characters: 50, paragraphs: 1, perParagraph: 40 });
  assert.deepEqual(limited.continuations.map(text => text.length), [40, 40, 40]);
});

test('图片理解以本地图片请求兼容接口，千问流式文本可解析', async () => {
  const root = tempDir();
  try {
    const file = path.join(root, 'sample.jpg');
    const { runFfmpeg } = require('../lib/transcription.cjs');
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', file]);
    const fake = async (_url, init) => {
      const input = JSON.parse(init.body);
      assert.equal(input.model, 'deepseek-flash');
      assert.match(input.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '画面为红色' } }] }) };
    };
    const result = await understandMedia({ assetPath: file, content: '' }, 'image', { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'test', model: 'deepseek-flash' }, fake);
    assert.equal(result, '画面为红色');
    assert.equal(responseText('data: {"choices":[{"delta":{"content":"音频"}}]}\n\ndata: {"choices":[{"delta":{"content":"内容"}}]}\n\ndata: [DONE]'), '音频内容');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('自定义 Skill 可设计、安装、用于作品、打包与导入', () => {
  const root = tempDir(), another = tempDir();
  try {
    const design = { name: 'wechat-source-check', title: '来源核对', description: '写公众号文章时检查事实与来源，仅用于审稿。', modes: ['wechat'], body: '# 目标\n核对公众号文章中的事实陈述和来源。\n\n## 方法\n逐条对应素材原文，对没有来源的说法标注待核实；保留作者最终修改权，不编造引用。\n\n## 输出\n给出可追溯的改写建议和待核实清单。', testInput: '一段带来源的公众号初稿', expected: '没有来源的事实被标记为待核实' };
    const draft = saveDraft(root, design);
    assert.equal(draft.status, 'draft');
    const store = createStore(root);
    const article = store.create('wechat');
    assert.deepEqual(store.save({ ...article, optionalSkills: [draft.id] }).optionalSkills, []);
    setInstalled(root, draft.id, true);
    const selected = store.save({ ...article, optionalSkills: [draft.id] });
    assert.deepEqual(selected.optionalSkills, [draft.id]);
    assert.match(buildPrompt(selected, 'organize', {}, appRoot, root), /逐条对应素材原文/);
    const zip = path.join(root, 'skill.zip'); packageSkill(root, draft.id, zip);
    const imported = importSkill(another, zip);
    assert.equal(imported.name, design.name);
    assert.equal(imported.status, 'draft');
    assert.equal(listCustomSkills(another).length, 1);
    setInstalled(root, draft.id, false);
    assert.doesNotMatch(buildPrompt(selected, 'organize', {}, appRoot, root), /逐条对应素材原文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(another, { recursive: true, force: true }); }
});
