// Provider configuration is shared by the settings UI and the privileged backend.
export const AI_PROVIDERS = {
  gemini: { name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', keysUrl: 'https://aistudio.google.com/apikey' },
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', keysUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Claude · Anthropic', endpoint: 'https://api.anthropic.com/v1', keysUrl: 'https://platform.claude.com/settings/keys' },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', keysUrl: 'https://platform.deepseek.com/api_keys' },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', keysUrl: 'https://openrouter.ai/settings/keys' },
  custom: { name: 'API tương thích OpenAI', endpoint: '', keysUrl: '' },
  ollama: { name: 'Ollama · chạy trên máy này', endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b', keysUrl: '' }
};
class StreamError extends Error {}
export function providerConfig(input = {}) {
  const provider = Object.hasOwn(AI_PROVIDERS, input.provider) ? input.provider : 'gemini';
  const preset = AI_PROVIDERS[provider];
  let endpoint = ['ollama', 'custom'].includes(provider) ? String(input.endpoint || preset.endpoint).trim().replace(/\/+$/, '') : preset.endpoint;
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Nhập địa chỉ API hợp lệ, ví dụ https://example.com/v1.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local)) throw new Error('API cần dùng HTTPS; HTTP chỉ dùng cho máy này. Không thêm key, query hoặc mật khẩu vào URL.');
  if (provider === 'ollama' && (!local || url.pathname !== '/')) throw new Error('Ollama phải chạy trên máy này, ví dụ http://127.0.0.1:11434.');
  if (provider === 'custom') endpoint = endpoint.replace(/\/(?:chat\/completions|models)$/, '');
  return { provider, endpoint };
}
export function credentialScope(input) {
  const { provider, endpoint } = providerConfig(input);
  return provider === 'custom' ? `custom:${endpoint}` : provider;
}
export function providerError(status, provider) {
  const name = AI_PROVIDERS[provider]?.name || 'Dịch vụ AI';
  const hints = {
    400: 'Kiểm tra tên model, giới hạn token và khả năng nhận ảnh của model.',
    401: 'API key không hợp lệ hoặc hết hiệu lực. Nhập lại key trong Cài đặt.',
    402: 'Tài khoản chưa đủ số dư/hạn mức. Kiểm tra billing của dịch vụ.',
    403: 'Key không có quyền truy cập. Kiểm tra quyền của key hoặc chọn model khác.',
    404: 'Không tìm thấy model hoặc API. Kiểm tra tên model và Base URL.',
    413: 'Ảnh hoặc lịch sử quá lớn. Hãy giảm số ảnh hoặc mở hội thoại mới.',
    429: 'Dịch vụ giới hạn tốc độ hoặc hết hạn mức. Kiểm tra quota rồi thử lại.'
  };
  return `${name} (${status}): ${hints[status] || 'Dịch vụ chưa phản hồi được. Hãy thử lại sau.'}`;
}
function headersFor(provider, apiKey) {
  if (apiKey && /[\r\n]/.test(apiKey)) throw new Error('API key không hợp lệ.');
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') Object.assign(headers, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
  else if (provider === 'gemini') headers['x-goog-api-key'] = apiKey;
  else if (apiKey && provider !== 'ollama') headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}
function requireKey(provider, apiKey) {
  if (!apiKey && !['ollama', 'custom'].includes(provider)) throw new Error(`Chưa có API key ${AI_PROVIDERS[provider].name}. Mở Cài đặt để nhập key của dịch vụ này.`);
}
async function readJSON(response) {
  try { return await response.json(); }
  catch { throw new Error('Dịch vụ trả về dữ liệu không hợp lệ. Kiểm tra địa chỉ API rồi thử lại.'); }
}
export async function listAIModels({ settings, apiKey, fetchImpl = fetch, signal }) {
  const { provider, endpoint } = providerConfig(settings);
  requireKey(provider, apiKey);
  const timeout = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const models = new Set();
  let next = '', pages = 0;
  do {
    let suffix = provider === 'ollama' ? '/api/tags' : '/models';
    if (provider === 'gemini') suffix += '?pageSize=100' + (next ? `&pageToken=${encodeURIComponent(next)}` : '');
    if (provider === 'anthropic') suffix += '?limit=100' + (next ? `&after_id=${encodeURIComponent(next)}` : '');
    let response;
    try { response = await fetchImpl(endpoint + suffix, { headers: headersFor(provider, apiKey), signal: requestSignal, redirect: 'error' }); }
    catch { throw new Error('Không tải được danh sách model. Kiểm tra kết nối/Base URL; bạn vẫn có thể nhập tên model trực tiếp.'); }
    if (!response.ok) throw new Error(providerError(response.status, provider));
    const data = await readJSON(response);
    const entries = provider === 'gemini' ? (data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')) : provider === 'ollama' ? data.models || [] : data.data || [];
    for (const entry of entries) {
      const id = provider === 'gemini' ? entry.name?.replace(/^models\//, '') : provider === 'ollama' ? entry.name : entry.id;
      if (typeof id === 'string' && /^[\w./:-]{1,200}$/.test(id)) models.add(id);
    }
    next = provider === 'gemini' ? data.nextPageToken : provider === 'anthropic' && data.has_more ? data.last_id : '';
  } while (next && ++pages < 10);
  return [...models].sort();
}
export function makeAIRequest({ settings, apiKey, system, contents, stream }) {
  const { provider, endpoint } = providerConfig(settings);
  requireKey(provider, apiKey);
  const model = settings.chatModel || settings.model;
  const limit = settings.chatOutputTokens || 4096;
  const messages = contents.map(turn => {
    const role = turn.role === 'model' ? 'assistant' : 'user';
    if (provider === 'ollama') {
      const images = turn.parts.filter(p => p.inlineData).map(p => p.inlineData.data);
      return { role, content: turn.parts.map(p => p.text || '').join('\n'), ...(images.length ? { images } : {}) };
    }
    const content = turn.parts.flatMap(part => {
      if (part.text) return [{ type: 'text', text: part.text }];
      if (!part.inlineData) return [];
      const { mimeType, data } = part.inlineData;
      return provider === 'anthropic' ? [{ type: 'image', source: { type: 'base64', media_type: mimeType, data } }] : [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } }];
    });
    // Text-only compatible APIs (notably DeepSeek assistant history) require strings.
    return { role, content: provider !== 'anthropic' && content.every(p => p.type === 'text') ? content.map(p => p.text).join('\n') : content };
  });
  let body, suffix;
  if (provider === 'anthropic') {
    suffix = '/messages'; body = { model, system, messages, stream, max_tokens: limit };
  } else if (provider === 'ollama') {
    suffix = '/api/chat'; body = { model, stream, messages: [{ role: 'system', content: system }, ...messages], options: { num_predict: limit } };
  } else {
    suffix = '/chat/completions'; body = { model, stream, messages: [{ role: 'system', content: system }, ...messages], [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: limit };
    if (provider === 'openai' && stream) body.stream_options = { include_usage: true };
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > 18 * 1024 * 1024) throw new Error('Ảnh và lịch sử quá lớn. Hãy giảm số ảnh hoặc bắt đầu hội thoại mới.');
  return { url: endpoint + suffix, method: 'POST', headers: headersFor(provider, apiKey), body: serialized, redirect: 'error' };
}
export async function completeAI({ settings, apiKey, system, contents, signal, fetchImpl = fetch }) {
  const request = makeAIRequest({ settings, apiKey, system, contents, stream: false });
  const timeout = AbortSignal.timeout(45000);
  let response;
  try { response = await fetchImpl(request.url, { ...request, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
  catch { throw new Error(signal?.aborted ? 'Đã hủy yêu cầu.' : 'Không kết nối được dịch vụ AI hoặc dịch vụ phản hồi quá chậm.'); }
  if (!response.ok) throw new Error(providerError(response.status, settings.provider));
  const result = await readJSON(response);
  const text = settings.provider === 'anthropic' ? result.content?.filter(p => p.type === 'text').map(p => p.text).join('') : settings.provider === 'ollama' ? result.message?.content : result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Model chưa trả về nội dung. Chọn model có khả năng sinh văn bản.');
  return text;
}
export async function streamAI({ settings, apiKey, system, contents, signal, fetchImpl = fetch, onEvent = () => {} }) {
  const { provider } = providerConfig(settings);
  const request = makeAIRequest({ settings, apiKey, system, contents, stream: true });
  let response;
  try { response = await fetchImpl(request.url, { ...request, signal }); }
  catch { throw new Error(signal?.aborted ? 'Đã dừng trả lời.' : 'Không kết nối được dịch vụ AI. Kiểm tra Internet và Base URL.'); }
  if (!response.ok) throw new Error(providerError(response.status, provider));
  if (!response.body) throw new Error('Dịch vụ không hỗ trợ trả lời streaming.');
  const model = settings.chatModel || settings.model;
  onEvent({ model, fallback: false });
  let text = '', pending = '', usage = null, finish = null, ended = false;
  const decoder = new TextDecoder();
  const consume = raw => {
    const data = provider === 'ollama' ? raw.trim() : raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { ended = true; return; }
    let chunk; try { chunk = JSON.parse(data); } catch { throw new StreamError('Phản hồi streaming không hợp lệ. Hãy thử lại.'); }
    if (chunk.error || chunk.type === 'error') throw new StreamError(providerError(500, provider));
    let delta = '';
    if (provider === 'anthropic') {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') delta = chunk.delta.text || '';
      if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'text') delta = chunk.content_block.text || '';
      if (chunk.type === 'message_start') usage = chunk.message?.usage || null;
      if (chunk.type === 'message_delta') { finish = chunk.delta?.stop_reason || finish; usage = { ...usage, ...chunk.usage }; }
      if (chunk.type === 'message_stop') ended = true;
    } else if (provider === 'ollama') {
      delta = chunk.message?.content || '';
      if (chunk.done) { finish = chunk.done_reason || 'stop'; ended = true; usage = { input_tokens: chunk.prompt_eval_count, output_tokens: chunk.eval_count }; }
    } else {
      const choice = chunk.choices?.[0]; delta = choice?.delta?.content || '';
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }
    if (typeof delta !== 'string') throw new StreamError('Dịch vụ trả về nội dung không hợp lệ.');
    text += delta; if (text.length > 100000) throw new StreamError('Câu trả lời vượt giới hạn. Hãy hỏi ngắn hơn.');
    if (delta) onEvent({ delta });
  };
  try {
    for await (const bytes of response.body) {
      if (signal?.aborted) throw new Error('Đã dừng trả lời.');
      pending += decoder.decode(bytes, { stream: true }).replace(/\r/g, '');
      if (pending.length > 1024 * 1024) throw new StreamError('Dịch vụ trả về khối dữ liệu quá lớn.');
      const delimiter = provider === 'ollama' ? '\n' : '\n\n'; let index;
      while ((index = pending.indexOf(delimiter)) >= 0) { consume(pending.slice(0, index)); pending = pending.slice(index + delimiter.length); }
    }
    pending += decoder.decode(); if (pending.trim()) consume(pending);
  } catch (error) {
    if (signal?.aborted) throw new Error('Đã dừng trả lời.');
    // Never surface remote body/transport messages that could echo credentials.
    if (error instanceof StreamError) throw error;
    throw new Error('Kết nối bị ngắt khi trả lời. Hãy thử lại.');
  }
  if (!finish || !ended) throw new Error('Kết nối đã ngắt trước khi AI trả lời xong. Nội dung một phần đã được giữ; nhấn Thử lại.');
  if (['content_filter', 'refusal'].includes(finish)) throw new Error('Model từ chối yêu cầu này. Hãy sửa câu hỏi.');
  if (!text.trim()) throw new Error('Model chưa trả về nội dung. Hãy chọn model khác hoặc tăng giới hạn đầu ra.');
  if (usage) {
    const input = usage.prompt_tokens ?? ((usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0));
    const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
    usage = { ...usage, promptTokenCount: input, candidatesTokenCount: output, totalTokenCount: usage.total_tokens ?? input + output };
  }
  return { text, model, fallback: false, usage, finish: ['length', 'max_tokens'].includes(finish) ? 'MAX_TOKENS' : finish };
}
