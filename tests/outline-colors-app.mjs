import { _electron as electron, expect } from 'playwright/test';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = 'E:/App_RM/updates/1.7.0';
const packaged = process.argv.includes('--packaged');
const mode = packaged ? 'packaged' : 'source';
const profile = `${output}/outline-profile-${mode}-${Date.now()}`;
const filename = `${output}/outline-eight-levels.pdf`, other = `${output}/outline-other.pdf`;
const pdf = await PDFDocument.create(), pages = [pdf.addPage(), pdf.addPage(), pdf.addPage()];
pages.forEach((page, index) => page.drawText(`Outline colors test - page ${index + 1}`, { x: 60, y: 700 }));
const ctx = pdf.context, root = ctx.obj({ Type: 'Outlines', Count: 8 }), rootRef = ctx.register(root);
const nodes = Array.from({ length: 8 }, (_, index) => ctx.obj({ Title: PDFHexString.fromText(index === 7 ? 'Deep target' : `Level ${index + 1} chapter`), Dest: [pages[index === 7 ? 2 : 0].ref, PDFName.of('XYZ'), 0, 700, null] }));
const refs = nodes.map(node => ctx.register(node));
nodes.forEach((node, index) => {
  node.set(PDFName.of('Parent'), index === 0 ? rootRef : refs[index - 1]);
  if (index < 7) { node.set(PDFName.of('First'), refs[index + 1]); node.set(PDFName.of('Last'), refs[index + 1]); node.set(PDFName.of('Count'), ctx.obj(7 - index)); }
});
root.set(PDFName.of('First'), refs[0]); root.set(PDFName.of('Last'), refs[0]); pdf.catalog.set(PDFName.of('Outlines'), rootRef);
await fs.mkdir(output, { recursive: true }); const bytes = await pdf.save(); await fs.writeFile(filename, bytes); await fs.writeFile(other, bytes);
const env = { ...process.env, RM_TEST_MODE: '1', RM_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = []; let app, page;
function mark(name) { checks.push(name); console.log('PASS ' + name); }
async function start() {
  app = await electron.launch({ args: packaged ? [] : [project], ...(packaged ? { executablePath: 'E:/App_RM/release/win-unpacked/RM Reader.exe' } : {}), cwd: project, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.rmTest);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1280, 1000); win.showInactive(); });
}
async function open(file) {
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await page.click('#open-pdf'); await expect(page.locator('#page-count')).toHaveText('3'); await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.outline-row').first()).toBeVisible();
}
const color = level => page.locator(`.outline-row[data-level="${level}"] .outline-item`).evaluate(node => getComputedStyle(node).color);
const expectColor = (level, value) => expect(page.locator(`.outline-row[data-level="${level}"] .outline-item`)).toHaveCSS('color', value);
async function rgb(level, values) { for (const [index, channel] of ['R', 'G', 'B'].entries()) await page.getByLabel(`${channel} cấp ${level}`, { exact: true }).fill(String(values[index])); }
try {
  await start(); await open(filename);
  await expectColor(1, 'rgb(23, 111, 91)'); await expectColor(2, 'rgb(35, 90, 159)');
  mark('Old profile boots with distinct colors for nested PDF bookmarks');
  await page.fill('#outline-filter', 'Deep target'); await expect(page.locator('.outline-row')).toHaveCount(8);
  assert.deepEqual(await page.locator('.outline-row').evaluateAll(rows => rows.map(row => Number(row.dataset.level))), [1,2,3,4,5,6,7,8]);
  mark('Search keeps all eight original depth levels when opening matching ancestors');
  await page.click('#outline-colors-button'); await expect(page.locator('.outline-color-level')).toHaveCount(8);
  await rgb(2, [1, 128, 254]);
  await expectColor(2, 'rgb(1, 128, 254)');
  await page.click('#outline-colors-cancel'); await expectColor(2, 'rgb(35, 90, 159)');
  mark('RGB is previewed immediately and Cancel restores saved colors');
  await page.click('#outline-colors-button'); await rgb(2, [1, 128, 254]); await page.keyboard.press('Escape');
  await expectColor(2, 'rgb(35, 90, 159)'); mark('Escape also discards preview changes');
  const before = await page.evaluate(async () => { const state = await window.desktop.getState(); await window.desktop.saveSettings({ ...state.settings, apiKey: 'outline-test-key' }); return window.desktop.getState(); });
  const beforeFile = JSON.parse(await fs.readFile(`${profile}/preferences.json`, 'utf8'));
  await page.click('#outline-colors-button'); await rgb(1, [0, 132, 233]); await rgb(2, [255, 0, 19]);
  await rgb(8, [0, 255, 128]);
  await page.getByLabel('R cấp 3', { exact: true }).fill('300'); await page.click('#outline-colors-save');
  await expect(page.locator('#outline-colors-dialog')).toBeVisible(); assert.equal((await page.evaluate(() => window.desktop.getState())).outlineColors[1], '#176f5b');
  await page.getByLabel('R cấp 3', { exact: true }).fill('12.5'); await page.click('#outline-colors-save');
  await expect(page.locator('#outline-colors-dialog')).toBeVisible();
  await rgb(3, [12, 34, 56]);
  const picker = page.getByLabel('Chọn màu cấp 4', { exact: true });
  await picker.fill('#010203'); await picker.dispatchEvent('input'); await expect(page.getByLabel('B cấp 4', { exact: true })).toHaveValue('3');
  mark('Native picker synchronizes RGB; out-of-range and fractional channels cannot be saved');
  await page.click('#outline-colors-add'); await expect(page.locator('.outline-color-level')).toHaveCount(9);
  await page.click('#outline-colors-save'); await expect(page.locator('#outline-colors-dialog')).toBeHidden();
  const after = await page.evaluate(() => window.desktop.getState()); assert.equal(after.outlineColors[8], '#00ff80'); assert.equal(after.outlineColors[9], '#53636e');
  assert.deepEqual(after.settings, before.settings);
  assert.equal(JSON.parse(await fs.readFile(`${profile}/preferences.json`, 'utf8')).encryptedKey, beforeFile.encryptedKey);
  mark('Deep-level colors and added levels save without altering AI settings or encrypted keys');
  await page.getByRole('button', { name: 'Deep target', exact: true }).click(); await expect(page.locator('#page-number')).toHaveValue('3');
  await expectColor(8, 'rgb(0, 255, 128)'); await expect(page.locator('.outline-row.active[data-level="8"]')).toBeVisible();
  await page.hover('.outline-row[data-level="8"]'); await expectColor(8, 'rgb(0, 255, 128)');
  await page.click('#back'); await expect(page.locator('#page-number')).toHaveValue('1');
  mark('Custom colors survive active and hover states; bookmark navigation and Back still work');
  await page.fill('#outline-filter', ''); await open(other); await expectColor(1, 'rgb(0, 132, 233)');
  mark('The same level colors apply when switching PDF documents');
  await app.close(); app = null; await start(); await open(filename);
  await expectColor(1, 'rgb(0, 132, 233)'); await page.fill('#outline-filter', 'Deep target'); await expectColor(8, 'rgb(0, 255, 128)');
  await page.click('#outline-colors-button'); await expect(page.locator('.outline-color-level')).toHaveCount(9); await expect(page.getByLabel('G cấp 8', { exact: true })).toHaveValue('255');
  mark('RGB and added levels persist across application restart');
  await page.screenshot({ path: `${output}/outline-colors-${mode}.png` });
  await page.click('#outline-colors-reset'); await expectColor(1, 'rgb(23, 111, 91)'); await page.click('#outline-colors-save');
  await expect(page.locator('#outline-colors-dialog')).toBeHidden(); assert.equal((await page.evaluate(() => window.desktop.getState())).outlineColors[8], '#53636e');
  mark('Default colors can be restored and saved for all levels');
  await assert.rejects(() => page.evaluate(() => window.desktop.saveOutlineColors({ 1: 'url(bad)' })));
  assert.deepEqual(errors, []); mark('IPC rejects unsafe colors and renderer has no errors');
  await fs.writeFile(`${output}/outline-checks-${mode}.json`, JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { if (app) await app.close(); }
