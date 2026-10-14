const fs = require('node:fs');
const path = require('node:path');
const { listCustomSkills } = require('./skill-studio.cjs');
const root = path.join(__dirname, '..', 'skills');
const CATALOG = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const BY_ID = new Map(CATALOG.map(skill => [skill.id, skill]));
function publicCatalog(customRoot) {
  const builtIn = CATALOG.map(({ file, ...rest }) => ({ ...rest, kind: 'built-in' }));
  const custom = customRoot ? listCustomSkills(customRoot).filter(item => item.status === 'installed').map(({ id, title, summary, modes, source }) => ({ id, title, summary, modes, source, kind: 'custom' })) : [];
  return [...builtIn, ...custom];
}
function validSkills(value, mode, customRoot) {
  if (!Array.isArray(value)) return [];
  const custom = customRoot ? new Map(listCustomSkills(customRoot).filter(item => item.status === 'installed').map(item => [item.id, item])) : new Map();
  return [...new Set(value)].filter(id => BY_ID.get(id)?.modes.includes(mode) || custom.get(id)?.modes.includes(mode)).slice(0, 20);
}
function skillRules(item, customRoot) {
  const custom = customRoot ? new Map(listCustomSkills(customRoot).filter(entry => entry.status === 'installed').map(entry => [entry.id, entry])) : new Map();
  return validSkills(item.optionalSkills, item.mode, customRoot).map(id => {
    const skill = BY_ID.get(id);
    return skill ? `${skill.title}：\n${fs.readFileSync(path.join(root, 'optional', skill.file), 'utf8')}` : `${custom.get(id).title}：\n${custom.get(id).body}`;
  });
}
module.exports = { publicCatalog, validSkills, skillRules };
