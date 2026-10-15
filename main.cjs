const { app, BrowserWindow, ipcMain, globalShortcut, shell, safeStorage, dialog, clipboard } = require('electron');
const path = require('node:path');
const { createStore, MODES } = require('./lib/store.cjs');
const { runStage, runMaterialAI, designSkill } = require('./lib/agent.cjs');
const { createMaterialStore } = require('./lib/materials.cjs');
const { transcribeMedia } = require('./lib/transcription.cjs');
const { understandMedia } = require('./lib/multimodal.cjs');
const { readSettings, publicSettings, saveSettings, saveCapability, capabilityCredentials, capabilityModelCredentials, apiCredentials, modelListCredentials, keyboardStatus, keyboardStatusAsync, applyKeyboardMapping } = require('./lib/settings.cjs');
const { listModels } = require('./lib/providers.cjs');
const { publicCatalog } = require('./lib/optional-skills.cjs');
const { listCustomSkills, saveDraft, setInstalled, packageSkill, importSkill, validateSkill, markdownFor } = require('./lib/skill-studio.cjs');

let window;
let store;
let materials;
let running = false;
const shortcuts = Array.from({ length: 8 }, (_, i) => [`CommandOrControl+Alt+Shift+${i + 1}`, i]);
const lastShortcutEvent = new Map();

function dataRoot() {
  if (process.env.WORKBENCH_DATA_DIR) return path.resolve(process.env.WORKBENCH_DATA_DIR);
  return app.isPackaged
    ? path.join(app.getPath('documents'), 'AI内容工作台')
    : path.join(__dirname, 'data');
}

function makeWindow() {
  window = new BrowserWindow({
    width: 1420, height: 900, minWidth: 980, minHeight: 650,
    title: 'AI 内容工作台',
    backgroundColor: '#f5f3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile('index.html');
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.on('closed', () => { window = null; });
}

app.whenReady().then(() => {
  store = createStore(dataRoot());
  materials = createMaterialStore(dataRoot());
  makeWindow();
  for (const [accelerator, keyIndex] of shortcuts) {
    globalShortcut.register(accelerator, () => {
      const now = Date.now();
      const previous = lastShortcutEvent.get(keyIndex) || 0;
      lastShortcutEvent.set(keyIndex, now);
      if (now - previous < 700) return;
      if (!window) makeWindow();
      window.show(); window.focus();
      const action = readSettings(store.root).keyActions[keyIndex];
      const capturedText = action === 'capture_clipboard_note' ? clipboard.readText() : null;
      window.webContents.send('workbench:shortcut', { keyIndex, capturedText });
    });
  }
  app.on('activate', () => { if (!window) makeWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('workbench:info', () => ({
  root: store.root, modes: MODES, keyActions: readSettings(store.root).keyActions,
  shortcuts: shortcuts.map(([accelerator, keyIndex]) => ({ accelerator, keyIndex, active: globalShortcut.isRegistered(accelerator) }))
}));
ipcMain.handle('workbench:clipboard-read', () => clipboard.readText());
ipcMain.handle('workbench:list', () => store.list());
ipcMain.handle('workbench:trash-list', () => store.listTrash());
ipcMain.handle('workbench:create', (_event, mode) => store.create(mode));
ipcMain.handle('workbench:save', (_event, item) => store.save(item));
ipcMain.handle('workbench:trash', (_event, id) => store.trash(id));
ipcMain.handle('workbench:restore', (_event, id) => store.restore(id));
ipcMain.handle('workbench:archive', (_event, id) => {
  const item = store.get(id);
  const references = (item.materialIds || []).map(materialId => { try { return materials.get(materialId); } catch { return null; } }).filter(Boolean);
  return store.archive(id, references);
});
ipcMain.handle('workbench:settings', () => ({ ai: publicSettings(store.root), keyboard: keyboardStatus(store.root, false) }));
ipcMain.handle('workbench:keyboard-status', () => keyboardStatusAsync(store.root));
ipcMain.handle('workbench:settings-save', (_event, input) => saveSettings(store.root, input, safeStorage));
ipcMain.handle('workbench:models', (_event, provider, input) => {
  const credentials = modelListCredentials(store.root, provider, input, safeStorage);
  return listModels(provider, credentials, credentials.apiKey);
});
ipcMain.handle('workbench:capability-save', (_event, id, input) => saveCapability(store.root, id, input, safeStorage));
ipcMain.handle('workbench:capability-models', (_event, id, input) => {
  const credentials = capabilityModelCredentials(store.root, id, input, safeStorage);
  return listModels(credentials.provider, credentials, credentials.apiKey);
});
ipcMain.handle('workbench:skill-catalog', () => publicCatalog(store.root));
ipcMain.handle('workbench:skill-list', () => listCustomSkills(store.root));
ipcMain.handle('workbench:skill-validate', (_event, input) => ({ ...validateSkill(input), preview: markdownFor(input) }));
ipcMain.handle('workbench:skill-save', (_event, input) => saveDraft(store.root, input));
ipcMain.handle('workbench:skill-install', (_event, id, installed) => setInstalled(store.root, id, installed));
ipcMain.handle('workbench:skill-export', async (_event, id) => {
  const item = listCustomSkills(store.root).find(entry => entry.id === id);
  if (!item) throw new Error('Skill 不存在');
  const selection = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('documents'), `${item.name}.zip`), filters: [{ name: 'Skill 包', extensions: ['zip'] }] });
  return selection.canceled ? null : packageSkill(store.root, id, selection.filePath);
});
ipcMain.handle('workbench:skill-import', async () => {
  const selection = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Skill 包与 SKILL.md', extensions: ['zip', 'md'] }] });
  return selection.canceled ? null : importSkill(store.root, selection.filePaths[0]);
});
ipcMain.handle('workbench:skill-design', async (_event, input) => {
  if (running) throw new Error('已有 AI 任务在运行');
  running = true;
  try {
    const settings = readSettings(store.root);
    const context = { provider: settings.provider === 'codex' ? 'codex' : 'api' };
    if (context.provider === 'api') context.ai = apiCredentials(store.root, safeStorage);
    return await designSkill(input, context, __dirname);
  } finally { running = false; }
});
ipcMain.handle('workbench:materials-list', () => materials.list());
ipcMain.handle('workbench:material-add-text', (_event, input) => materials.addText(input));
ipcMain.handle('workbench:material-add-link', (_event, input) => materials.addLink(input));
ipcMain.handle('workbench:material-update', (_event, id, input) => materials.update(id, input));
ipcMain.handle('workbench:material-markdown', (_event, id) => materials.writeMarkdown(id));
ipcMain.handle('workbench:material-files', async (_event, input) => {
  const selection = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: '文档、笔记导出、图片与音视频', extensions: ['pdf', 'docx', 'md', 'markdown', 'txt', 'html', 'htm', 'json', 'csv', 'enex', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
  if (selection.canceled) return [];
  const results = [];
  for (const file of selection.filePaths) results.push(await materials.importFile(file, input));
  return results;
});
ipcMain.handle('workbench:material-open', (_event, id) => { const item = materials.get(id); return item.url ? shell.openExternal(item.url) : shell.openPath(item.assetPath || item.markdownPath); });
ipcMain.handle('workbench:material-ai', async (_event, id, action) => {
  if (running) throw new Error('已有创作任务在运行');
  running = true;
  try {
    const item = materials.get(id);
    const settings = readSettings(store.root);
    const context = { provider: settings.provider === 'codex' ? 'codex' : 'api' };
    if (context.provider === 'api') context.ai = apiCredentials(store.root, safeStorage);
    const result = await runMaterialAI(item, action, context, __dirname);
    const field = { organize: 'organizedText', summarize: 'summary', convert: 'convertedMarkdown' }[action];
    return materials.update(id, { [field]: result, storeMarkdown: action === 'convert' });
  } finally { running = false; }
});
ipcMain.handle('workbench:material-transcribe', async (_event, id) => {
  if (running) throw new Error('已有 AI 任务在运行');
  running = true;
  try {
    const item = materials.get(id);
    const credentials = capabilityCredentials(store.root, 'transcription', safeStorage);
    const transcript = await transcribeMedia(item.assetPath, credentials);
    return materials.update(id, { content: transcript, status: '音视频已转文字，需人工校对', storeMarkdown: true });
  } finally { running = false; }
});
ipcMain.handle('workbench:material-understand', async (_event, id, capability) => {
  if (running) throw new Error('已有 AI 任务在运行');
  if (!['image', 'video', 'audio'].includes(capability)) throw new Error('未知理解类型');
  running = true;
  try {
    const item = materials.get(id);
    const credentials = capabilityCredentials(store.root, capability, safeStorage);
    const analysis = await understandMedia(item, capability, credentials);
    return materials.update(id, { analysis, status: 'AI 理解已完成，需人工核实', storeMarkdown: true });
  } finally { running = false; }
});
ipcMain.handle('workbench:keyboard-apply', (_event, keys) => applyKeyboardMapping(store.root, keys));
ipcMain.handle('workbench:run', async (_event, id, stage, context) => {
  if (running) throw new Error('已有创作任务在运行');
  if (!['collect', 'continue', 'organize'].includes(stage)) throw new Error('未知工作步骤');
  running = true;
  try {
    const settings = readSettings(store.root);
    const aiContext = { ...context, provider: settings.provider, slashContext: settings.slashContext, continuation: settings.continuation };
    if (settings.provider !== 'codex') { aiContext.provider = 'api'; aiContext.ai = apiCredentials(store.root, safeStorage); }
    let item = store.get(id);
    const importedMaterialIds = [];
    if (stage === 'collect') {
      const existing = materials.list();
      const rawSources = [item.materials, context?.selection].map(x => String(x || '').trim()).filter(Boolean);
      for (const raw of rawSources) {
        const source = `作品 ${id} · 原始素材`;
        const prior = existing.find(entry => entry.type === 'text' && entry.source === source && entry.content === raw);
        const record = prior || materials.addText({ title: `${item.title || '未命名作品'} · 原始素材`, category: '原始素材', content: raw, source, storeMarkdown: true });
        importedMaterialIds.push(record.id);
      }
      const urls = [...new Set([...rawSources, String(item.idea || '')].flatMap(text => text.match(/https:\/\/[^\s<>"'，。；）]+/g) || []))].slice(0, 10);
      for (const url of urls) {
        const prior = existing.find(entry => entry.type === 'link' && entry.url === url);
        try { const record = prior || await materials.addLink({ url, category: '网页原文', storeMarkdown: true }); importedMaterialIds.push(record.id); }
        catch { /* Source text remains in the library even if a pasted URL is malformed. */ }
      }
      if (importedMaterialIds.length) item = store.save({ ...item, materialIds: [...new Set([...(item.materialIds || []), ...importedMaterialIds])] });
    }
    const referenced = (item.materialIds || []).map(materialId => { try { return materials.get(materialId); } catch { return null; } }).filter(Boolean);
    aiContext.libraryMaterials = referenced.map(material => ({ title: material.title, source: material.url || material.originalName || material.source, category: material.category, text: (material.organizedText || material.content).slice(0, 12000), summary: material.summary })).slice(0, 12);
    const result = await runStage(store, id, stage, aiContext, __dirname);
    return { ...result, importedMaterialIds };
  } finally {
    running = false;
  }
});
