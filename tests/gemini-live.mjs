// Explicitly invoked integration check against the user's configured Gemini account.
// It reads the already-encrypted key through the app; it never accesses plaintext.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, RM_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.RM_TEST_DATA;
let app;
try {
  const packaged = process.argv.includes('--packaged');
  app = await electron.launch({ args: packaged ? [] : [project], ...(packaged ? { executablePath: 'E:/App_RM/release/win-unpacked/RM Reader.exe' } : {}), cwd: project, env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.rmTest);
  const state = await page.evaluate(() => window.desktop.getState());
  assert.equal(state.settings.hasApiKey, true);
  assert.equal(state.settings.provider, 'gemini');
  for (const text of ['S32K1xx Series Reference Manual, Rev. 14, 09/2021', 'Write one to clear the GPIOA interrupt flag at 0x40020000.', 'Other FTFC module features\n• Internal high-voltage supply generator for flash memory program and erase operations\n• Optional interrupt generation upon flash command completion']) {
    await page.evaluate(text => window.rmTest.translate(text), text);
    const result = await page.locator('#translation-result').innerText();
    const source = await page.locator('#translation-status').innerText();
    const failed = await page.locator('#translation-result').evaluate(node => node.classList.contains('error'));
    assert.equal(failed, false, result);
    if (text.includes('\n')) { assert.equal(result.split('\n').length, 3); assert.equal(result.match(/•/g)?.length, 2); assert.ok(result.includes('FTFC')); assert.ok(!result.includes('__RM_LINE_')); }
    else if (text.includes('GPIOA')) { assert.ok(result.includes('GPIOA')); assert.ok(result.includes('0x40020000')); assert.match(result, /cờ ngắt/); }
    else { assert.ok(result.includes('S32K1xx')); assert.match(result, /tham chiếu/); }
    console.log(JSON.stringify({ input: text, translated: result, source }));
  }
  console.log('PASS Live Gemini translation through app IPC and renderer');
} catch (error) { console.error(String(error.message).replace(/AIza[\w-]{20,}/g, '[redacted]')); process.exitCode = 1; }
finally { await app?.close().catch(() => {}); }
