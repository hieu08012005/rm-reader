import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = 'E:/App_RM/updates/1.6.0';
const profile = path.join(output, `providers-profile-${Date.now()}`);
const packaged = process.argv.includes('--packaged');
const env = { ...process.env, RM_TEST_MODE: '1', RM_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: packaged ? [] : [project], ...(packaged ? { executablePath: 'E:/App_RM/release/win-unpacked/RM Reader.exe' } : {}), cwd: project, env, timeout: 60000 });
const checks = [], errors = []; let app, page;
const mark = name => { checks.push(name); console.log('PASS ' + name); };
async function start() {
  app = await launch(); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => !!window.rmTest);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1280, 1000); win.showInactive(); });
  await app.evaluate(() => {
    globalThis.providerCalls = [];
    globalThis.fetch = async (url, options = {}) => {
      const headers = options.headers || {}; const model = 'vendor/vision-v1:free';
      globalThis.providerCalls.push({ url: String(url), headers, body: options.body ? JSON.parse(options.body) : null });
      if (!options.body) return Response.json(String(url).includes('generativelanguage') ? { models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] } : String(url).endsWith('/api/tags') ? { models: [{ name: model }] } : { data: [{ id: model }] });
      const body = JSON.parse(options.body);
      const allText = body.contents ? body.contents.flatMap(c => c.parts.map(p => p.text || '')).join('\n') : body.messages.map(m => Array.isArray(m.content) ? m.content.map(p => p.text || '').join('\n') : m.content).join('\n');
      const id = allText.match(/"id":"([^"]+)"/)?.[1];
      const text = `Xung nhịp trong hình. ${id ? `[SRC:${id}]` : ''}`;
      const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
      let wire;
      if (String(url).includes('generativelanguage')) wire = event({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
      else if (String(url).endsWith('/messages')) wire = event({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 12, output_tokens: 3 } }) + event({ type: 'message_stop' });
      else if (String(url).endsWith('/api/chat')) wire = JSON.stringify({ message: { content: text }, done: true, prompt_eval_count: 12, eval_count: 3 }) + '\n';
      else wire = event({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }) + 'data: [DONE]\n\n';
      return new Response(wire, { headers: { 'Content-Type': String(url).endsWith('/api/chat') ? 'application/x-ndjson' : 'text/event-stream' } });
    };
  });
}
try {
  await start();
  await page.evaluate(async () => { const state = await window.desktop.getState(); await window.desktop.saveSettings({ ...state.settings, apiKey: 'legacy-gemini-test', autoFallback: false }); });
  await app.close(); app = null;
  const legacy = JSON.parse(await fs.readFile(path.join(profile, 'preferences.json'), 'utf8')); delete legacy.aiKeys; delete legacy.aiProfiles;
  await fs.writeFile(path.join(profile, 'preferences.json'), JSON.stringify(legacy));
  await start();
  assert.equal(await page.evaluate(async () => (await window.desktop.getState()).settings.hasApiKey), true);
  mark('Legacy Gemini encrypted key migrates without asking for the key again');
  await page.click('#settings-button'); assert.equal(await page.locator('#provider option').count(), 7);
  mark('Settings offers seven providers with model picker and manual entry');
  const providers = ['openai', 'anthropic', 'deepseek', 'openrouter', 'custom', 'ollama'];
  for (const provider of providers) {
    if (!(await page.locator('#settings-dialog').isVisible())) await page.click('#settings-button');
    await page.selectOption('#provider', provider);
    if (provider === 'custom') await page.fill('#endpoint', 'https://provider-test.example/v1');
    const key = provider === 'ollama' ? '' : `test-key-${provider}`;
    if (key) { await expect(page.locator('#key-status')).toContainText('Chưa lưu'); await page.fill('#api-key', key); }
    await page.click('#load-models'); await expect(page.locator('#model-list-status')).toContainText('Đã tải 1 model');
    assert.equal(await page.locator('#ai-models option').first().getAttribute('value'), 'vendor/vision-v1:free');
    await page.fill('#model', 'vendor/vision-v1:free'); await page.fill('#chat-model', '');
    await page.click('#settings-form button[type=submit]'); await expect(page.locator('#settings-dialog')).toBeHidden();
    const state = await page.evaluate(() => window.desktop.getState()); assert.equal(state.settings.provider, provider); assert.equal(state.settings.hasApiKey, Boolean(key)); assert.ok(!JSON.stringify(state).includes('test-key-')); assert.ok(!JSON.stringify(state).includes('encryptedKey'));
    await expect(page.locator('#chat-provider-label')).not.toContainText('GEMINI');
    const answer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 96, 96); context.fillStyle = 'black'; context.fillText('PLL -> /2', 10, 40);
      const image = await window.desktop.addChatImage({ name: 'clock.png', mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] });
      const c = await window.desktop.createChat({ tokens: [], imageIds: [image.id] });
      return window.desktop.sendChat({ conversationId: c.id, question: 'Giải thích clock tree', sources: [], imageIds: [image.id] });
    });
    assert.equal(answer.status, 'complete'); assert.match(answer.text, /Xung nhịp.*\[SRC:/); assert.ok(answer.sources[0].image); assert.equal(answer.usage.totalTokenCount, 15);
    const request = await app.evaluate(() => globalThis.providerCalls.at(-1));
    assert.equal(provider === 'anthropic' ? request.headers['x-api-key'] : request.headers.Authorization || '', provider === 'anthropic' ? key : key ? `Bearer ${key}` : '');
    assert.ok(JSON.stringify(request.body).includes(provider === 'ollama' ? '"images"' : provider === 'anthropic' ? '"media_type":"image/png"' : 'data:image/png;base64,'));
    mark(`${provider}: model listing, isolated key, encrypted save and native image chat with citations`);
  }
  await page.click('#settings-button'); await page.selectOption('#provider', 'openai'); await expect(page.locator('#key-status')).toContainText('Đã lưu'); assert.equal(await page.inputValue('#model'), 'vendor/vision-v1:free'); await page.click('#settings-cancel');
  mark('Switching back restores provider model and saved key status');
  const saved = JSON.parse(await fs.readFile(path.join(profile, 'preferences.json'), 'utf8')); assert.ok(saved.encryptedKey); assert.ok(!JSON.stringify(saved).includes('test-key-')); assert.ok(!JSON.stringify(saved).includes('legacy-gemini-test')); assert.equal(Object.keys(saved.aiKeys).filter(key => saved.aiKeys[key]).length, 5);
  mark('All provider keys are encrypted on disk; Gemini key remains intact');
  const mismatched = await page.evaluate(async () => {
    const state = await window.desktop.getState(); await window.desktop.saveSettings({ ...state.settings, provider: 'custom', model: 'test', endpoint: 'https://different.example/v1', chatModel: '' }); return window.desktop.getState();
  }); assert.equal(mismatched.settings.hasApiKey, false);
  await page.evaluate(() => window.desktop.listAIModels({ provider: 'custom', endpoint: 'https://different.example/v1' }));
  assert.equal(await app.evaluate(() => globalThis.providerCalls.at(-1).headers.Authorization || ''), '');
  mark('Changing custom Base URL never sends an existing provider/endpoint key');
  await page.evaluate(async () => { const state = await window.desktop.getState(); await window.desktop.saveSettings({ ...state.settings, provider: 'openai', model: 'vendor/vision-v1:free', chatModel: '' }); });
  await app.close(); app = null; await start();
  const restarted = await page.evaluate(() => window.desktop.getState()); assert.equal(restarted.settings.provider, 'openai'); assert.equal(restarted.settings.hasApiKey, true);
  assert.equal(restarted.settings.aiProfiles.anthropic.hasApiKey, true); assert.equal(restarted.settings.aiProfiles.gemini.hasApiKey, true);
  mark('Provider profiles and encrypted keys survive app restart');
  await page.click('#settings-button'); await page.selectOption('#provider', 'custom'); await page.fill('#endpoint', 'https://provider-test.example/v1');
  await expect(page.locator('#key-status')).toContainText('Đã lưu');
  mark('Custom key status recognizes an earlier saved endpoint after switching URLs');
  await page.screenshot({ path: path.join(output, `providers-settings-${packaged ? 'packaged' : 'source'}.png`) });
  await page.click('#settings-cancel');
  await page.evaluate(async () => { const state = await window.desktop.getState(); await window.desktop.saveSettings({ ...state.settings, clearKey: true }); });
  const cleared = await page.evaluate(() => window.desktop.getState()); assert.equal(cleared.settings.hasApiKey, false); assert.equal(cleared.settings.aiProfiles.anthropic.hasApiKey, true); assert.equal(cleared.settings.aiProfiles.gemini.hasApiKey, true);
  mark('Clearing one key preserves the keys of other providers');
  assert.deepEqual(errors, []); mark('No frontend errors across provider switches, chats and restart');
  await fs.writeFile(path.join(output, `providers-checks-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
  console.error(error); if (page) await page.screenshot({ path: path.join(output, 'providers-failure.png') }).catch(() => {}); process.exitCode = 1;
} finally { if (app) await app.close(); }
