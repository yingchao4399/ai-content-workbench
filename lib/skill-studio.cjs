const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const YAML = require('yaml');

const MODES = ['note', 'wechat', 'fiction', 'poetry', 'essay'];
function skillDir(root, name) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name) || name.endsWith('-') || name.includes('--')) throw new Error('Skill 名称需为 2–63 位小写英文、数字和连字符，以字母开头');
  return path.join(root, 'skills', name);
}
function parseSkillMarkdown(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md 缺少 YAML 头部（--- 包围的 name 与 description）');
  let head;
  try { head = YAML.parse(match[1]); } catch (error) { throw new Error(`Skill YAML 无效：${error.message}`); }
  if (!head || typeof head !== 'object') throw new Error('Skill YAML 头部无效');
  return { name: String(head.name || ''), description: String(head.description || ''), body: match[2].trim() };
}
function validateSkill(input) {
  const errors = [], warnings = [];
  try { skillDir('/tmp', input.name); } catch (error) { errors.push(error.message); }
  if (!String(input.description || '').trim() || String(input.description).length > 500) errors.push('描述需要写清用途与触发场景，长度不超过 500 字');
  if (String(input.body || '').trim().length < 60) errors.push('正文至少 60 字，说明任务边界、处理方法和输出');
  if (String(input.body || '').length > 50000) errors.push('正文最多 5 万字');
  const modes = Array.isArray(input.modes) ? input.modes.filter(x => MODES.includes(x)) : [];
  if (!modes.length) errors.push('至少选择一种适用文体');
  if (/TODO|TBD|待填写|\[在此填写/.test(input.body || '')) warnings.push('正文仍有占位内容，安装前请检查');
  if (!String(input.testInput || '').trim()) warnings.push('尚未填写试用场景；建议用真实作品验证效果');
  if (!String(input.expected || '').trim()) warnings.push('尚未填写预期结果；建议先定义检查标准');
  return { ok: errors.length === 0, errors, warnings };
}
function markdownFor(input) {
  const header = YAML.stringify({ name: input.name, description: input.description.trim() }).trim();
  return `---\n${header}\n---\n\n${String(input.body || '').trim()}\n`;
}
function listCustomSkills(root) {
  const parent = path.join(root, 'skills');
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^[a-z][a-z0-9-]{1,62}$/.test(entry.name)).flatMap(entry => {
    try {
      const dir = skillDir(root, entry.name);
      const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      const parsed = parseSkillMarkdown(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      return [{ id: `custom:${entry.name}`, name: entry.name, title: metadata.title || entry.name, summary: parsed.description, description: parsed.description, body: parsed.body, modes: metadata.modes.filter(mode => MODES.includes(mode)), status: metadata.status === 'installed' ? 'installed' : 'draft', testInput: metadata.testInput || '', expected: metadata.expected || '', source: metadata.source || '', updatedAt: metadata.updatedAt || '' }];
    } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function getCustomSkill(root, id) {
  const name = String(id || '').startsWith('custom:') ? id.slice(7) : id;
  const item = listCustomSkills(root).find(entry => entry.name === name);
  if (!item) throw new Error('Skill 不存在');
  return item;
}
function saveDraft(root, input, options = {}) {
  const data = { ...input, name: String(input.name || '').trim(), description: String(input.description || '').trim(), body: String(input.body || '').trim(), title: String(input.title || input.name || '').trim().slice(0, 120), modes: [...new Set((input.modes || []).filter(mode => MODES.includes(mode)))], testInput: String(input.testInput || '').slice(0, 2000), expected: String(input.expected || '').slice(0, 2000), source: String(input.source || '').slice(0, 500) };
  const validation = validateSkill(data);
  if (!validation.ok) throw new Error(validation.errors.join('；'));
  const dir = skillDir(root, data.name);
  if (options.createOnly && fs.existsSync(dir)) throw new Error('同名 Skill 已存在，请修改名称后导入');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), markdownFor(data), 'utf8');
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ title: data.title, modes: data.modes, status: 'draft', testInput: data.testInput, expected: data.expected, source: data.source, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  return getCustomSkill(root, data.name);
}
function setInstalled(root, id, installed) {
  const current = getCustomSkill(root, id);
  if (installed) {
    const validation = validateSkill(current);
    if (!validation.ok) throw new Error(validation.errors.join('；'));
  }
  const file = path.join(skillDir(root, current.name), 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  metadata.status = installed ? 'installed' : 'draft'; metadata.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(metadata, null, 2), 'utf8');
  return getCustomSkill(root, id);
}
function packageSkill(root, id, outputFile) {
  const item = getCustomSkill(root, id);
  const validation = validateSkill(item);
  if (!validation.ok) throw new Error(validation.errors.join('；'));
  const zip = new AdmZip();
  const prefix = `${item.name}/`;
  zip.addFile(`${prefix}SKILL.md`, Buffer.from(markdownFor(item), 'utf8'));
  zip.addFile(`${prefix}metadata.json`, Buffer.from(JSON.stringify({ title: item.title, modes: item.modes, testInput: item.testInput, expected: item.expected, source: item.source }, null, 2), 'utf8'));
  zip.writeZip(outputFile);
  return outputFile;
}
function importSkill(root, file) {
  if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Skill 包需小于 5 MB');
  let markdown, metadata = {};
  if (path.extname(file).toLowerCase() === '.zip') {
    const zip = new AdmZip(file);
    const entries = zip.getEntries();
    const skill = entries.find(entry => !entry.isDirectory && /(^|\/)SKILL\.md$/i.test(entry.entryName) && !entry.entryName.includes('..'));
    if (!skill) throw new Error('ZIP 包中未找到 SKILL.md');
    if (skill.header.size > 1024 * 1024) throw new Error('SKILL.md 文件过大');
    markdown = skill.getData().toString('utf8');
    const prefix = skill.entryName.slice(0, -'SKILL.md'.length);
    const meta = entries.find(entry => entry.entryName === `${prefix}metadata.json`);
    if (meta && meta.header.size <= 20000) { try { metadata = JSON.parse(meta.getData().toString('utf8')); } catch {} }
  } else if (path.extname(file).toLowerCase() === '.md') markdown = fs.readFileSync(file, 'utf8');
  else throw new Error('请选择 .zip Skill 包或 SKILL.md');
  const parsed = parseSkillMarkdown(markdown);
  const modes = Array.isArray(metadata.modes) ? metadata.modes : MODES;
  return saveDraft(root, { ...parsed, title: metadata.title || parsed.name, modes, testInput: metadata.testInput || '', expected: metadata.expected || '', source: metadata.source || file }, { createOnly: true });
}
module.exports = { MODES, validateSkill, parseSkillMarkdown, markdownFor, listCustomSkills, getCustomSkill, saveDraft, setInstalled, packageSkill, importSkill };
