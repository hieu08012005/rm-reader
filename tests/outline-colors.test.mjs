import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOutlineColors, validateOutlineColors, outlineLevelColor, rgbToHex, hexToRgb } from '../src/core/outline-colors.mjs';
test('Old profiles acquire distinct colors; invalid saved colors are ignored and deep overrides survive', () => {
  const colors = normalizeOutlineColors({ 2: '#12ABef', 8: '#010203', 0: '#aaaaaa', 3: 'url(unsafe)' });
  assert.equal(colors[2], '#12abef'); assert.equal(outlineLevelColor(colors, 8), '#010203');
  assert.equal(new Set(Object.values(normalizeOutlineColors())).size, 6);
  assert.equal(colors[0], undefined); assert.equal(colors[3], '#7845a1');
  assert.equal(outlineLevelColor(colors, 9), '#53636e');
});
test('RGB preserves all channel values, including black, white and non-preset custom colors', () => {
  for (const channels of [[0, 0, 0], [255, 255, 255], [1, 128, 254], [255, 0, 19]]) {
    assert.deepEqual(hexToRgb(rgbToHex(channels)), channels);
  }
  for (const channels of [[-1, 2, 3], [256, 0, 0], [1.5, 2, 3], [NaN, 0, 0], ['1', 2, 3], [1, 2]]) assert.throws(() => rgbToHex(channels));
});
test('IPC rejects CSS injection, malformed colors and invalid level keys', () => {
  for (const input of [null, [], { 0: '#010203' }, { '1.5': '#010203' }, { 1001: '#010203' }, { 1: '#abc' }, { 1: 'rgb(1,2,3)' }, { 1: '#123456;display:none' }]) assert.throws(() => validateOutlineColors(input));
  assert.equal(validateOutlineColors({ 10: '#FEDCBA' })[10], '#fedcba');
});
