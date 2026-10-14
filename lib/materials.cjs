const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const mammoth = require('mammoth');

const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4', '.mov', '.mkv', '.webm', '.avi']);
const EXTENSIONS = new Set(['.pdf', '.docx', '.md', '.markdown', '.txt', '.html', '.htm', '.json', '.csv', '.enex', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', ...MEDIA_EXTENSIONS]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const MAX_FILE = 25 * 1024 * 1024;
const MAX_TEXT = 300000;
function stripHtml(html) {
  const $ = load(String(html), { xmlMode: false });
  $('script,style,noscript,nav,footer,header').remove();
  const root = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
  const blocks = root.find('h1,h2,h3,h4,p,li,blockquote,pre').map((_i, node) => $(node).text().trim()).get().filter(Boolean);
  const text = blocks.length ? blocks.join('\n\n') : (root.text() || $.text());
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
function validateLink(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('材料链接需要标准 HTTPS 地址');
  if (/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\]|.*\.local)$/i.test(url.hostname)) throw new Error('不能导入本机或局域网链接');
  return url.href;
}
function pageText(html) {
  const $ = load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  const text = stripHtml(html);
  const blocked = /登录|验证码|访问受限|sign in|log in|captcha/i.test(title);
  return { title: title.slice(0, 200), content: !blocked && text.length > 100 ? text.slice(0, MAX_TEXT) : '', description: description.slice(0, 500) };
}
async function fetchPage(url, fetcher = fetch) {
  let next = validateLink(url);
  for (let i = 0; i < 5; i++) {
    const response = await fetcher(next, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 AI-Content-Workbench/0.1' } });
    if (response.status >= 300 && response.status < 400) { next = validateLink(new URL(response.headers.get('location'), next).href); continue; }
    if (!response.ok) throw new Error(`网页读取失败（${response.status}），可手动粘贴原文`);
    if (!String(response.headers.get('content-type') || '').includes('text/html')) throw new Error('链接不是可提取的网页，请下载文件后导入');
    if (Number(response.headers.get('content-length') || 0) > 3 * 1024 * 1024) throw new Error('网页过大，请手动粘贴原文');
    const html = await response.text();
    if (html.length > 3 * 1024 * 1024) throw new Error('网页过大，请手动粘贴原文');
    return pageText(html);
  }
  throw new Error('网页重定向次数过多');
}
async function extractFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return { content: '', status: '音视频已保存，可点击转文字' };
  if (IMAGE_EXTENSIONS.has(ext)) return { content: '', status: '图片已保存，请补充图片说明或转录文字' };
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(file) });
    try { const result = await parser.getText(); return { content: String(result.text || '').slice(0, MAX_TEXT), status: result.text?.trim() ? '已提取文本' : '扫描件无可提取文字，请补充原文' }; }
    finally { await parser.destroy(); }
  }
  if (ext === '.docx') { const result = await mammoth.extractRawText({ path: file }); return { content: result.value.slice(0, MAX_TEXT), status: '已提取文本' }; }
  const raw = fs.readFileSync(file, 'utf8');
  if (['.html', '.htm', '.enex'].includes(ext)) return { content: stripHtml(raw).slice(0, MAX_TEXT), status: '已提取文本' };
  if (ext === '.json') return { content: JSON.stringify(JSON.parse(raw), null, 2).slice(0, MAX_TEXT), status: '已提取文本' };
  return { content: raw.slice(0, MAX_TEXT), status: '已提取文本' };
}
function category(value) { return String(value || '未分类').trim().slice(0, 40) || '未分类'; }
function title(value) { return String(value || '').trim().slice(0, 200); }
function toMarkdown(material) {
  const source = material.url || material.originalName || material.source || '手动输入';
  const body = material.convertedMarkdown || material.organizedText || material.content || '';
  return `# ${material.title || '未命名材料'}\n\n> 分类：${material.category}  \n> 来源：${source}  \n> 导入时间：${material.createdAt}  \n> 提取状态：${material.status}\n\n${body}\n${material.summary ? `\n## AI 摘要\n\n${material.summary}\n` : ''}${material.analysis ? `\n## AI 多模态理解（待核实）\n\n${material.analysis}\n` : ''}`;
}
function createMaterialStore(root) {
  const records = path.join(root, 'materials', 'records');
  const assets = path.join(root, 'materials', 'files');
  const markdown = path.join(root, 'materials', 'markdown');
  for (const dir of [records, assets, markdown]) fs.mkdirSync(dir, { recursive: true });
  function fileOf(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('材料编号无效'); return path.join(records, `${id}.json`); }
  function get(id) { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); }
  function save(item) { fs.writeFileSync(fileOf(item.id), JSON.stringify(item, null, 2), 'utf8'); return item; }
  function withMarkdown(item, enabled) {
    if (enabled) { item.markdownPath = path.join(markdown, `${item.id}.md`); fs.writeFileSync(item.markdownPath, toMarkdown(item), 'utf8'); }
    return save(item);
  }
  function base(type, input) { return { id: crypto.randomUUID(), type, title: title(input.title), category: category(input.category), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: '', summary: '', organizedText: '', convertedMarkdown: '', analysis: '', status: '', url: '', originalName: '', assetPath: '', markdownPath: '', source: '' }; }
  return {
    root,
    list() { return fs.readdirSync(records).filter(x => /^[a-f0-9-]{36}\.json$/.test(x)).map(x => JSON.parse(fs.readFileSync(path.join(records, x), 'utf8'))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    get,
    async importFile(file, input = {}) {
      const ext = path.extname(file).toLowerCase();
      if (!EXTENSIONS.has(ext)) throw new Error('暂不支持此格式；可导出为 PDF、DOCX、Markdown、HTML、JSON、CSV、ENEX、TXT 或图片');
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > (MEDIA_EXTENSIONS.has(ext) ? 500 * 1024 * 1024 : MAX_FILE)) throw new Error(MEDIA_EXTENSIONS.has(ext) ? '音视频需要小于 500 MB' : '文档需要小于 25 MB');
      const item = base('file', input);
      item.originalName = path.basename(file);
      item.title ||= path.basename(file, ext);
      item.assetPath = path.join(assets, `${item.id}${ext}`);
      fs.copyFileSync(file, item.assetPath);
      try { Object.assign(item, await extractFile(item.assetPath)); }
      catch (error) { item.status = `原件已保存，提取失败：${error.message}`.slice(0, 300); }
      return withMarkdown(item, Boolean(input.storeMarkdown));
    },
    async addLink(input, fetcher = fetch) {
      const item = base('link', input);
      item.url = validateLink(input.url);
      item.title ||= new URL(item.url).hostname;
      if (String(input.content || '').trim()) { item.content = String(input.content).slice(0, MAX_TEXT); item.status = '原文由用户提供，链接已保存'; }
      else try {
        const page = await fetchPage(item.url, fetcher);
        if (!input.title) item.title = page.title || item.title;
        item.content = page.content;
        item.status = page.content ? '已提取公开网页正文' : '链接已保存，请手动粘贴原文';
      } catch (error) { item.status = `链接已保存，需手动补充原文：${error.message}`.slice(0, 300); }
      return withMarkdown(item, Boolean(input.storeMarkdown));
    },
    addText(input) {
      const item = base(input.type === 'generated' ? 'generated' : 'text', input);
      item.content = String(input.content || '').slice(0, MAX_TEXT);
      if (!item.content.trim()) throw new Error('请输入材料原文');
      item.title ||= item.content.slice(0, 30);
      item.source = String(input.source || '').slice(0, 300);
      item.status = item.type === 'generated' ? 'AI 生成，需人工核实' : '手动输入';
      return withMarkdown(item, Boolean(input.storeMarkdown));
    },
    update(id, input) {
      const item = get(id);
      if (input.title !== undefined) item.title = title(input.title);
      if (input.category !== undefined) item.category = category(input.category);
      if (input.content !== undefined) item.content = String(input.content).slice(0, MAX_TEXT);
      if (input.status !== undefined) item.status = String(input.status).slice(0, 300);
      if (input.summary !== undefined) item.summary = String(input.summary).slice(0, MAX_TEXT);
      if (input.organizedText !== undefined) item.organizedText = String(input.organizedText).slice(0, MAX_TEXT);
      if (input.convertedMarkdown !== undefined) item.convertedMarkdown = String(input.convertedMarkdown).slice(0, MAX_TEXT);
      if (input.analysis !== undefined) item.analysis = String(input.analysis).slice(0, MAX_TEXT);
      item.updatedAt = new Date().toISOString();
      return withMarkdown(item, Boolean(input.storeMarkdown || item.markdownPath));
    },
    writeMarkdown(id) { return withMarkdown(get(id), true); }
  };
}
module.exports = { createMaterialStore, EXTENSIONS, MEDIA_EXTENSIONS, stripHtml, pageText, validateLink, fetchPage, toMarkdown };
