const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MEDIA_EXTENSIONS } = require('./materials.cjs');

function ffmpegPath() {
  const bundled = require('ffmpeg-static');
  return process.resourcesPath && bundled.includes('app.asar') ? bundled.replace('app.asar', 'app.asar.unpacked') : bundled;
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`音轨提取失败：${errorText}`)); });
  });
}
async function transcribeChunk(file, api, fetcher = fetch) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > 7 * 1024 * 1024) throw new Error('音频分段超过接口大小限制');
  if (api.provider === 'custom') {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), path.basename(file));
    form.append('model', api.model);
    const response = await fetcher(`${api.baseUrl}/audio/transcriptions`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${api.apiKey}` }, body: form });
    if (!response.ok) throw new Error(`转文字接口失败（${response.status}）：${(await response.text()).slice(0, 300)}`);
    const payload = await response.json();
    if (typeof payload.text !== 'string') throw new Error('转文字接口未返回 text');
    return payload.text.trim();
  }
  if (api.provider && api.provider !== 'qwen') throw new Error('转文字目前支持千问 ASR 或兼容 /audio/transcriptions 的自定义接口');
  const response = await fetcher(`${api.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({ model: api.model || 'qwen3-asr-flash', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${bytes.toString('base64')}` } }] }], stream: false, asr_options: { enable_itn: true } })
  });
  if (!response.ok) throw new Error(`千问语音识别失败（${response.status}）：${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('语音接口未返回文字');
  return text.trim();
}
async function transcribeMedia(file, api, fetcher = fetch) {
  if (!file || !MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) throw new Error('请选择已导入的音视频文件');
  if (!api?.apiKey || !api?.baseUrl) throw new Error('请先配置千问官方 API 密钥');
  const { temp, parts } = await splitAudio(file);
  try {
    const transcript = [];
    for (const [index, name] of parts.entries()) {
      const text = await transcribeChunk(path.join(temp, name), api, fetcher);
      transcript.push(parts.length === 1 ? text : `## 第 ${index + 1} 段\n\n${text}`);
    }
    return transcript.join('\n\n').trim();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
async function splitAudio(file) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-asr-'));
  try {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'segment', '-segment_time', '270', '-reset_timestamps', '1', path.join(temp, 'part-%03d.mp3')]);
    const parts = fs.readdirSync(temp).filter(name => /^part-\d{3}\.mp3$/.test(name)).sort();
    if (!parts.length) throw new Error('文件中未检测到可用音轨');
    return { temp, parts };
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
}
module.exports = { transcribeMedia, transcribeChunk, ffmpegPath, splitAudio, runFfmpeg };
