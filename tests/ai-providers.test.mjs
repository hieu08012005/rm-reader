import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROVIDERS, providerConfig, credentialScope, listAIModels, makeAIRequest, streamAI } from '../src/core/ai-providers.mjs';
import { validateSettings, translateEmbedded } from '../src/core/translation.mjs';
import { streamChat } from '../src/core/chat.mjs';
const contents = [{ role: 'user', parts: [{ text: 'Clock [SRC:r1]' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] }, { role: 'model', parts: [{ text: 'Before' }] }, { role: 'user', parts: [{ text: 'Next' }] }];
const settingsFor = provider => ({ provider, model: 'vendor/model-v1:free', endpoint: provider === 'custom' ? 'https://example.com/v1' : AI_PROVIDERS[provider].endpoint, chatOutputTokens: 512 });
function bytesResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }));
}
const sse = chunks => chunks.map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
test('Provider presets ignore custom URLs; custom credentials are scoped to the complete base URL', () => {
  assert.equal(providerConfig({ provider: 'openai', endpoint: 'https://wrong.com' }).endpoint, AI_PROVIDERS.openai.endpoint);
  assert.notEqual(credentialScope({ provider: 'custom', endpoint: 'https://a.com/v1' }), credentialScope({ provider: 'custom', endpoint: 'https://a.com/other' }));
  assert.equal(providerConfig({ provider: 'custom', endpoint: 'https://a.com/v1/chat/completions/' }).endpoint, 'https://a.com/v1');
  for (const endpoint of ['http://remote.com/v1', 'https://name:secret@a.com/v1', 'https://a.com/v1?key=bad', 'https://a.com/v1#bad', 'file:///foo', '']) assert.throws(() => providerConfig({ provider: 'custom', endpoint }));
  assert.equal(providerConfig({ provider: 'custom', endpoint: 'http://localhost:1234/v1' }).endpoint, 'http://localhost:1234/v1');
});
test('Model names support namespaces and fine tuning; reject whitespace and traversal segments', () => {
  assert.equal(validateSettings(settingsFor('openrouter')).model, 'vendor/model-v1:free');
  assert.equal(validateSettings({ ...settingsFor('openai'), model: 'ft:vendor:model:custom-id' }).model, 'ft:vendor:model:custom-id');
  for (const model of ['../model', 'a/../b', 'bad\nname', 'bad name']) assert.throws(() => validateSettings({ ...settingsFor('openai'), model }));
});
for (const provider of ['openai', 'deepseek', 'openrouter', 'custom', 'anthropic', 'ollama']) {
  test(`${provider}: correct native request, images, roles, auth and output limits`, () => {
    const request = makeAIRequest({ settings: settingsFor(provider), apiKey: 'test-secret', system: 'technical rules', contents, stream: true });
    const body = JSON.parse(request.body); assert.equal(body.stream, true); assert.equal(request.redirect, 'error'); assert.equal(body.model, 'vendor/model-v1:free');
    if (provider === 'anthropic') {
      assert.equal(request.url, 'https://api.anthropic.com/v1/messages'); assert.equal(request.headers['x-api-key'], 'test-secret'); assert.equal(body.system, 'technical rules'); assert.equal(body.messages[0].content[1].source.media_type, 'image/png'); assert.equal(body.messages[1].role, 'assistant'); assert.equal(body.max_tokens, 512);
    } else if (provider === 'ollama') {
      assert.equal(request.url, 'http://127.0.0.1:11434/api/chat'); assert.equal(request.headers.Authorization, undefined); assert.equal(body.messages[1].images[0], 'aGVsbG8='); assert.equal(body.options.num_predict, 512);
    } else {
      assert.equal(request.headers.Authorization, 'Bearer test-secret'); assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,aGVsbG8='); assert.equal(body.messages[2].role, 'assistant'); assert.equal(body.messages[2].content, 'Before'); assert.equal(body.messages[3].content, 'Next'); assert.equal(body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'], 512);
    }
  });
  test(`${provider}: streamed Unicode, usage, completion; hidden reasoning excluded`, async () => {
    let wire;
    if (provider === 'anthropic') wire = sse([{ type: 'message_start', message: { usage: { input_tokens: 10 } } }, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'PRIVATE_THOUGHT' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Xung nhịp ' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'đúng.' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }, { type: 'message_stop' }]);
    else if (provider === 'ollama') wire = [{ message: { thinking: 'PRIVATE_THOUGHT', content: 'Xung nhịp ' }, done: false }, { message: { content: 'đúng.' }, done: true, eval_count: 4 }].map(c => JSON.stringify(c) + '\n').join('');
    else wire = sse([{ choices: [{ delta: { reasoning_content: 'PRIVATE_THOUGHT', content: 'Xung nhịp ' } }] }, { choices: [{ delta: { content: 'đúng.' }, finish_reason: 'stop' }] }, { choices: [], usage: { completion_tokens: 4 } }]) + 'data: [DONE]\r\n\r\n';
    const events = []; const result = await streamChat({ settings: settingsFor(provider), apiKey: 'test-secret', contents, onEvent: event => events.push(event), fetchImpl: async () => bytesResponse(wire) });
    assert.equal(result.text, 'Xung nhịp đúng.'); assert.equal(events.filter(e => e.delta).map(e => e.delta).join(''), result.text); assert.ok(result.usage); assert.equal(result.fallback, false);
  });
  test(`${provider}: model listing and manual arbitrary model remains allowed`, async () => {
    const models = await listAIModels({ settings: settingsFor(provider), apiKey: 'test-secret', fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error'); return Response.json(provider === 'ollama' ? { models: [{ name: 'vendor/model-v1:free' }] } : { data: [{ id: 'vendor/model-v1:free' }, { id: 'bad\nname' }] });
    } });
    assert.deepEqual(models, ['vendor/model-v1:free']);
  });
  test(`${provider}: translation restores original identifiers and line breaks`, async () => {
    const output = 'Thiết lập __RM_KEEP_0__ tại __RM_KEEP_1__. __RM_LINE_0__ Bật ngắt.';
    const result = await translateEmbedded({ text: 'Set GPIOA at 0x40020000.\nEnable interrupt.', settings: settingsFor(provider), apiKey: 'test-secret', fetchImpl: async () => Response.json(provider === 'anthropic' ? { content: [{ type: 'text', text: output }] } : provider === 'ollama' ? { message: { content: output } } : { choices: [{ message: { content: output } }] }) });
    assert.equal(result.text, 'Thiết lập GPIOA tại 0x40020000.\nBật ngắt.');
  });
}
test('Gemini model listing handles pagination and filters unsupported models', async () => {
  let calls = 0;
  const models = await listAIModels({ settings: { provider: 'gemini' }, apiKey: 'test-secret', fetchImpl: async url => {
    calls++; if (calls === 2) assert.match(url, /pageToken=next/);
    return Response.json(calls === 1 ? { nextPageToken: 'next', models: [{ name: 'models/one', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] } : { models: [{ name: 'models/two', supportedGenerationMethods: ['generateContent'] }] });
  } }); assert.deepEqual(models, ['one', 'two']);
});
test('Interrupted streams preserve emitted text and report incomplete answer', async () => {
  const emitted = [];
  await assert.rejects(() => streamAI({ settings: settingsFor('openai'), apiKey: 'test-secret', system: '', contents, onEvent: e => emitted.push(e), fetchImpl: async () => bytesResponse(sse([{ choices: [{ delta: { content: 'Partial' } }] }])) }), /ngắt/);
  assert.equal(emitted.at(-1).delta, 'Partial');
});
test('Cancellation reports stopped, and API errors never echo secrets', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => streamAI({ settings: settingsFor('openai'), apiKey: 'test-secret', system: '', contents, signal: controller.signal, fetchImpl: async () => { throw new Error('test-secret'); } }), /dừng/);
  await assert.rejects(() => streamAI({ settings: settingsFor('anthropic'), apiKey: 'test-secret', system: '', contents, fetchImpl: async () => Response.json({ error: { message: 'test-secret' } }, { status: 401 }) }), error => /key/.test(error.message) && !error.message.includes('test-secret'));
  assert.throws(() => makeAIRequest({ settings: settingsFor('openai'), apiKey: '', system: '', contents, stream: true }), /Chưa có/);
});
