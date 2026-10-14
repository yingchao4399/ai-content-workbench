const PROVIDERS = Object.freeze({
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  kimi: { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  zhipu: { label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  qwen: { label: '千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  custom: { label: '自定义兼容接口', baseUrl: 'https://api.openai.com/v1' }
});
const ZHIPU_DOC = 'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8.md';

function validateBaseUrl(value) {
  const url = new URL(String(value).replace(/\/+$/, ''));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('接口地址必须使用 HTTPS，或本机 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含账号、参数或片段');
  return url.href.replace(/\/+$/, '');
}
function parseZhipuModels(markdown) {
  return [...new Set([...String(markdown).matchAll(/^\s*-\s+(glm-\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?)\s*$/gm)].map(match => match[1]).filter(id => !/(?:voice|vision|video)/.test(id)))];
}
async function requestJson(url, apiKey, fetcher) {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`模型列表请求失败（${response.status}）`);
  return response.json();
}
async function listModels(provider, profile, apiKey, fetcher = fetch) {
  if (!PROVIDERS[provider]) throw new Error('未知 AI 服务商');
  if (provider === 'zhipu') {
    const response = await fetcher(ZHIPU_DOC, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`智谱官方模型文档读取失败（${response.status}）`);
    const models = parseZhipuModels(await response.text());
    if (!models.length) throw new Error('智谱官方文档格式已变化，请手动填写模型名称');
    return { models, source: '智谱官方模型文档', sourceUrl: ZHIPU_DOC, fetchedAt: new Date().toISOString() };
  }
  if (!apiKey) throw new Error('请先填写或保存该服务商的 API 密钥');
  const baseUrl = validateBaseUrl(profile.baseUrl || PROVIDERS[provider].baseUrl);
  let models;
  if (provider === 'qwen') {
    const origin = new URL(baseUrl).origin;
    models = [];
    for (let page = 1; page <= 20; page++) {
      const url = `${origin}/api/v1/models?providers=qwen&page_no=${page}&page_size=100`;
      const data = await requestJson(url, apiKey, fetcher);
      const batch = data.output?.models || [];
      models.push(...batch.map(x => x.model || x.name).filter(Boolean));
      if (models.length >= Number(data.output?.total || 0) || batch.length < 100) break;
    }
  } else {
    const data = await requestJson(`${baseUrl}/models`, apiKey, fetcher);
    models = (data.data || []).map(x => x.id).filter(Boolean);
  }
  return { models: [...new Set(models)].sort(), source: provider === 'qwen' ? '阿里云百炼官方模型列表' : `${PROVIDERS[provider].label} 官方模型列表`, fetchedAt: new Date().toISOString() };
}
module.exports = { PROVIDERS, ZHIPU_DOC, validateBaseUrl, parseZhipuModels, listModels };
