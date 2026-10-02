import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavigationHistory } from '../src/core/history.mjs';
import { lookupTerm, normalizeSelection, relevantTerms } from '../src/core/glossary.mjs';
import { protectIdentifiers, protectLineBreaks, translateEmbedded, validateSettings, abortableWait } from '../src/core/translation.mjs';

test('Back/Forward restore scroll and zoom, and a new jump discards forward history', () => {
  const h = new NavigationHistory();
  const a = { documentId: 'manual', page: 120, scale: 1.5, top: 381.1, left: 0 };
  const b = { documentId: 'manual', page: 350, scale: 2, top: 180, left: 32 };
  const c = { documentId: 'manual', page: 440, scale: 2, top: 50, left: 0 };
  h.record(a); h.record(b);
  assert.deepEqual(h.back(c), b); assert.deepEqual(h.back(b), a);
  assert.deepEqual(h.forward(a), b); assert.deepEqual(h.forward(b), c);
  assert.deepEqual(h.back(c), b);
  h.record(b); assert.equal(h.canForward, false);
  a.top = 0; assert.equal(h.back(c).top, 180);
});
test('embedded terms use technical meanings and selection retains line breaks', () => {
  assert.equal(lookupTerm('Register'), 'thanh ghi');
  assert.equal(lookupTerm('Interrupt.'), 'ngắt');
  assert.equal(lookupTerm('clock'), 'xung nhịp');
  assert.match(lookupTerm('volatile'), /C|thanh ghi/);
  assert.equal(normalizeSelection('inter-\nrupt\n  flag'), 'interrupt\n  flag');
  assert.ok(relevantTerms('Set GPIOA clock; write one to clear the flag.').some(([term]) => term === 'write one to clear'));
  assert.equal(relevantTerms('a clockwork design').some(([term]) => term === 'clock'), false);
});
test('registers, bit names, addresses, expressions and code survive translation exactly', () => {
  const sample = 'Set GPIOA and TIMx_CR1 at 0x40020000 using (1 << 3). Call HAL_GPIO_WritePin(GPIOA, GPIO_PIN_3).';
  const protection = protectIdentifiers(sample);
  assert.equal(protection.restore(protection.text), sample);
  assert.throws(() => protection.restore('dịch đã mất mã'), /định danh/);
  assert.throws(() => protection.restore(protection.text + '__RM_KEEP_0__'), /định danh/);
});
test('known terms work without an API key or network', async () => {
  const result = await translateEmbedded({ text: 'interrupt', settings: { provider: 'gemini' }, fetchImpl: () => { throw Error('Must not contact network'); } });
  assert.equal(result.text, 'ngắt'); assert.match(result.source, /ngoại tuyến/);
});
test('bullet lists, paragraphs and indentation retain their line breaks', () => {
  const original = 'Features\n• Enable GPIOA\n  continuation\n\n• Clear the flag';
  const protectedLines = protectLineBreaks(original);
  assert.equal(protectedLines.restore(protectedLines.text), original);
  assert.throws(() => protectedLines.restore('All lines flattened'), /xuống dòng/);
  assert.throws(() => protectedLines.restore(protectedLines.text.replace('__RM_LINE_0__', '__RM_LINE_9__')), /xuống dòng/);
  assert.equal(normalizeSelection('Title\r\n•  Item one\r\n  Item two'), 'Title\n• Item one\n  Item two');
});
test('Gemini restores line layout together with register identifiers', async () => {
  const result = await translateEmbedded({ text: 'Features\n• Enable GPIOA\n• Clear the flag', settings: { provider: 'gemini', model: 'test' }, apiKey: 'fake-key', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); assert.match(body.contents[0].parts[0].text, /__RM_LINE_0__/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Các tính năng __RM_LINE_0__ • Kích hoạt __RM_KEEP_0__ __RM_LINE_1__ • Xóa cờ' }] } }] }));
  } });
  assert.equal(result.text, 'Các tính năng\n• Kích hoạt GPIOA\n• Xóa cờ');
});
test('missing credentials produce an actionable error and never send the selection', async () => {
  await assert.rejects(() => translateEmbedded({ text: 'The peripheral is enabled.', settings: { provider: 'gemini' }, fetchImpl: () => { throw Error('Must not contact network'); } }), /API key/);
});
test('Gemini sends only selected text and technical instructions, restores identifiers', async () => {
  let sent;
  const result = await translateEmbedded({ text: 'Set GPIOA at 0x40020000.', settings: { provider: 'gemini', model: 'test-model' }, apiKey: 'test-key', fetchImpl: async (url, options) => {
    sent = { url, ...options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Thiết lập __RM_KEEP_0__ tại __RM_KEEP_1__.' }] } }] }), { status: 200 });
  } });
  assert.equal(result.text, 'Thiết lập GPIOA tại 0x40020000.');
  assert.match(sent.body.systemInstruction.parts[0].text, /lập trình nhúng/);
  assert.equal(sent.body.contents.length, 1); assert.equal(sent.headers['x-goog-api-key'], 'test-key');
  assert.ok(!sent.url.includes('test-key'));
});
test('Ollama protocol and provider failures are handled', async () => {
  const result = await translateEmbedded({ text: 'The interrupt is enabled.', settings: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'test' }, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(options.body); assert.equal(body.stream, false); assert.equal(body.messages[0].role, 'system');
    return new Response(JSON.stringify({ message: { content: 'Ngắt được cho phép.' } }), { status: 200 });
  } });
  assert.equal(result.text, 'Ngắt được cho phép.');
  await assert.rejects(() => translateEmbedded({ text: 'The interrupt is enabled.', settings: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'test' }, fetchImpl: async () => new Response('', { status: 429 }) }), /hạn mức/);
});
test('settings validate local endpoints and model names', () => {
  assert.equal(validateSettings({ provider: 'gemini' }).model, 'gemini-3.8-flash');
  assert.throws(() => validateSettings({ provider: 'ollama', endpoint: 'https://example.com' }), /máy này/);
  assert.throws(() => validateSettings({ model: '../model' }), /model/);
  assert.equal(validateSettings({ translationFont: 999 }).translationFont, 24);
});

const geminiTest = { text: 'The interrupt is enabled.', settings: { provider: 'gemini', model: 'gemini-3.8-flash' }, apiKey: 'test-key', waitImpl: async () => {} };
const success = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ngắt được cho phép.' }] } }] }), { status: 200 });
const providerFailure = (status, message = '') => new Response(JSON.stringify({ error: { message } }), { status });
test('503 is retried and progress is reported before success', async () => {
  let calls = 0; const progress = [];
  const result = await translateEmbedded({ ...geminiTest, onProgress: message => progress.push(message), fetchImpl: async () => ++calls === 1 ? providerFailure(503) : success() });
  assert.equal(calls, 2); assert.equal(result.text, 'Ngắt được cho phép.'); assert.match(progress[0], /503/);
});
test('retries are bounded and auto fallback can be disabled', async () => {
  let calls = 0;
  await assert.rejects(() => translateEmbedded({ ...geminiTest, settings: { ...geminiTest.settings, autoFallback: false }, fetchImpl: async () => { calls++; return providerFailure(503); } }), /quá tải.*503/);
  assert.equal(calls, 3);
});
test('after persistent 503, fallback uses only an available text model and labels it', async () => {
  const urls = [];
  const result = await translateEmbedded({ ...geminiTest, fetchImpl: async url => {
    urls.push(url);
    if (url.includes('?pageSize=')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }));
    if (url.includes('gemini-3.5-flash-lite:')) return success();
    return providerFailure(503);
  } });
  assert.equal(urls.length, 5); assert.match(result.source, /gemini-3.5-flash-lite.*dự phòng/);
  assert.equal(result.text, 'Ngắt được cho phép.');
});
test('invalid or leaked key is actionable and not retried or switched', async () => {
  let calls = 0;
  await assert.rejects(() => translateEmbedded({ ...geminiTest, fetchImpl: async () => { calls++; return providerFailure(403, 'Your API key was reported as leaked.'); } }), /key bị lộ/);
  assert.equal(calls, 1);
  await assert.rejects(() => translateEmbedded({ ...geminiTest, fetchImpl: async () => providerFailure(400, 'API key not valid. Please pass a valid API key.') }), /key Gemini không hợp lệ/);
});
test('exhausted zero quota is not retried', async () => {
  let calls = 0;
  await assert.rejects(() => translateEmbedded({ ...geminiTest, settings: { ...geminiTest.settings, autoFallback: false }, fetchImpl: async () => { calls++; return providerFailure(429, 'Quota exceeded for metric generate_content_requests, limit: 0'); } }), /hạn mức/);
  assert.equal(calls, 1);
});
test('changing selection aborts retry immediately with no further request', async () => {
  let calls = 0; const controller = new AbortController();
  await assert.rejects(() => translateEmbedded({ ...geminiTest, signal: controller.signal, waitImpl: async () => controller.abort(), fetchImpl: async () => { calls++; return providerFailure(503); } }), /hủy/);
  assert.equal(calls, 1);
  const second = new AbortController(); const waiting = abortableWait(10000, second.signal); second.abort();
  await assert.rejects(waiting, /hủy/);
});
test('temporary connection errors can recover', async () => {
  let calls = 0;
  const result = await translateEmbedded({ ...geminiTest, fetchImpl: async () => { if (++calls === 1) throw new Error('connection reset'); return success(); } });
  assert.equal(calls, 2); assert.equal(result.text, 'Ngắt được cho phép.');
});
test('quota for one model can switch to available fallback without retrying exhausted model', async () => {
  let primaryCalls = 0;
  const result = await translateEmbedded({ ...geminiTest, fetchImpl: async url => {
    if (url.includes('?pageSize=')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }));
    if (url.includes('gemini-3.5-flash-lite:')) return success();
    primaryCalls++; return providerFailure(429, 'Quota exceeded, limit: 0');
  } });
  assert.equal(primaryCalls, 1); assert.match(result.source, /dự phòng/);
});
test('minute rate limits remain retryable and can recover', async () => {
  let calls = 0;
  const result = await translateEmbedded({ ...geminiTest, fetchImpl: async () => ++calls === 1 ? providerFailure(429, 'Quota exceeded: GenerateRequestsPerMinutePerModel. Please retry.') : success() });
  assert.equal(calls, 2); assert.equal(result.text, 'Ngắt được cho phép.');
});
test('a stalled primary request times out then falls back instead of waiting indefinitely', async () => {
  const result = await translateEmbedded({ ...geminiTest, requestTimeoutMs: 5, fetchImpl: async (url, options) => {
    if (url.includes('?pageSize=')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }));
    if (url.includes('gemini-3.5-flash-lite:')) return success();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(options.signal.aborted, true); throw new Error('timeout');
  } });
  assert.match(result.source, /dự phòng/);
});
