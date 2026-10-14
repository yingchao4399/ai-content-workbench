(() => {
  const $ = id => document.getElementById(id);
  const MEDIA = /\.(mp3|wav|m4a|aac|flac|ogg|wma|mp4|mov|mkv|webm|avi)$/i;
  const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const VIDEO = /\.(mp4|mov|mkv|webm|avi)$/i;
  let entries = [], selectedId = null, addMode = 'file', callbacks = null, busy = false;
  function getMaterial(id) { return entries.find(item => item.id === id); }
  function allCategories() { return [...new Set(entries.map(x => x.category).filter(Boolean))].sort(); }
  function refreshCategories() {
    const filter = $('materialCategoryFilter'), old = filter.value;
    filter.replaceChildren(new Option('全部分类', ''));
    $('categorySuggestions').replaceChildren();
    for (const name of allCategories()) { filter.append(new Option(name, name)); $('categorySuggestions').append(new Option(name)); }
    filter.value = old;
  }
  function renderList() {
    const query = $('materialSearch').value.trim().toLowerCase();
    const category = $('materialCategoryFilter').value;
    const filtered = entries.filter(item => (!category || item.category === category) && (!query || [item.title, item.content, item.url, item.originalName].some(x => String(x || '').toLowerCase().includes(query))));
    $('materialCount').textContent = entries.length;
    $('libraryCount').textContent = `${filtered.length} 条材料`;
    const list = $('materialList'); list.replaceChildren();
    for (const item of filtered) {
      const button = document.createElement('button'); button.className = `material-card${selectedId === item.id ? ' selected' : ''}`;
      const kind = document.createElement('small'); kind.textContent = `${item.category} · ${item.type === 'file' ? '文件' : item.type === 'link' ? '链接' : item.type === 'generated' ? 'AI 生成' : '文本'}`;
      const name = document.createElement('b'); name.textContent = item.title;
      const excerpt = document.createElement('span'); excerpt.textContent = (item.summary || item.content || item.status).slice(0, 90);
      button.append(kind, name, excerpt); button.onclick = () => { selectedId = item.id; renderList(); renderDetail(); }; list.append(button);
    }
  }
  function makeButton(text, handler, cls = 'subtle-bordered') { const button = document.createElement('button'); button.textContent = text; button.className = cls; button.onclick = handler; return button; }
  async function saveDetail() {
    const item = getMaterial(selectedId); if (!item) return;
    try {
      const updated = await window.workbench.updateMaterial(item.id, { title: $('detailTitle').value, category: $('detailCategory').value, content: $('detailContent').value });
      await load(updated.id); callbacks?.toast('材料已保存');
    } catch (error) { callbacks?.toast(error.message); }
  }
  async function runAI(action) {
    if (busy || !selectedId) return;
    busy = true;
    const id = selectedId;
    try {
      callbacks?.toast(action === 'transcribe' ? '正在提取音轨并转文字，长文件需要几分钟…' : '正在处理材料，请稍候…', 180000);
      if (action === 'transcribe') await window.workbench.transcribeMaterial(id);
      else if (['image', 'video', 'audio'].includes(action)) await window.workbench.understandMaterial(id, action);
      else await window.workbench.materialAI(id, action);
      await load(id);
      callbacks?.toast('材料处理完成，请检查结果');
    } catch (error) { callbacks?.toast(error.message, 12000); }
    finally { busy = false; }
  }
  function renderDetail() {
    const item = getMaterial(selectedId), detail = $('materialDetail'); detail.replaceChildren();
    if (!item) { const empty = document.createElement('div'); empty.className = 'empty-material'; empty.textContent = '选择一条材料查看详情，或先上传文件与链接。'; detail.append(empty); return; }
    const head = document.createElement('div'); head.className = 'detail-head';
    const type = document.createElement('small'); type.textContent = `${item.type.toUpperCase()} · ${item.status}`;
    const title = document.createElement('input'); title.id = 'detailTitle'; title.value = item.title; title.placeholder = '材料标题';
    const meta = document.createElement('p'); meta.textContent = `导入：${new Date(item.createdAt).toLocaleString('zh-CN')} · 原始来源：${item.url || item.originalName || item.source || '手动输入'}`;
    head.append(type, title, meta); detail.append(head);
    const actions = document.createElement('div'); actions.className = 'detail-actions';
    if (item.assetPath || item.url || item.markdownPath) actions.append(makeButton('打开原件/链接', async () => { try { const error = await window.workbench.openMaterial(item.id); if (error) callbacks?.toast(error); } catch (error) { callbacks?.toast(error.message); } }));
    actions.append(makeButton(callbacks?.isReferenced(item.id) ? '取消引用' : '引用到当前作品', async () => { await callbacks?.toggleReference(item.id); renderDetail(); }, 'primary'));
    actions.append(makeButton('保存 Markdown', async () => { try { await window.workbench.materialMarkdown(item.id); await load(item.id); callbacks?.toast('Markdown 副本已保存'); } catch (error) { callbacks?.toast(error.message); } }));
    if (IMAGE.test(item.originalName || '')) actions.append(makeButton('图片理解', () => runAI('image')));
    if (VIDEO.test(item.originalName || '')) actions.append(makeButton('视频理解', () => runAI('video')));
    if (MEDIA.test(item.originalName || '')) actions.append(makeButton('音视频转文字', () => runAI('transcribe')), makeButton('音频理解', () => runAI('audio')));
    actions.append(makeButton('AI 整理', () => runAI('organize')), makeButton('AI 摘要', () => runAI('summarize')), makeButton('智能转 Markdown', () => runAI('convert')));
    detail.append(actions);
    const category = document.createElement('label'); category.textContent = '分类';
    const categoryInput = document.createElement('input'); categoryInput.id = 'detailCategory'; categoryInput.value = item.category; category.append(categoryInput); detail.append(category);
    const source = document.createElement('label'); source.textContent = '提取文字 / 原文（可补充）';
    const content = document.createElement('textarea'); content.id = 'detailContent'; content.value = item.content; content.placeholder = MEDIA.test(item.originalName || '') ? '点击“音视频转文字”，或手动补充逐字稿' : '粘贴或修订材料原文'; source.append(content); detail.append(source);
    detail.append(makeButton('保存修改', saveDetail, 'primary'));
    for (const [label, value] of [['AI 多模态理解 · 待核实', item.analysis], ['AI 摘要', item.summary], ['AI 整理结果', item.organizedText], ['智能 Markdown', item.convertedMarkdown]]) {
      if (!value) continue;
      const section = document.createElement('section'); section.className = 'derived-section';
      const h = document.createElement('h3'); h.textContent = label;
      const pre = document.createElement('pre'); pre.textContent = value;
      section.append(h, pre); detail.append(section);
    }
    if (item.markdownPath) { const pathText = document.createElement('p'); pathText.className = 'path-hint'; pathText.textContent = `Markdown：${item.markdownPath}`; detail.append(pathText); }
  }
  async function load(id = selectedId) {
    entries = await window.workbench.listMaterials();
    selectedId = entries.some(item => item.id === id) ? id : entries[0]?.id || null;
    refreshCategories(); renderList(); renderDetail(); callbacks?.onChange();
  }
  function show() { $('workspace').classList.add('hidden'); $('libraryView').classList.remove('hidden'); $('libraryButton').classList.add('active'); $('homeButton').classList.remove('active'); load().catch(error => callbacks?.toast(error.message)); }
  function hide() { $('workspace').classList.remove('hidden'); $('libraryView').classList.add('hidden'); $('libraryButton').classList.remove('active'); $('homeButton').classList.add('active'); }
  function openAdd(mode) {
    addMode = mode;
    $('materialDialogTitle').textContent = { file: '上传文件', link: '添加链接', text: '粘贴原文' }[mode];
    $('newMaterialUrlWrap').classList.toggle('hidden', mode !== 'link');
    $('newMaterialTextWrap').classList.toggle('hidden', mode === 'file');
    $('newMaterialTextWrap').querySelector('textarea').placeholder = mode === 'link' ? '可选：粘贴网页原文。填写后以你提供的原文为准并保留链接。' : '粘贴公众号文章、小红书原文、飞书文档内容或纯文本';
    $('newMaterialTitle').value = ''; $('newMaterialUrl').value = ''; $('newMaterialText').value = '';
    for (const id of ['newMaterialOrganize', 'newMaterialSummary', 'newMaterialConvert', 'newMaterialTranscribe']) $(id).checked = false;
    $('materialDialog').showModal();
  }
  async function processOptions(items, options) {
    for (const item of items) {
      if (options.transcribe && MEDIA.test(item.originalName || '')) { selectedId = item.id; await runAI('transcribe'); }
      if (!item.content && !options.transcribe) continue;
      for (const [key, action] of [['organize', 'organize'], ['summary', 'summarize'], ['convert', 'convert']]) {
        if (options[key]) { selectedId = item.id; await runAI(action); }
      }
    }
  }
  async function confirmAdd() {
    if (busy) return;
    busy = true; $('confirmAddMaterial').disabled = true;
    const input = { title: $('newMaterialTitle').value, category: $('newMaterialCategory').value, storeMarkdown: $('newMaterialMarkdown').checked, url: $('newMaterialUrl').value, content: $('newMaterialText').value };
    const options = { transcribe: $('newMaterialTranscribe').checked, organize: $('newMaterialOrganize').checked, summary: $('newMaterialSummary').checked, convert: $('newMaterialConvert').checked };
    try {
      let added;
      if (addMode === 'file') added = await window.workbench.importMaterialFiles(input);
      else if (addMode === 'link') added = [await window.workbench.addMaterialLink(input)];
      else added = [await window.workbench.addMaterialText(input)];
      $('materialDialog').close();
      if (!added.length) return;
      await load(added[0].id);
      callbacks?.toast(`已导入 ${added.length} 条材料`);
      busy = false;
      if (Object.values(options).some(Boolean)) await processOptions(added, options);
    } catch (error) { callbacks?.toast(error.message, 12000); }
    finally { busy = false; $('confirmAddMaterial').disabled = false; }
  }
  function init(options) {
    callbacks = options;
    $('importFiles').onclick = () => openAdd('file'); $('addLink').onclick = () => openAdd('link'); $('addText').onclick = () => openAdd('text');
    $('closeMaterialDialog').onclick = () => $('materialDialog').close(); $('confirmAddMaterial').onclick = confirmAdd;
    $('materialSearch').oninput = renderList; $('materialCategoryFilter').onchange = renderList;
    load().catch(error => callbacks?.toast(error.message));
  }
  window.libraryUI = { init, load, show, hide, getMaterial };
})();
