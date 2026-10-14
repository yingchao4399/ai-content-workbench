const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { PROVIDERS, validateBaseUrl } = require('./providers.cjs');

const KEY_ACTIONS = ['collect', 'continue', 'organize', 'undo_ai', 'redo_ai', 'repeat_ai', 'new_note', 'new_wechat', 'new_fiction', 'new_poetry', 'new_essay', 'archive', 'settings', 'keep'];
const DEFAULT_ACTIONS = ['collect', 'continue', 'organize', 'new_note', 'new_wechat', 'new_fiction', 'new_poetry', 'new_essay'];
const DEFAULTS = { provider: 'codex', slashContext: 'paragraph', continuation: { characters: 300, paragraphs: 3, perParagraph: 100 }, keyActions: DEFAULT_ACTIONS };
function continuationOptions(value) {
  const input = value && typeof value === 'object' ? value : {};
  const bounded = (number, fallback, min, max) => Number.isInteger(Number(number)) ? Math.max(min, Math.min(max, Number(number))) : fallback;
  return { characters: bounded(input.characters, 300, 50, 3000), paragraphs: bounded(input.paragraphs, 3, 1, 12), perParagraph: bounded(input.perParagraph, 100, 20, 800) };
}
const CAPABILITY_DEFAULTS = Object.freeze({
  image: { provider: 'deepseek', model: 'deepseek-flash' },
  video: { provider: 'qwen', model: 'qwen3.8-omni-flash' },
  audio: { provider: 'qwen', model: 'qwen3.8-omni-flash' },
  transcription: { provider: 'qwen', model: 'qwen3-asr-flash' }
});
const HOTKEYS = Array.from({ length: 8 }, (_, i) => `Ctrl+Alt+Shift+${i + 1}`);

function settingsFile(root) { return path.join(root, 'settings.json'); }
function readSettings(root) {
  const file = settingsFile(root);
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const profiles = Object.fromEntries(Object.entries(PROVIDERS).map(([id, value]) => [id, { baseUrl: value.baseUrl, model: '', ...(saved.apiProfiles?.[id] || {}) }]));
  const capabilities = Object.fromEntries(Object.entries(CAPABILITY_DEFAULTS).map(([id, value]) => [id, { ...value, ...(saved.capabilities?.[id] || {}) }]));
  if (saved.baseUrl || saved.encryptedKey || saved.model) profiles.custom = { ...profiles.custom, baseUrl: saved.baseUrl || profiles.custom.baseUrl, model: saved.model || '', encryptedKey: saved.encryptedKey };
  return { ...DEFAULTS, ...saved, provider: saved.provider === 'api' ? 'custom' : (saved.provider || 'codex'), slashContext: saved.slashContext === 'all_before' ? 'all_before' : 'paragraph', continuation: continuationOptions(saved.continuation), apiProfiles: profiles, capabilities };
}
function publicSettings(root) {
  const settings = readSettings(root);
  const apiProfiles = Object.fromEntries(Object.entries(settings.apiProfiles).map(([id, profile]) => [id, { baseUrl: profile.baseUrl, model: profile.model, hasApiKey: Boolean(profile.encryptedKey) }]));
  const capabilities = Object.fromEntries(Object.entries(settings.capabilities).map(([id, item]) => [id, { provider: item.provider, model: item.model, baseUrl: item.baseUrl || settings.apiProfiles[item.provider]?.baseUrl, hasOwnKey: Boolean(item.encryptedKey), hasSharedKey: Boolean(settings.apiProfiles[item.provider]?.encryptedKey) }]));
  return { provider: settings.provider, slashContext: settings.slashContext, continuation: settings.continuation, apiProfiles, capabilities, keyActions: settings.keyActions };
}
function saveSettings(root, input, safeStorage) {
  const previous = readSettings(root);
  const provider = input.provider === 'api' ? 'custom' : input.provider;
  if (provider !== 'codex' && !PROVIDERS[provider]) throw new Error('未知 AI 服务商');
  const next = { provider, slashContext: input.slashContext === 'all_before' ? 'all_before' : 'paragraph', continuation: continuationOptions(input.continuation || previous.continuation), keyActions: previous.keyActions, apiProfiles: previous.apiProfiles, capabilities: previous.capabilities };
  if (provider !== 'codex') {
    const profile = { ...previous.apiProfiles[provider], baseUrl: validateBaseUrl(input.baseUrl || PROVIDERS[provider].baseUrl), model: String(input.model || '').trim().slice(0, 100) };
    if (input.clearApiKey) delete profile.encryptedKey;
    if (String(input.apiKey || '').trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，无法安全保存 API 密钥');
      profile.encryptedKey = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
    }
    next.apiProfiles = { ...previous.apiProfiles, [provider]: profile };
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(settingsFile(root), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return publicSettings(root);
}
function saveCapability(root, id, input, safeStorage) {
  if (!CAPABILITY_DEFAULTS[id]) throw new Error('未知多模态能力');
  if (!PROVIDERS[input.provider]) throw new Error('未知 AI 服务商');
  const settings = readSettings(root);
  const current = settings.capabilities[id];
  const next = { ...current, provider: input.provider, baseUrl: validateBaseUrl(input.baseUrl || settings.apiProfiles[input.provider]?.baseUrl || PROVIDERS[input.provider].baseUrl), model: String(input.model || '').trim().slice(0, 100) };
  if (current.provider !== input.provider) delete next.encryptedKey;
  if (input.clearApiKey) delete next.encryptedKey;
  if (String(input.apiKey || '').trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用');
    next.encryptedKey = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
  }
  settings.capabilities[id] = next;
  const persist = { provider: settings.provider, slashContext: settings.slashContext, continuation: settings.continuation, keyActions: settings.keyActions, apiProfiles: settings.apiProfiles, capabilities: settings.capabilities };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(settingsFile(root), JSON.stringify(persist, null, 2), 'utf8');
  return publicSettings(root).capabilities[id];
}
function capabilityCredentials(root, id, safeStorage) {
  if (!CAPABILITY_DEFAULTS[id]) throw new Error('未知多模态能力');
  const settings = readSettings(root);
  const config = settings.capabilities[id];
  const encrypted = config.encryptedKey || settings.apiProfiles[config.provider]?.encryptedKey;
  if (!encrypted) throw new Error(`请先配置${config.provider}服务商的 API 密钥，或为此能力单独填写密钥`);
  if (!config.model) throw new Error('请先选择该能力使用的模型');
  return { provider: config.provider, baseUrl: validateBaseUrl(config.baseUrl || settings.apiProfiles[config.provider].baseUrl), model: config.model, apiKey: safeStorage.decryptString(Buffer.from(encrypted, 'base64')) };
}
function capabilityModelCredentials(root, id, input, safeStorage) {
  if (!CAPABILITY_DEFAULTS[id]) throw new Error('未知多模态能力');
  const settings = readSettings(root);
  const config = settings.capabilities[id];
  const provider = input?.provider || config.provider;
  if (!PROVIDERS[provider]) throw new Error('未知 AI 服务商');
  const encrypted = config.provider === provider ? config.encryptedKey : null;
  const shared = settings.apiProfiles[provider]?.encryptedKey;
  return { provider, baseUrl: validateBaseUrl(input?.baseUrl || (provider === config.provider ? config.baseUrl : settings.apiProfiles[provider].baseUrl) || PROVIDERS[provider].baseUrl), apiKey: String(input?.apiKey || '').trim() || (encrypted || shared ? safeStorage.decryptString(Buffer.from(encrypted || shared, 'base64')) : '') };
}
function apiCredentials(root, safeStorage) {
  const settings = readSettings(root);
  const profile = settings.apiProfiles[settings.provider];
  if (!profile?.encryptedKey) throw new Error('还没有配置 API 密钥');
  if (!profile.model) throw new Error('还没有选择模型');
  return { baseUrl: profile.baseUrl, model: profile.model, apiKey: safeStorage.decryptString(Buffer.from(profile.encryptedKey, 'base64')) };
}
function modelListCredentials(root, provider, input, safeStorage) {
  if (!PROVIDERS[provider]) throw new Error('未知 AI 服务商');
  const profile = readSettings(root).apiProfiles[provider];
  return { baseUrl: validateBaseUrl(input?.baseUrl || profile.baseUrl), apiKey: String(input?.apiKey || '').trim() || (profile.encryptedKey ? safeStorage.decryptString(Buffer.from(profile.encryptedKey, 'base64')) : '') };
}
function easyInputConfigPath() {
  if (process.platform !== 'win32') return '';
  return path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Easy Input', 'config.json');
}
function isEasyInputRunning() {
  if (process.platform !== 'win32') return false;
  try { return /EasyInput\.exe/i.test(execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq EasyInput.exe'], { encoding: 'utf8', windowsHide: true })); }
  catch { return false; }
}
function isKeyboardPresent() {
  if (process.platform !== 'win32') return false;
  try {
    const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*EasyInput*' -and $_.Status -eq 'OK' }).Count"], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return Number(result.trim()) > 0;
  } catch { return false; }
}
function keyboardStatus(root, probe = true) {
  const file = easyInputConfigPath();
  const running = probe ? isEasyInputRunning() : null;
  const present = probe ? isKeyboardPresent() : null;
  if (!file || !fs.existsSync(file)) return { installed: false, present, running, enabled: false, bindings: [], keyActions: readSettings(root).keyActions };
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keyboard = config.ai_keyboard || {};
  const profile = (keyboard.profiles || []).find(p => p.id === 'default') || (keyboard.profiles || [])[0];
  const keyActions = readSettings(root).keyActions;
  const bindings = HOTKEYS.map((expected, index) => { const key = `KEY${index + 1}`; return { key, current: profile?.keys?.[key]?.press?.hotkey || profile?.keys?.[key]?.press || null, expected }; });
  return { installed: true, present, running, enabled: Boolean(keyboard.enabled), deviceName: String(keyboard.device_name || 'EasyInput AI'), bindings, keyActions,
    mapped: bindings.every((x, index) => keyActions[index] === 'keep' || x.current === x.expected) };
}
async function keyboardStatusAsync(root) {
  const status = keyboardStatus(root, false);
  if (process.platform !== 'win32') return { ...status, running: false, present: false };
  const command = "@(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*EasyInput*' -and $_.Status -eq 'OK' }).Count";
  const [processResult, deviceResult] = await Promise.allSettled([
    execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq EasyInput.exe'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }),
    execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  ]);
  return {
    ...status,
    running: processResult.status === 'fulfilled' && /EasyInput\.exe/i.test(processResult.value.stdout),
    present: deviceResult.status === 'fulfilled' && Number(deviceResult.value.stdout.trim()) > 0
  };
}
function applyKeyboardMapping(root, actions) {
  if (!Array.isArray(actions) || actions.length !== 8 || !actions.every(action => KEY_ACTIONS.includes(action))) {
    throw new Error('请为八个按键选择有效动作');
  }
  if (isEasyInputRunning()) throw new Error('请先退出 EasyInput 桌面程序，再写入按键配置，避免配置被覆盖');
  const file = easyInputConfigPath();
  if (!file || !fs.existsSync(file)) throw new Error('未找到 EasyInput 配置文件');
  const raw = fs.readFileSync(file, 'utf8');
  const config = JSON.parse(raw);
  const keyboard = config.ai_keyboard;
  const profile = keyboard?.profiles?.find(p => p.id === 'default') || keyboard?.profiles?.[0];
  if (!profile?.keys) throw new Error('EasyInput 配置中没有可用按键表');
  const before = HOTKEYS.map((_, index) => ({ key: `KEY${index + 1}`, previous: profile.keys[`KEY${index + 1}`]?.press || null }));
  const backup = `${file}.workbench-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backup, raw, 'utf8');
  actions.forEach((action, index) => { if (action !== 'keep') { const key = `KEY${index + 1}`; profile.keys[key] = { ...(profile.keys[key] || {}), press: { hotkey: HOTKEYS[index] } }; } });
  if (actions.some(action => action !== 'keep')) keyboard.enabled = true;
  const temp = `${file}.workbench-${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temp, file);
  const next = readSettings(root);
  next.keyActions = actions;
  fs.writeFileSync(settingsFile(root), JSON.stringify(next, null, 2), 'utf8');
  return { backup, before, status: keyboardStatus(root) };
}

module.exports = { readSettings, publicSettings, saveSettings, saveCapability, capabilityCredentials, capabilityModelCredentials, apiCredentials, modelListCredentials, keyboardStatus, keyboardStatusAsync, applyKeyboardMapping, HOTKEYS, KEY_ACTIONS, DEFAULT_ACTIONS, CAPABILITY_DEFAULTS, continuationOptions };
