const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runFfmpeg, splitAudio } = require('./transcription.cjs');

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const VIDEOS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
const AUDIOS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma']);
function unpacked(binary) { return binary.includes('app.asar') ? binary.replace('app.asar', 'app.asar.unpacked') : binary; }
function dataUrl(file, mime) { return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`; }
function responseText(raw) {
  if (raw.startsWith('data:')) {
    let result = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === '[DONE]') continue;
      try { result += JSON.parse(chunk).choices?.[0]?.delta?.content || ''; } catch {}
    }
    return result.trim();
  }
  const payload = JSON.parse(raw);
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : Array.isArray(content) ? content.map(part => part.text || '').join('').trim() : '';
}
async function ask(api, content, fetcher = fetch) {
  const qwen = api.provider === 'qwen';
  const response = await fetcher(`${api.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content }], ...(qwen ? { stream: true, modalities: ['text'] } : {}) })
  });
  if (!response.ok) throw new Error(`多模态接口返回 ${response.status}：${(await response.text()).slice(0, 300)}`);
  const text = responseText(await response.text());
  if (!text) throw new Error('多模态接口未返回文字结果');
  return text;
}
function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(unpacked(require('ffprobe-static').path), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', part => { output += part; });
    child.stderr.on('data', part => { errors += part; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Number(output.trim()) || 0) : reject(new Error(`视频时长读取失败：${errors.slice(-200)}`)); });
  });
}
async function imageParts(file, temp) {
  const normalized = path.join(temp, 'image.jpg');
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=1600:1600:force_original_aspect_ratio=decrease', '-q:v', '3', normalized]);
  return [{ type: 'image_url', image_url: { url: dataUrl(normalized, 'image/jpeg') } }];
}
async function videoParts(file, temp, provider) {
  if (provider === 'qwen' && fs.statSync(file).size <= 7 * 1024 * 1024) {
    return [{ type: 'video_url', video_url: { url: dataUrl(file, '') } }];
  }
  const duration = await probeDuration(file);
  const interval = Math.max(0.5, duration / 8);
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=1/${interval},scale=960:960:force_original_aspect_ratio=decrease`, '-frames:v', '8', '-q:v', '4', path.join(temp, 'frame-%03d.jpg')]);
  const frames = fs.readdirSync(temp).filter(name => /^frame-\d{3}\.jpg$/.test(name)).sort();
  if (!frames.length) throw new Error('视频未提取出可用画面');
  const urls = frames.map(name => dataUrl(path.join(temp, name), 'image/jpeg'));
  return provider === 'qwen'
    ? [{ type: 'video', video: urls }]
    : urls.map(url => ({ type: 'image_url', image_url: { url } }));
}
async function understandMedia(material, capability, api, fetcher = fetch) {
  const file = material?.assetPath;
  if (!file || !fs.existsSync(file)) throw new Error('材料原件不存在，请重新导入');
  const ext = path.extname(file).toLowerCase();
  if (capability === 'image' && !IMAGES.has(ext)) throw new Error('请选择图片材料');
  if (capability === 'video' && !VIDEOS.has(ext)) throw new Error('请选择视频材料');
  if (capability === 'audio' && !AUDIOS.has(ext) && !VIDEOS.has(ext)) throw new Error('请选择音频或视频材料');
  if (!api?.apiKey || !api?.model || !api?.baseUrl) throw new Error('请先配置该能力的接口、模型与密钥');
  if (capability === 'audio' && api.provider !== 'qwen' && api.provider !== 'custom') throw new Error('音频理解目前支持千问 Omni 或兼容 input_audio 的自定义接口');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-vision-'));
  try {
    if (capability === 'audio') {
      const { temp: audioTemp, parts } = await splitAudio(file);
      try {
        const result = [];
        for (const [index, name] of parts.entries()) {
          const content = [
            { type: 'text', text: `分析这段音频的主要内容、说话者与写作可用信息，区分听到的事实和推断。已有转录供参考：${String(material.content || '').slice(0, 5000)}` },
            { type: 'input_audio', input_audio: { data: `data:;base64,${fs.readFileSync(path.join(audioTemp, name)).toString('base64')}`, format: 'mp3' } }
          ];
          result.push(`## 片段 ${index + 1}\n\n${await ask(api, content, fetcher)}`);
        }
        return result.join('\n\n');
      } finally { fs.rmSync(audioTemp, { recursive: true, force: true }); }
    }
    const parts = capability === 'image' ? await imageParts(file, temp) : await videoParts(file, temp, api.provider);
    const visualNote = capability === 'video' && parts[0].type !== 'video_url' ? '以下是从视频中均匀抽取的有限画面，无法确认未抽到的片段；' : '';
    const prompt = capability === 'image'
      ? '分析图片的可见内容，并尽量转录其中的文字。区分看得见的事实、推断和无法确认的信息。'
      : `${visualNote}概括视频画面、事件顺序和可用于写作的线索。若未输入音轨，不要推断声音或对白。已有转录供参考：${String(material.content || '').slice(0, 5000)}`;
    return ask(api, [{ type: 'text', text: prompt }, ...parts], fetcher);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { understandMedia, responseText, ask, videoParts };
