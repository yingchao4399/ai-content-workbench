(() => {
  const $ = id => document.getElementById(id);
  const MODES = ['note', 'wechat', 'fiction', 'poetry', 'essay'];
  const LABELS = { note: '笔记', wechat: '公众号', fiction: '小说', poetry: '诗歌', essay: '散文' };
  let entries = [], selectedId = null, callbacks = null;
  const fields = ['studioName', 'studioTitle', 'studioDescription', 'studioSource', 'studioBody', 'studioTestInput', 'studioExpected'];
  function formData() {
    return { name: $('studioName').value.trim(), title: $('studioTitle').value.trim(), description: $('studioDescription').value.trim(), source: $('studioSource').value.trim(), body: $('studioBody').value.trim(), testInput: $('studioTestInput').value.trim(), expected: $('studioExpected').value.trim(), modes: [...document.querySelectorAll('#studioView fieldset input:checked')].map(input => input.value) };
  }
  function fill(item = null) {
    $('studioName').value = item?.name || ''; $('studioName').disabled = Boolean(item);
    $('studioTitle').value = item?.title || '';
    $('studioDescription').value = item?.description || '';
    $('studioSource').value = item?.source || '';
    $('studioBody').value = item?.body || '';
    $('studioTestInput').value = item?.testInput || '';
    $('studioExpected').value = item?.expected || '';
    for (const input of document.querySelectorAll('#studioView fieldset input')) input.checked = item?.modes.includes(input.value) || false;
    $('studioStatus').textContent = item ? `${item.status === 'installed' ? '已安装' : '草稿'} · 适用于${item.modes.map(mode => LABELS[mode]).join('、')}` : '新 Skill：填写用途和规则，保存草稿后安装。';
    $('studioPreview').textContent = '';
    $('uninstallSkill').disabled = item?.status !== 'installed';
    $('useSkill').disabled = item?.status !== 'installed';
    $('exportSkill').disabled = !item;
  }
  function renderList() {
    const list = $('studioList'); list.replaceChildren();
    if (!entries.length) { const empty = document.createElement('p'); empty.textContent = '还没有自定义 Skill。新建或导入一个。'; list.append(empty); }
    for (const item of entries) {
      const button = document.createElement('button'); button.className = `studio-item${item.id === selectedId ? ' active' : ''}`;
      const name = document.createElement('b'); name.textContent = item.title;
      const meta = document.createElement('small'); meta.textContent = `${item.status === 'installed' ? '已安装' : '草稿'} · ${item.modes.map(mode => LABELS[mode]).join('、')}`;
      button.append(name, meta); button.onclick = () => select(item.id); list.append(button);
    }
  }
  function renderBuiltins(catalog) {
    const parent = $('studioBuiltins'); parent.replaceChildren();
    for (const item of catalog.filter(skill => skill.kind === 'built-in')) {
      const row = document.createElement('div'); row.className = 'studio-builtin';
      const title = document.createElement('b'); title.textContent = item.title;
      const summary = document.createElement('small'); summary.textContent = item.summary;
      row.append(title, summary);
      if (/^https:\/\//.test(item.source || '')) { const link = document.createElement('a'); link.href = item.source; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '查看来源'; row.append(link); }
      parent.append(row);
    }
  }
  function select(id) { selectedId = id; fill(entries.find(item => item.id === id)); renderList(); }
  async function load(id = selectedId) {
    entries = await window.workbench.listCustomSkills();
    renderBuiltins(await window.workbench.skillCatalog());
    selectedId = entries.some(item => item.id === id) ? id : entries[0]?.id || null;
    fill(entries.find(item => item.id === selectedId)); renderList();
  }
  async function check() {
    try {
      const result = await window.workbench.validateSkill(formData());
      $('studioPreview').textContent = result.preview;
      $('studioStatus').textContent = result.ok ? `结构检查通过。${result.warnings.join('；') || '可保存、安装或打包。'}` : `需修改：${result.errors.join('；')}`;
      return result;
    } catch (error) { $('studioStatus').textContent = error.message; return { ok: false }; }
  }
  async function design() {
    const input = formData();
    if (!input.title || !input.description || !input.modes.length) { $('studioStatus').textContent = '先填写展示名称、用途与适用文体，再让 AI 起草规则。'; return; }
    const button = $('designSkill'); button.disabled = true;
    $('studioStatus').textContent = 'AI 正在起草 Skill，生成后请审阅并检查结构…';
    try {
      const result = await window.workbench.designSkill({ title: input.title, purpose: input.description, modes: input.modes, testInput: input.testInput, expected: input.expected });
      $('studioDescription').value = result.description;
      $('studioBody').value = result.body;
      $('studioTestInput').value = result.testInput;
      $('studioExpected').value = result.expected;
      $('studioStatus').textContent = 'AI 草稿已填入。请核对规则与检查点，再保存并安装。';
      await check();
    } catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message, 9000); }
    finally { button.disabled = false; }
  }
  async function save() {
    const validation = await check(); if (!validation.ok) return null;
    try {
      const item = await window.workbench.saveSkill(formData());
      await load(item.id); callbacks?.onCatalogChange();
      callbacks?.toast('Skill 草稿已保存；安装后才能用于作品');
      return item;
    } catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message); return null; }
  }
  async function install() {
    const saved = await save(); if (!saved) return;
    try { await window.workbench.installSkill(saved.id, true); await load(saved.id); await callbacks?.onCatalogChange(); callbacks?.toast('Skill 已安装，可在作品中选择使用'); }
    catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message); }
  }
  async function setInstalled(installed) {
    if (!selectedId) return;
    try { await window.workbench.installSkill(selectedId, installed); await load(selectedId); await callbacks?.onCatalogChange(); callbacks?.toast(installed ? 'Skill 已安装' : 'Skill 已停用'); }
    catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message); }
  }
  async function exportCurrent() {
    if (!selectedId) return;
    try { const file = await window.workbench.exportSkill(selectedId); if (file) callbacks?.toast(`Skill 包已保存：${file}`, 10000); }
    catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message); }
  }
  async function importCurrent() {
    try { const item = await window.workbench.importSkill(); if (item) { await load(item.id); callbacks?.toast('Skill 已导入为草稿；检查后点击安装'); } }
    catch (error) { $('studioStatus').textContent = error.message; callbacks?.toast(error.message); }
  }
  function show() {
    window.libraryUI?.hide(); $('workspace').classList.add('hidden'); $('libraryView').classList.add('hidden'); $('studioView').classList.remove('hidden');
    $('skillStudioButton').classList.add('active'); $('homeButton').classList.remove('active'); $('libraryButton').classList.remove('active');
    load().catch(error => callbacks?.toast(error.message));
  }
  function hide() { $('studioView').classList.add('hidden'); $('skillStudioButton').classList.remove('active'); }
  function init(options) {
    callbacks = options;
    $('newSkill').onclick = () => { selectedId = null; fill(); renderList(); $('studioName').focus(); };
    $('importSkill').onclick = importCurrent;
    $('designSkill').onclick = design; $('validateSkill').onclick = check; $('saveSkill').onclick = save; $('installSkill').onclick = install; $('uninstallSkill').onclick = () => setInstalled(false); $('exportSkill').onclick = exportCurrent;
    $('useSkill').onclick = async () => { const item = entries.find(entry => entry.id === selectedId); if (!item || item.status !== 'installed') return; if (!item.modes.includes(callbacks?.currentMode())) { callbacks?.toast('当前作品的文体不适用此 Skill'); return; } await callbacks?.useSkill(item.id); callbacks?.toast('已用于当前作品'); };
    load().catch(error => callbacks?.toast(error.message));
  }
  window.studioUI = { init, show, hide, load };
})();
