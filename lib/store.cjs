const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validSkills } = require('./optional-skills.cjs');

const MODES = Object.freeze(['note', 'wechat', 'fiction', 'poetry', 'essay']);
const TEXT_FIELDS = ['title', 'idea', 'materials', 'topicCard', 'draft', 'reviewNotes'];
const MAX_TEXT = 200000;

function assertId(id) {
  if (typeof id !== 'string' || !/^[0-9]{8}T[0-9]{6}-[a-f0-9]{8}$/.test(id)) {
    throw new Error('无效的作品编号');
  }
  return id;
}

function newId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  return `${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function cleanText(value) {
  const text = typeof value === 'string' ? value : '';
  if (text.length > MAX_TEXT) throw new Error('单个文本字段超过长度限制');
  return text;
}

function cleanItem(value, previous = null, customRoot = null) {
  if (!value || typeof value !== 'object') throw new Error('作品数据无效');
  const mode = MODES.includes(value.mode) ? value.mode : previous?.mode;
  if (!mode) throw new Error('请选择创作类型');
  const id = previous ? previous.id : assertId(value.id);
  const now = new Date().toISOString();
  const item = {
    id, mode,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    reviewedAt: value.markReviewed === true ? now : (previous?.reviewedAt || null),
    archivedPath: previous?.archivedPath || null,
    optionalSkills: validSkills(value.optionalSkills || previous?.optionalSkills, mode, customRoot),
    materialIds: Array.isArray(value.materialIds) ? [...new Set(value.materialIds.filter(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)))].slice(0, 100) : (previous?.materialIds || []),
    aiEdits: Array.isArray(value.aiEdits) ? value.aiEdits.slice(-30).map(entry => ({
      stage: ['collect', 'continue', 'organize', 'manual'].includes(entry.stage) ? entry.stage : 'continue',
      kind: entry.kind === 'manual' ? 'manual' : 'ai',
      field: TEXT_FIELDS.includes(entry.field) ? entry.field : 'draft',
      inputType: String(entry.inputType || '').slice(0, 60),
      insertedText: String(entry.insertedText || '').slice(0, 50000),
      deletedText: String(entry.deletedText || '').slice(0, 50000),
      at: String(entry.at || now).slice(0, 40),
      before: cleanAiState(entry.before), after: cleanAiState(entry.after)
    })) : (previous?.aiEdits || []),
    aiEditCursor: 0,
    lastAiStage: ['collect', 'continue', 'organize'].includes(value.lastAiStage) ? value.lastAiStage : (previous?.lastAiStage || null),
    needsConfirmation: Array.isArray(value.needsConfirmation)
      ? value.needsConfirmation.slice(0, 50).map(cleanText)
      : (Array.isArray(previous?.needsConfirmation) ? previous.needsConfirmation : []),
    history: Array.isArray(previous?.history) ? [...previous.history] : []
  };
  item.aiEditCursor = Math.max(0, Math.min(Number.isInteger(value.aiEditCursor) ? value.aiEditCursor : (previous?.aiEditCursor || 0), item.aiEdits.length));
  if (value.recordEvent && typeof value.recordEvent === 'object') {
    const stage = String(value.recordEvent.stage || 'edit');
    if (['collect', 'continue', 'organize', 'manual'].includes(stage)) {
      item.history.push({ at: now, stage, summary: cleanText(value.recordEvent.summary).slice(0, 500) });
    }
  }
  for (const field of TEXT_FIELDS) item[field] = cleanText(value[field]);
  return item;
}
function cleanAiState(value) {
  const data = value && typeof value === 'object' ? value : {};
  const state = {};
  for (const field of TEXT_FIELDS) state[field] = cleanText(data[field]);
  state.needsConfirmation = Array.isArray(data.needsConfirmation) ? data.needsConfirmation.slice(0, 50).map(cleanText) : [];
  state.materialIds = Array.isArray(data.materialIds) ? data.materialIds.filter(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)).slice(0, 100) : [];
  return state;
}

function itemPath(root, id) {
  return path.join(root, 'items', `${assertId(id)}.json`);
}
function trashPath(root, id) {
  return path.join(root, 'trash', `${assertId(id)}.json`);
}

function atomicJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function createStore(root) {
  fs.mkdirSync(path.join(root, 'items'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(root, 'trash'), { recursive: true });
  return {
    root,
    list() {
      return fs.readdirSync(path.join(root, 'items'))
        .filter(name => /^[0-9]{8}T[0-9]{6}-[a-f0-9]{8}\.json$/.test(name))
        .map(name => JSON.parse(fs.readFileSync(path.join(root, 'items', name), 'utf8')))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get(id) {
      const file = itemPath(root, id);
      if (!fs.existsSync(file)) throw new Error('作品不存在');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    listTrash() {
      return fs.readdirSync(path.join(root, 'trash'))
        .filter(name => /^[0-9]{8}T[0-9]{6}-[a-f0-9]{8}\.json$/.test(name))
        .map(name => {
          const file = path.join(root, 'trash', name);
          return { ...JSON.parse(fs.readFileSync(file, 'utf8')), deletedAt: fs.statSync(file).mtime.toISOString() };
        })
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    },
    trash(id) {
      const from = itemPath(root, id), to = trashPath(root, id);
      if (!fs.existsSync(from)) throw new Error('作品不存在');
      if (fs.existsSync(to)) throw new Error('回收站中已有同编号作品');
      fs.renameSync(from, to);
      const now = new Date(); fs.utimesSync(to, now, now);
      return { id, deletedAt: now.toISOString() };
    },
    restore(id) {
      const from = trashPath(root, id), to = itemPath(root, id);
      if (!fs.existsSync(from)) throw new Error('回收站中没有此作品');
      if (fs.existsSync(to)) throw new Error('当前作品中已有同编号作品');
      fs.renameSync(from, to);
      return this.get(id);
    },
    create(mode) {
      if (!MODES.includes(mode)) throw new Error('创作类型无效');
      const item = cleanItem({ id: newId(), mode }, null, root);
      atomicJsonWrite(itemPath(root, item.id), item);
      return item;
    },
    save(value) {
      const previous = this.get(value.id);
      const item = cleanItem(value, previous, root);
      atomicJsonWrite(itemPath(root, item.id), item);
      return item;
    },
    update(id, update) {
      const previous = this.get(id);
      const item = { ...previous, ...update, updatedAt: new Date().toISOString() };
      atomicJsonWrite(itemPath(root, id), item);
      return item;
    },
    archive(id, referencedMaterials = []) {
      const item = this.get(id);
      if (!item.draft.trim()) throw new Error('还没有可归档的稿件');
      const month = new Date().toISOString().slice(0, 7);
      const dir = path.join(root, 'archive', month);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${item.id}.md`);
      const status = item.needsConfirmation.length ? '待核实' : (item.reviewedAt ? '已审稿' : '初稿');
      const body = `# ${item.title.trim() || '未命名作品'}\n\n` +
        `> 类型：${item.mode} ｜ 状态：${status} ｜ 归档时间：${new Date().toISOString()}\n\n` +
        `${item.draft.trim()}\n\n---\n\n## 选题卡\n\n${item.topicCard.trim() || '未填写'}\n\n` +
        `## 审稿记录\n\n${item.reviewNotes.trim() || '未审稿'}\n\n` +
        `## 待核实\n\n${item.needsConfirmation.length ? item.needsConfirmation.map(x => `- ${x}`).join('\n') : '无'}\n\n` +
        `## 引用材料\n\n${referencedMaterials.length ? referencedMaterials.map(x => `- ${x.title}｜${x.url || x.originalName || x.source || x.id}`).join('\n') : '无'}\n`;
      fs.writeFileSync(file, body, 'utf8');
      return this.update(id, { archivedPath: file });
    }
  };
}

module.exports = { createStore, MODES, cleanItem, assertId };
