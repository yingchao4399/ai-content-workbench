const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', {
  list: () => ipcRenderer.invoke('workbench:list'),
  listTrash: () => ipcRenderer.invoke('workbench:trash-list'),
  create: (mode) => ipcRenderer.invoke('workbench:create', mode),
  save: (item) => ipcRenderer.invoke('workbench:save', item),
  trash: (id) => ipcRenderer.invoke('workbench:trash', id),
  restore: (id) => ipcRenderer.invoke('workbench:restore', id),
  run: (id, stage, context) => ipcRenderer.invoke('workbench:run', id, stage, context),
  archive: (id) => ipcRenderer.invoke('workbench:archive', id),
  info: () => ipcRenderer.invoke('workbench:info'),
  settings: () => ipcRenderer.invoke('workbench:settings'),
  keyboardStatus: () => ipcRenderer.invoke('workbench:keyboard-status'),
  saveSettings: (input) => ipcRenderer.invoke('workbench:settings-save', input),
  listModels: (provider, input) => ipcRenderer.invoke('workbench:models', provider, input),
  saveCapability: (id, input) => ipcRenderer.invoke('workbench:capability-save', id, input),
  listCapabilityModels: (id, input) => ipcRenderer.invoke('workbench:capability-models', id, input),
  skillCatalog: () => ipcRenderer.invoke('workbench:skill-catalog'),
  listCustomSkills: () => ipcRenderer.invoke('workbench:skill-list'),
  validateSkill: (input) => ipcRenderer.invoke('workbench:skill-validate', input),
  saveSkill: (input) => ipcRenderer.invoke('workbench:skill-save', input),
  installSkill: (id, installed) => ipcRenderer.invoke('workbench:skill-install', id, installed),
  exportSkill: (id) => ipcRenderer.invoke('workbench:skill-export', id),
  importSkill: () => ipcRenderer.invoke('workbench:skill-import'),
  designSkill: (input) => ipcRenderer.invoke('workbench:skill-design', input),
  listMaterials: () => ipcRenderer.invoke('workbench:materials-list'),
  addMaterialText: (input) => ipcRenderer.invoke('workbench:material-add-text', input),
  addMaterialLink: (input) => ipcRenderer.invoke('workbench:material-add-link', input),
  importMaterialFiles: (input) => ipcRenderer.invoke('workbench:material-files', input),
  updateMaterial: (id, input) => ipcRenderer.invoke('workbench:material-update', id, input),
  materialMarkdown: (id) => ipcRenderer.invoke('workbench:material-markdown', id),
  materialAI: (id, action) => ipcRenderer.invoke('workbench:material-ai', id, action),
  transcribeMaterial: (id) => ipcRenderer.invoke('workbench:material-transcribe', id),
  understandMaterial: (id, capability) => ipcRenderer.invoke('workbench:material-understand', id, capability),
  openMaterial: (id) => ipcRenderer.invoke('workbench:material-open', id),
  applyKeyboard: (keys) => ipcRenderer.invoke('workbench:keyboard-apply', keys),
  onShortcut: (handler) => {
    const listener = (_event, keyIndex) => handler(keyIndex);
    ipcRenderer.on('workbench:shortcut', listener);
    return () => ipcRenderer.removeListener('workbench:shortcut', listener);
  }
});
