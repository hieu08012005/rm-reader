// Read the user's encrypted key in memory. Never print or persist plaintext.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.disableHardwareAcceleration();
app.setName('rm-reader');
app.setPath('userData', path.join(app.getPath('appData'), 'rm-reader'));
app.whenReady().then(async () => {
  let apiKey = '';
  const redact = value => String(value).replaceAll(apiKey || 'NO_SECRET', '[redacted]').replace(/AIza[\w-]{20,}/g, '[redacted]');
  try {
    const prefsPath = path.join(app.getPath('appData'), 'rm-reader', 'preferences.json');
    const state = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
    console.log(JSON.stringify({ model: state.settings?.model, hasKey: Boolean(state.encryptedKey) }));
    if (!state.encryptedKey) throw new Error('Chưa có API key được lưu trong app.');
    apiKey = safeStorage.decryptString(Buffer.from(state.encryptedKey, 'base64'));
    const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers, signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    if (!response.ok) { console.log(JSON.stringify({ listStatus: response.status, code: body.error?.status, message: redact(body.error?.message) })); return; }
    const models = body.models?.filter(model => model.supportedGenerationMethods?.includes('generateContent') && /flash/i.test(model.name) && !/image|tts|live/i.test(model.name)).map(model => model.name.replace(/^models\//, '')) || [];
    console.log(JSON.stringify({ listStatus: response.status, models }));
    const { translateEmbedded } = await import(pathToFileURL(path.resolve(__dirname, '../src/core/translation.mjs')).href);
    const requested = process.argv.find(arg => arg.startsWith('--model='))?.slice(8) || state.settings?.model;
    if (process.argv.includes('--probe-errors')) {
      const probe = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requested)}:generateContent`, { method: 'POST', headers, body: JSON.stringify({ contents: [{ parts: [{ text: 'Translate "interrupt flag" into Vietnamese for embedded programming.' }] }] }), signal: AbortSignal.timeout(30000) });
      const data = await probe.json();
      console.log(JSON.stringify({ probeStatus: probe.status, code: data.error?.status, message: redact(data.error?.message || ''), quota: data.error?.details?.flatMap(detail => (detail.violations || []).map(violation => ({ quotaMetric: violation.quotaMetric, quotaId: violation.quotaId, quotaValue: violation.quotaValue, model: violation.quotaDimensions?.model }))), retryDelay: data.error?.details?.find(detail => detail.retryDelay)?.retryDelay }));
      return;
    }
    for (const text of ['S32K1xx Series Reference Manual, Rev. 14, 09/2021', 'Write one to clear the GPIOA interrupt flag at 0x40020000.']) {
      try {
        const result = await translateEmbedded({ text, settings: { ...state.settings, provider: 'gemini', model: requested }, apiKey, signal: AbortSignal.timeout(45000) });
        console.log(JSON.stringify({ model: requested, input: text, translated: result.text, source: result.source }));
      } catch (error) { console.log(JSON.stringify({ model: requested, error: redact(error.message) })); }
    }
  } catch (error) { console.log(JSON.stringify({ diagnosticError: redact(error.message) })); process.exitCode = 1; }
  finally { apiKey = ''; app.quit(); }
});
