const $ = id => document.getElementById(id);
const LABELS = { note: '笔记', wechat: '公众号文章', fiction: '小说', poetry: '诗歌', essay: '散文' };
const ICONS = { note: '▤', wechat: '◉', fiction: '◈', poetry: '❋', essay: '☷' };
const STAGE_LABELS = { collect: '搜集', continue: '续写', organize: '整理' };
const ACTION_LABELS = { collect: '搜集', continue: 'AI 续写', organize: '整理', undo_ai: '撤销键入', redo_ai: '恢复键入', repeat_ai: '重复键入', new_note: '新建笔记', new_wechat: '新建公众号文章', new_fiction: '新建小说', new_poetry: '新建诗歌', new_essay: '新建散文', archive: '归档当前作品', settings: '打开设置', keep: '保留原功能' };
const DEFAULT_ACTIONS = ['collect', 'continue', 'organize', 'new_note', 'new_wechat', 'new_fiction', 'new_poetry', 'new_essay'];
const PANE_PLACEHOLDERS = { idea: '写下一个问题、一句灵感或创作意图……', materials: '粘贴真实素材、出处、人物设定或观察……', topicCard: '按“搜集”生成选题卡，也可以自己编辑……', reviewNotes: '记录审稿意见、修改方向和事实核查……' };
let items = [], current = null, pane = 'idea', saveTimer = null, saving = Promise.resolve(), busy = false, keyActions = DEFAULT_ACTIONS;
let keyCheckActive = false;
const keyCheckCounts = Array(8).fill(0);
function renderKeyCheck() {
  $('toggleKeyCheck').textContent = keyCheckActive ? '结束检测' : '开始检测';
  const target = $('keyCheckCounts'); target.replaceChildren();
  keyCheckCounts.forEach((count, index) => {
    const badge = document.createElement('span');
    badge.textContent = `KEY${index + 1}：${count}`;
    badge.className = count ? 'key-check-hit' : '';
    target.append(badge);
  });
}
let lastEditor = 'draft', commandContext = null, formVersion = 0;
let skillCatalog = [], aiProfiles = {};
const AI_FIELDS = ['title', 'idea', 'materials', 'topicCard', 'draft', 'reviewNotes', 'needsConfirmation', 'materialIds'];
function aiSnapshot(item) { return Object.fromEntries(AI_FIELDS.map(field => [field, Array.isArray(item[field]) ? [...item[field]] : (item[field] || '')])); }
function sameAiState(a, b) { return JSON.stringify(aiSnapshot(a)) === JSON.stringify(aiSnapshot(b)); }
function applyAiSnapshot(snapshot) { for (const field of AI_FIELDS) current[field] = Array.isArray(snapshot[field]) ? [...snapshot[field]] : snapshot[field]; }
function textDifference(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { insertedText: after.slice(start, endAfter), deletedText: before.slice(start, endBefore) };
}
function recordManualInput(field, editor, event) {
  if (!current || !AI_FIELDS.includes(field) || current[field] === editor.value) return;
  const before = aiSnapshot(current);
  current[field] = editor.value;
  const after = aiSnapshot(current);
  const previous = (current.aiEdits || []).slice(0, current.aiEditCursor || 0);
  const last = previous.at(-1);
  const inputType = event?.inputType || 'insertText';
  const now = new Date().toISOString();
  const groupable = /^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(inputType);
  const merge = groupable && last?.kind === 'manual' && last.field === field && last.inputType === inputType && Date.now() - Date.parse(last.at) < 1200 && sameAiState(before, last.after);
  if (merge) {
    last.after = after; last.at = now;
    Object.assign(last, textDifference(last.before[field], after[field]));
  } else previous.push({ stage: 'manual', kind: 'manual', field, inputType, at: now, before, after, ...textDifference(before[field], after[field]) });
  current.aiEdits = previous.slice(-30);
  current.aiEditCursor = current.aiEdits.length;
  formVersion++;
  $('undoAi').disabled = false; $('redoAi').disabled = true; $('repeatAi').disabled = false;
}

function toast(message, delay = 5000) {
  const el = $('toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), delay);
}
function titleOf(item) { return item?.title?.trim() || '未命名作品'; }
function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const list = $('itemList'); list.replaceChildren();
  const filtered = items.filter(item => !query || [item.title, item.idea, item.draft, LABELS[item.mode]].some(s => String(s || '').toLowerCase().includes(query)));
  $('count').textContent = `${filtered.length}`;
  for (const item of filtered) {
    const button = document.createElement('button'); button.className = `item${current?.id === item.id ? ' active' : ''}`;
    const icon = document.createElement('span'); icon.className = 'item-icon'; icon.textContent = ICONS[item.mode];
    const body = document.createElement('span'); const name = document.createElement('b'); name.textContent = titleOf(item);
    const type = document.createElement('small'); type.textContent = LABELS[item.mode]; body.append(name, type); button.append(icon, body);
    button.addEventListener('click', () => selectItem(item.id)); list.append(button);
  }
}
function syncForm() {
  if (!current) return;
  current.title = $('title').value; current.mode = $('mode').value; current.draft = $('draft').value; if (pane !== 'skills') current[pane] = $('sideText').value;
}
function displayCurrent() {
  if (!current) return;
  $('title').value = current.title; $('mode').value = current.mode; $('draft').value = current.draft; $('sideText').value = current[pane] || '';
  $('sideText').placeholder = PANE_PLACEHOLDERS[pane];
  $('crumbTitle').textContent = titleOf(current);
  $('updatedAt').textContent = current.updatedAt ? `更新于 ${new Date(current.updatedAt).toLocaleString('zh-CN')}` : '';
  const unknowns = current.needsConfirmation || [];
  $('unknowns').classList.toggle('hidden', unknowns.length === 0);
  $('unknowns').textContent = unknowns.length ? `待核实：${unknowns.join('；')}` : '';
  document.querySelectorAll('.action').forEach(button => { const index = keyActions.indexOf(button.dataset.stage); button.querySelector('.keycap').textContent = index < 0 ? '·' : index + 1; });
  $('undoAi').disabled = busy || !(current.aiEditCursor > 0);
  $('redoAi').disabled = busy || !((current.aiEdits || []).length > (current.aiEditCursor || 0));
  $('repeatAi').disabled = busy || !(current.aiEditCursor > 0);
  renderSkills();
  renderList();
}
function renderSkills() {
  const list = $('skillList'); list.replaceChildren();
  if (!current) return;
  for (const skill of skillCatalog.filter(entry => entry.modes.includes(current.mode))) {
    const label = document.createElement('label'); label.className = 'skill-choice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = (current.optionalSkills || []).includes(skill.id);
    checkbox.onchange = () => { current.optionalSkills = checkbox.checked ? [...new Set([...(current.optionalSkills || []), skill.id])] : (current.optionalSkills || []).filter(id => id !== skill.id); scheduleSave(); };
    const body = document.createElement('span'); const name = document.createElement('b'); name.textContent = skill.title; const summary = document.createElement('small'); summary.textContent = skill.summary;
    const link = document.createElement('a'); link.href = skill.source; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '查看来源';
    body.append(name, summary); if (/^https:\/\//.test(skill.source || '')) body.append(link); label.append(checkbox, body); list.append(label);
  }
  const refs = $('referencedMaterials'); refs.replaceChildren();
  const selected = (current.materialIds || []).map(id => window.libraryUI?.getMaterial(id)).filter(Boolean);
  if (!selected.length) { const empty = document.createElement('small'); empty.textContent = '尚未引用材料'; refs.append(empty); }
  else for (const material of selected) { const row = document.createElement('div'); row.className = 'reference-row'; row.textContent = `${material.title} · ${material.category}`; refs.append(row); }
}
async function saveNow(event = null) {
  if (!current) return;
  clearTimeout(saveTimer); syncForm();
  const id = current.id, payload = { ...current, recordEvent: event };
  const version = formVersion;
  $('saveState').textContent = '保存中…';
  saving = saving.catch(() => {}).then(async () => {
    const saved = await window.workbench.save(payload);
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) items[index] = saved;
    if (current?.id === id && version === formVersion) { current = saved; $('saveState').textContent = '已保存'; renderList(); }
    return saved;
  });
  try { return await saving; } catch (error) { $('saveState').textContent = '保存失败'; toast(error.message); throw error; }
}
function scheduleSave() {
  if (!current) return;
  $('saveState').textContent = '有更改…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(), 550);
  $('crumbTitle').textContent = $('title').value.trim() || '未命名作品';
}
function chooseContinuation(versions) {
  return new Promise(resolve => {
    const dialog = $('continuationDialog');
    const options = $('continuationOptions'); options.replaceChildren();
    let settled = false;
    const finish = value => { if (settled) return; settled = true; dialog.close(); resolve(value); };
    versions.forEach((version, index) => {
      const card = document.createElement('article'); card.className = 'continuation-card';
      const heading = document.createElement('strong'); heading.textContent = `版本 ${index + 1} · ${version.length} 字`;
      const preview = document.createElement('pre'); preview.textContent = version;
      const button = document.createElement('button'); button.className = 'primary'; button.textContent = '选择此版本并插入'; button.onclick = () => finish(index);
      card.append(heading, preview, button); options.append(card);
    });
    $('regenerateContinuation').onclick = () => finish('regenerate');
    $('cancelContinuation').onclick = () => finish(null);
    $('closeContinuation').onclick = () => finish(null);
    dialog.onclose = () => { if (!settled) { settled = true; resolve(null); } };
    dialog.showModal();
  });
}
async function selectItem(id) {
  if (current && current.id !== id) await saveNow();
  current = items.find(item => item.id === id);
  window.libraryUI?.hide();
  window.studioUI?.hide();
  displayCurrent();
}
async function createItem(mode) {
  if (current) await saveNow();
  const item = await window.workbench.create(mode); items.unshift(item); current = item;
  $('newMenu').classList.add('hidden'); window.libraryUI?.hide(); window.studioUI?.hide(); displayCurrent(); $('title').focus();
}
async function deleteCurrent() {
  if (!current) return;
  await saveNow();
  const id = current.id;
  if (!window.confirm(`将“${titleOf(current)}”移到回收站？以后可恢复。`)) return;
  await window.workbench.trash(id);
  items = items.filter(item => item.id !== id);
  if (!items.length) items = [await window.workbench.create('note')];
  current = items[0];
  window.libraryUI?.hide(); window.studioUI?.hide(); displayCurrent();
  toast('已移到回收站，可从左侧恢复');
}
async function openTrash() {
  const list = $('trashList'); list.replaceChildren();
  const deleted = await window.workbench.listTrash();
  if (!deleted.length) { const empty = document.createElement('p'); empty.textContent = '回收站为空'; list.append(empty); }
  for (const item of deleted) {
    const row = document.createElement('div'); row.className = 'trash-row';
    const label = document.createElement('span'); label.textContent = `${titleOf(item)} · ${LABELS[item.mode]} · ${new Date(item.deletedAt).toLocaleString('zh-CN')}`;
    const button = document.createElement('button'); button.className = 'subtle-bordered'; button.textContent = '恢复';
    button.onclick = async () => {
      try {
        await saveNow();
        const restored = await window.workbench.restore(item.id);
        items = await window.workbench.list(); current = restored; displayCurrent();
        await openTrash(); toast('作品已恢复');
      } catch (error) { toast(error.message, 9000); }
    };
    row.append(label, button); list.append(row);
  }
  if (!$('trashDialog').open) $('trashDialog').showModal();
}
function choosePane(next) {
  if (current && pane !== 'skills') { current[pane] = $('sideText').value; scheduleSave(); }
  pane = next;
  document.querySelectorAll('.pane-tab').forEach(button => button.classList.toggle('active', button.dataset.pane === pane));
  $('sideText').classList.toggle('hidden', pane === 'skills'); $('skillPanel').classList.toggle('hidden', pane !== 'skills');
  if (pane !== 'skills') { $('sideText').value = current?.[pane] || ''; $('sideText').placeholder = PANE_PLACEHOLDERS[pane]; }
  else renderSkills();
}
async function run(stage, requested = null) {
  if (busy || !current) return;
  busy = true; document.querySelectorAll('.action').forEach(button => button.disabled = true);
  const targetId = requested?.targetId || (['draft', 'sideText'].includes(document.activeElement?.id) ? document.activeElement.id : lastEditor);
  const target = $(targetId);
  const field = targetId === 'draft' ? 'draft' : pane;
  const cursor = requested?.range || { start: target.selectionStart, end: target.selectionEnd };
  const draftBefore = target.value;
  const origin = requested?.origin || (cursor.start !== cursor.end ? 'selection' : 'direct');
  const insertionPoint = stage === 'continue' && origin === 'selection' ? cursor.end : cursor.start;
  let focusPosition = null;
  closeCommand();
  try {
    await saveNow();
    const beforeAi = aiSnapshot(current);
    toast(`正在${STAGE_LABELS[stage]}，请稍候…`, 180000);
    const context = { selection: draftBefore.slice(cursor.start, cursor.end), prefix: draftBefore.slice(0, insertionPoint), suffix: draftBefore.slice(insertionPoint), origin, targetField: field };
    let result = await window.workbench.run(current.id, stage, context);
    let chosenContinuation = '';
    if (stage === 'continue') {
      for (;;) {
        const versions = result.continuations;
        if (!Array.isArray(versions) || versions.length !== 3 || versions.some(text => typeof text !== 'string' || !text.trim())) throw new Error('AI 未返回三个有效续写版本');
        const choice = await chooseContinuation(versions);
        if (choice === null) { toast('已取消续写，正文未修改'); return; }
        if (choice === 'regenerate') { toast('正在重新生成三个续写版本…', 180000); result = await window.workbench.run(current.id, stage, context); continue; }
        chosenContinuation = versions[choice]; break;
      }
      if (target.value !== draftBefore) throw new Error('预览期间正文已修改；请重新发起续写');
    }
    if (result.importedMaterialIds?.length) current.materialIds = [...new Set([...(current.materialIds || []), ...result.importedMaterialIds])];
    if (stage === 'collect') {
      current.topicCard = result.topicCard || '';
      if (!current.title.trim()) current.title = result.suggestedTitle || '';
      current.needsConfirmation = [...new Set([...(current.needsConfirmation || []), ...(result.missingInfo || [])])];
      pane = 'topicCard'; document.querySelectorAll('.pane-tab').forEach(button => button.classList.toggle('active', button.dataset.pane === pane));
      $('sideText').classList.remove('hidden'); $('skillPanel').classList.add('hidden');
      if (result.topicCard?.trim()) {
        const record = await window.workbench.addMaterialText({ type: 'generated', title: `AI 搜集：${current.title || '未命名作品'}`, category: 'AI 搜集', content: result.topicCard, source: `作品 ${current.id} · 选题卡`, storeMarkdown: true });
        current.materialIds = [...new Set([...(current.materialIds || []), record.id])];
        await window.libraryUI.load(record.id);
      }
    } else if (stage === 'continue') {
      current[field] = draftBefore.slice(0, insertionPoint) + chosenContinuation + draftBefore.slice(insertionPoint);
      current.reviewNotes = [current.reviewNotes, result.reviewNotes].filter(Boolean).join('\n\n');
      current.needsConfirmation = [...new Set([...(current.needsConfirmation || []), ...(result.unknowns || [])])];
    } else {
      const replacement = result.revisedBody || '';
      current[field] = cursor.start !== cursor.end
        ? draftBefore.slice(0, cursor.start) + replacement + draftBefore.slice(cursor.end)
        : replacement;
      current.reviewNotes = [current.reviewNotes, result.reviewNotes].filter(Boolean).join('\n\n');
      current.needsConfirmation = [...new Set([...(current.needsConfirmation || []), ...(result.needsConfirmation || [])])];
    }
    const afterAi = aiSnapshot(current);
    const previous = (current.aiEdits || []).slice(0, current.aiEditCursor || 0);
    current.aiEdits = [...previous, { stage, kind: 'ai', field, at: new Date().toISOString(), before: beforeAi, after: afterAi }].slice(-30);
    current.aiEditCursor = current.aiEdits.length;
    current.lastAiStage = stage;
    displayCurrent();
    await saveNow({ stage, summary: `通过 ${STAGE_LABELS[stage]} 操作生成内容，待人工审阅` });
    if (stage === 'continue') focusPosition = insertionPoint + chosenContinuation.length;
    toast(`${STAGE_LABELS[stage]}完成。请审阅生成内容。`);
  } catch (error) { toast(error.message || String(error), 9000); }
  finally { busy = false; document.querySelectorAll('.action').forEach(button => button.disabled = false); if (current) displayCurrent(); if (focusPosition !== null) { target.focus(); target.setSelectionRange(focusPosition, focusPosition); } }
}
async function undoAi() {
  if (busy || !current || !(current.aiEditCursor > 0)) return;
  await saveNow();
  const entry = current.aiEdits[current.aiEditCursor - 1];
  if (!sameAiState(current, entry.after)) { toast('当前内容与历史记录不一致，无法直接撤销'); return; }
  applyAiSnapshot(entry.before); current.aiEditCursor--; displayCurrent();
  await saveNow({ stage: 'manual', summary: '撤销上一次键入' }); toast('已撤销上一次键入');
}
async function redoAi() {
  if (busy || !current || !((current.aiEdits || []).length > (current.aiEditCursor || 0))) return;
  await saveNow();
  const entry = current.aiEdits[current.aiEditCursor];
  if (!sameAiState(current, entry.before)) { toast('当前内容已变化，无法直接恢复上一次键入'); return; }
  applyAiSnapshot(entry.after); current.aiEditCursor++; displayCurrent();
  await saveNow({ stage: 'manual', summary: '恢复上一次键入' }); toast('已恢复上一次键入');
}
function repeatAi() {
  if (busy || !current?.aiEditCursor) return;
  const entry = current.aiEdits[current.aiEditCursor - 1];
  if (entry.kind !== 'manual') { run(entry.stage); return; }
  const field = entry.field;
  if (field !== 'title' && field !== 'draft' && pane !== field) choosePane(field);
  const editor = field === 'title' ? $('title') : field === 'draft' ? $('draft') : $('sideText');
  const start = editor.selectionStart, end = editor.selectionEnd;
  const inserted = entry.insertedText || '';
  const deleted = entry.deletedText || '';
  if (!inserted && !deleted) { toast('最近一次键入没有可重复的文字变化'); return; }
  if (inserted) {
    editor.value = editor.value.slice(0, start) + inserted + editor.value.slice(end);
    editor.setSelectionRange(start + inserted.length, start + inserted.length);
  } else {
    const backward = entry.inputType !== 'deleteContentForward';
    const from = backward ? Math.max(0, start - deleted.length) : start;
    const to = backward ? end : Math.min(editor.value.length, Math.max(start, end) + deleted.length);
    editor.value = editor.value.slice(0, from) + editor.value.slice(to);
    editor.setSelectionRange(from, from);
  }
  recordManualInput(field, editor, { inputType: 'insertFromPaste' });
  scheduleSave(); editor.focus(); toast('已重复上一次键入');
}
function closeCommand() { $('commandMenu').classList.add('hidden'); commandContext = null; }
function showCommand(targetId, range, point, origin) {
  if (busy || !current) return;
  commandContext = { targetId, range: { ...range }, origin }; lastEditor = targetId;
  const menu = $('commandMenu'); menu.classList.remove('hidden');
  const x = Math.min(Math.max(12, point.x), window.innerWidth - 330);
  const y = Math.min(Math.max(12, point.y), window.innerHeight - 230);
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;
  $('commandInput').value = ''; renderCommandOptions(); $('commandInput').focus();
}
function renderCommandOptions() {
  const filter = $('commandInput').value.trim().toLowerCase();
  const options = $('commandOptions'); options.replaceChildren();
  const descriptions = { collect: '提炼选题卡', continue: '生成三版，可选择或重新抽卡', organize: '整理所选内容' };
  for (const stage of ['collect', 'continue', 'organize']) {
    if (filter && !`${STAGE_LABELS[stage]} ${stage}`.toLowerCase().includes(filter)) continue;
    const button = document.createElement('button'); button.className = 'command-option';
    const label = document.createElement('span'); label.textContent = STAGE_LABELS[stage];
    const hint = document.createElement('small'); hint.textContent = descriptions[stage]; button.append(label, hint);
    button.onclick = () => run(stage, commandContext); options.append(button);
  }
}
function displayKeyboard(status) {
  keyActions = status.keyActions || DEFAULT_ACTIONS;
  $('keyboardStatus').textContent = status.installed
    ? `系统${status.present === null ? '正在检查' : status.present ? '识别到' : '暂未识别到'} ${status.deviceName}；EasyInput 桌面程序${status.running === null ? '正在检查' : status.running ? '正在运行' : '未运行'}；键盘功能${status.enabled ? '已启用' : '未启用'}；所选按键${status.mapped ? '已写入配置' : '尚未匹配'}。`
    : '未找到 EasyInput 本地配置。请先安装并运行 EasyInput。';
  const parent = $('mapping'); parent.replaceChildren();
  for (let index = 0; index < 8; index++) {
    const row = document.createElement('div'); row.className = 'mapping-row';
    const title = document.createElement('strong'); title.textContent = `实体键 ${index + 1}`;
    const select = document.createElement('select'); select.dataset.index = index;
    for (const [value, label] of Object.entries(ACTION_LABELS)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    select.value = keyActions[index] || 'keep';
    const original = status.bindings?.[index]?.current;
    const summary = typeof original === 'string' ? original : JSON.stringify(original || '无');
    const info = document.createElement('small'); info.textContent = `当前：${summary} · 新组合键 Ctrl+Alt+Shift+${index + 1}`;
    row.append(title, select, info); parent.append(row);
  }
  if (current) displayCurrent();
}
async function openSettings() {
  try {
    const settings = await window.workbench.settings();
    aiProfiles = settings.ai.apiProfiles;
    $('provider').value = settings.ai.provider; updateProviderFields();
    $('slashContext').value = settings.ai.slashContext;
    $('continueCharacters').value = settings.ai.continuation.characters;
    $('continueParagraphs').value = settings.ai.continuation.paragraphs;
    $('continuePerParagraph').value = settings.ai.continuation.perParagraph;
    renderCapabilities(settings.ai.capabilities);
    displayKeyboard(settings.keyboard); $('settingsDialog').showModal();
    window.workbench.keyboardStatus().then(status => { if ($('settingsDialog').open) displayKeyboard(status); }).catch(error => { if ($('settingsDialog').open) $('keyboardStatus').textContent = `设备状态暂未读到：${error.message}`; });
    if (settings.ai.provider !== 'codex' && (settings.ai.provider === 'zhipu' || aiProfiles[settings.ai.provider]?.hasApiKey)) refreshModels();
  } catch (error) { toast(error.message); }
}
function updateProviderFields() {
  const provider = $('provider').value, profile = aiProfiles[provider];
  $('apiFields').classList.toggle('hidden', provider === 'codex');
  $('baseUrl').value = profile?.baseUrl || '';
  $('model').value = profile?.model || '';
  $('apiKey').value = ''; $('clearApiKey').checked = false;
  $('keySaved').textContent = profile?.hasApiKey ? '已安全保存该服务商密钥' : '';
  $('modelStatus').textContent = '';
  $('modelPicker').replaceChildren(new Option('点击获取最新模型后选择', ''));
  $('deepseekModelDocs').classList.toggle('hidden', provider !== 'deepseek');
}
async function refreshModels() {
  const provider = $('provider').value;
  if (provider === 'codex') return;
  $('modelStatus').textContent = '正在读取官方模型列表…'; $('refreshModels').disabled = true;
  try {
    const result = await window.workbench.listModels(provider, { baseUrl: $('baseUrl').value, apiKey: $('apiKey').value });
    $('modelPicker').replaceChildren(new Option('选择官方模型', ''));
    for (const model of result.models) {
      const label = provider === 'deepseek' && model === 'deepseek-flash' ? `${model}（V4.1 Flash）` : provider === 'deepseek' && model === 'deepseek-v4-pro' ? `${model}（V4 Pro）` : model;
      $('modelPicker').append(new Option(label, model));
    }
    // DeepSeek still accepts this older API name, but it routes to V4.1 Flash.
    if (provider === 'deepseek' && !result.models.includes('deepseek-v4-flash')) {
      $('modelPicker').append(new Option('deepseek-v4-flash（V4 Flash 兼容名 → V4.1 Flash）', 'deepseek-v4-flash'));
    }
    $('modelPicker').value = [...$('modelPicker').options].some(option => option.value === $('model').value) ? $('model').value : '';
    if (!$('model').value && result.models.length) $('model').value = result.models[0];
    $('modelStatus').textContent = `${result.models.length} 个官方接口返回的模型${provider === 'deepseek' ? '，另列出 1 个官方仍接受的兼容名（实际路由到 V4.1 Flash）' : ''} · ${result.source} · ${new Date(result.fetchedAt).toLocaleString('zh-CN')}`;
  } catch (error) { $('modelStatus').textContent = `${error.message}；仍可手动填写模型名`; }
  finally { $('refreshModels').disabled = false; }
}
function renderCapabilities(capabilities) {
  const titles = { image: '图片理解', video: '视频理解', audio: '音频理解', transcription: '音视频转文字' };
  const container = $('capabilityCards'); container.replaceChildren();
  for (const [id, title] of Object.entries(titles)) {
    const saved = capabilities[id];
    const card = document.createElement('div'); card.className = 'capability-card';
    const heading = document.createElement('h4'); heading.textContent = title; card.append(heading);
    const make = (label, control) => { const wrapper = document.createElement('label'); wrapper.textContent = label; wrapper.append(control); card.append(wrapper); return control; };
    const provider = make('服务商', document.createElement('select'));
    const allowed = id === 'transcription' || id === 'audio' ? ['qwen', 'custom'] : ['deepseek', 'qwen', 'kimi', 'zhipu', 'custom'];
    const names = { deepseek: 'DeepSeek', qwen: '千问', kimi: 'Kimi', zhipu: '智谱', custom: '自定义兼容接口' };
    for (const name of allowed) provider.append(new Option(names[name], name));
    provider.value = saved.provider;
    const base = make('接口地址', document.createElement('input')); base.value = saved.baseUrl || '';
    const model = make('模型名称', document.createElement('input')); model.value = saved.model || ''; model.placeholder = '可刷新选择，也可手动填写';
    const suggestions = document.createElement('datalist'); suggestions.id = `models-${id}`; model.setAttribute('list', suggestions.id); card.append(suggestions);
    const key = make('此能力单独密钥（可留空复用服务商密钥）', document.createElement('input')); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = saved.hasOwnKey ? '已安全保存独立密钥' : saved.hasSharedKey ? '将复用服务商密钥' : '请填写密钥';
    const clear = document.createElement('input'); clear.type = 'checkbox'; const clearLabel = make('清除独立密钥', clear); clearLabel.className = 'capability-clear';
    const buttons = document.createElement('div'); buttons.className = 'capability-buttons';
    const refresh = document.createElement('button'); refresh.className = 'subtle-bordered'; refresh.textContent = '↻ 官方模型';
    const save = document.createElement('button'); save.className = 'primary'; save.textContent = '保存此能力';
    buttons.append(refresh, save); card.append(buttons);
    const status = document.createElement('small'); status.className = 'capability-status'; status.textContent = saved.hasOwnKey ? '独立密钥已保存' : saved.hasSharedKey ? '复用服务商密钥' : '尚未配置密钥'; card.append(status);
    provider.onchange = () => { base.value = aiProfiles[provider.value]?.baseUrl || ''; model.value = ''; status.textContent = '请填写支持此模态的模型'; };
    refresh.onclick = async () => {
      status.textContent = '正在读取官方模型…'; refresh.disabled = true;
      try {
        const result = await window.workbench.listCapabilityModels(id, { provider: provider.value, baseUrl: base.value, apiKey: key.value });
        suggestions.replaceChildren(); for (const name of result.models) suggestions.append(new Option(name));
        status.textContent = `官方返回 ${result.models.length} 个模型；可手动输入支持此模态的模型名`;
      } catch (error) { status.textContent = `${error.message}；可手动填写模型名`; }
      finally { refresh.disabled = false; }
    };
    save.onclick = async () => {
      save.disabled = true;
      try {
        const updated = await window.workbench.saveCapability(id, { provider: provider.value, baseUrl: base.value, model: model.value, apiKey: key.value, clearApiKey: clear.checked });
        key.value = ''; clear.checked = false; key.placeholder = updated.hasOwnKey ? '已安全保存独立密钥' : updated.hasSharedKey ? '将复用服务商密钥' : '请填写密钥';
        status.textContent = '已保存'; toast(`${title}配置已保存`);
      } catch (error) { status.textContent = error.message; toast(error.message, 9000); }
      finally { save.disabled = false; }
    };
    container.append(card);
  }
}
async function init() {
  const info = await window.workbench.info();
  skillCatalog = await window.workbench.skillCatalog();
  keyActions = info.keyActions || DEFAULT_ACTIONS;
  for (const mode of info.modes) { const option = document.createElement('option'); option.value = mode; option.textContent = LABELS[mode]; $('mode').append(option); }
  const menu = $('newMenu'); for (const mode of info.modes) { const button = document.createElement('button'); button.textContent = `${ICONS[mode]}  ${LABELS[mode]}`; button.onclick = () => createItem(mode); menu.append(button); }
  items = await window.workbench.list();
  if (items.length) current = items[0]; else { current = await window.workbench.create('note'); items = [current]; }
  displayCurrent();
  window.libraryUI.init({
    toast,
    onChange: () => renderSkills(),
    isReferenced: id => (current?.materialIds || []).includes(id),
    toggleReference: async id => {
      if (!current) return;
      current.materialIds = (current.materialIds || []).includes(id) ? current.materialIds.filter(x => x !== id) : [...(current.materialIds || []), id];
      await saveNow({ stage: 'manual', summary: '更新材料引用' }); renderSkills();
      toast((current.materialIds || []).includes(id) ? '已引用到当前作品' : '已取消引用');
    }
  });
  window.studioUI.init({ toast, onCatalogChange: async () => { skillCatalog = await window.workbench.skillCatalog(); renderSkills(); }, currentMode: () => current?.mode, useSkill: async id => { if (!current) return; current.optionalSkills = [...new Set([...(current.optionalSkills || []), id])]; await saveNow({ stage: 'manual', summary: '为作品启用自定义 Skill' }); renderSkills(); } });
  $('homeButton').onclick = () => { window.studioUI.hide(); window.libraryUI.hide(); };
  $('libraryButton').onclick = () => { window.studioUI.hide(); window.libraryUI.show(); };
  $('skillStudioButton').onclick = () => window.studioUI.show();
  $('browseMaterials').onclick = () => window.libraryUI.show();
  $('newButton').onclick = () => menu.classList.toggle('hidden');
  $('search').oninput = renderList;
  for (const id of ['title', 'draft', 'sideText']) $(id).addEventListener('input', event => { recordManualInput(id === 'sideText' ? pane : id, $(id), event); scheduleSave(); });
  for (const id of ['draft', 'sideText']) {
    const editor = $(id);
    editor.addEventListener('focus', () => { lastEditor = id; });
    editor.addEventListener('keydown', event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      const rect = editor.getBoundingClientRect();
      showCommand(id, { start: editor.selectionStart, end: editor.selectionStart }, { x: rect.left + 35, y: Math.min(rect.bottom - 200, rect.top + 70) }, 'slash');
    });
    editor.addEventListener('mouseup', event => {
      if (editor.selectionStart !== editor.selectionEnd) showCommand(id, { start: editor.selectionStart, end: editor.selectionEnd }, { x: event.clientX + 8, y: event.clientY + 12 }, 'selection');
    });
    editor.addEventListener('keyup', event => {
      if (event.shiftKey && editor.selectionStart !== editor.selectionEnd) {
        const rect = editor.getBoundingClientRect(); showCommand(id, { start: editor.selectionStart, end: editor.selectionEnd }, { x: rect.left + 35, y: rect.top + 55 }, 'selection');
      }
    });
  }
  $('commandInput').oninput = renderCommandOptions;
  $('commandInput').onkeydown = event => {
    if (event.key === 'Escape') closeCommand();
    if (event.key === 'Enter') { const first = $('commandOptions').querySelector('button'); if (first) first.click(); }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCommand();
    if ($('settingsDialog').open || $('materialDialog').open || $('continuationDialog').open) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'z' && !event.shiftKey) { event.preventDefault(); undoAi(); }
    else if (modifier && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redoAi(); }
    else if (event.key === 'F4') { event.preventDefault(); repeatAi(); }
  });
  document.addEventListener('mousedown', event => { if (!event.target.closest('#commandMenu') && !event.target.closest('#draft') && !event.target.closest('#sideText')) closeCommand(); });
  $('mode').onchange = scheduleSave;
  document.querySelectorAll('.pane-tab').forEach(button => button.onclick = () => choosePane(button.dataset.pane));
  document.querySelectorAll('.action').forEach(button => button.onclick = () => run(button.dataset.stage));
  $('undoAi').onclick = undoAi; $('redoAi').onclick = redoAi; $('repeatAi').onclick = repeatAi;
  $('reviewButton').onclick = async () => { if (!current) return; syncForm(); current.markReviewed = true; await saveNow({ stage: 'manual', summary: '人工标记已审稿' }); delete current.markReviewed; toast('已记录审稿时间'); };
  $('archiveButton').onclick = async () => { try { await saveNow(); current = await window.workbench.archive(current.id); toast(`已归档：${current.archivedPath}`, 9000); } catch (error) { toast(error.message); } };
  $('deleteItem').onclick = () => deleteCurrent().catch(error => toast(error.message, 9000));
  $('trashButton').onclick = () => openTrash().catch(error => toast(error.message, 9000));
  $('closeTrash').onclick = () => $('trashDialog').close();
  $('settingsButton').onclick = openSettings;
  $('closeSettings').onclick = () => {
    if (keyCheckActive) { keyCheckActive = false; renderKeyCheck(); $('keyCheckStatus').textContent = '检测已结束；再次点击关闭设置。'; return; }
    $('settingsDialog').close();
  };
  $('settingsDialog').addEventListener('cancel', event => { if (keyCheckActive) { event.preventDefault(); $('keyCheckStatus').textContent = '请先结束八键检测，再关闭设置。'; } });
  $('settingsDialog').addEventListener('close', () => { keyCheckActive = false; renderKeyCheck(); });
  $('toggleKeyCheck').onclick = () => {
    keyCheckActive = !keyCheckActive;
    $('keyCheckStatus').textContent = keyCheckActive ? '正在检测：请逐键短按并松开。此时不会执行映射动作。' : '检测已结束；计数保留至下次清零。';
    renderKeyCheck();
  };
  $('resetKeyCheck').onclick = () => { keyCheckCounts.fill(0); $('keyCheckStatus').textContent = keyCheckActive ? '计数已清零，继续逐键测试。' : '计数已清零，检测未开始。'; renderKeyCheck(); };
  renderKeyCheck();
  $('provider').onchange = () => { updateProviderFields(); const id = $('provider').value; if (id === 'zhipu' || aiProfiles[id]?.hasApiKey) refreshModels(); };
  $('refreshModels').onclick = refreshModels;
  $('modelPicker').onchange = () => { if ($('modelPicker').value) $('model').value = $('modelPicker').value; };
  $('saveAi').onclick = async () => {
    try { const ai = await window.workbench.saveSettings({ provider: $('provider').value, baseUrl: $('baseUrl').value, model: $('model').value, apiKey: $('apiKey').value, clearApiKey: $('clearApiKey').checked, slashContext: $('slashContext').value, continuation: { characters: $('continueCharacters').value, paragraphs: $('continueParagraphs').value, perParagraph: $('continuePerParagraph').value } }); aiProfiles = ai.apiProfiles; $('apiKey').value = ''; $('keySaved').textContent = aiProfiles[ai.provider]?.hasApiKey ? '已安全保存该服务商密钥' : ''; renderCapabilities(ai.capabilities); toast('AI 配置已保存'); if (ai.provider !== 'codex' && (ai.provider === 'zhipu' || aiProfiles[ai.provider]?.hasApiKey)) refreshModels(); }
    catch (error) { toast(error.message, 9000); }
  };
  $('applyKeyboard').onclick = async () => {
    try {
      const status = (await window.workbench.settings()).keyboard;
      const actions = [...document.querySelectorAll('#mapping select')].map(select => select.value);
      const changes = actions.map((action, i) => { const currentBinding = status.bindings[i]?.current; return `KEY${i + 1} → ${ACTION_LABELS[action]}（原动作：${typeof currentBinding === 'string' ? currentBinding : JSON.stringify(currentBinding || '无')}）`; });
      if (!window.confirm(`将修改 EasyInput 配置，并自动备份原文件：\n\n${changes.join('\n')}\n\n继续？`)) return;
      const result = await window.workbench.applyKeyboard(actions); displayKeyboard(result.status);
      toast(`配置已写入，备份：${result.backup}。请启动 EasyInput 并同步到设备。`, 10000);
    } catch (error) { toast(error.message, 9000); }
  };
  window.workbench.onShortcut(index => {
    if (keyCheckActive) {
      if (Number.isInteger(index) && index >= 0 && index < keyCheckCounts.length) {
        keyCheckCounts[index] += 1;
        $('keyCheckStatus').textContent = `刚收到 KEY${index + 1}；请核对一次短按仅增加 1。`;
        renderKeyCheck();
      }
      return;
    }
    const action = keyActions[index];
    if (['collect', 'continue', 'organize'].includes(action)) run(action);
    else if (action === 'undo_ai') undoAi();
    else if (action === 'redo_ai') redoAi();
    else if (action === 'repeat_ai') repeatAi();
    else if (action?.startsWith('new_')) createItem(action.slice(4));
    else if (action === 'archive') $('archiveButton').click();
    else if (action === 'settings') openSettings();
  });
}
init().catch(error => toast(error.message || String(error), 15000));
