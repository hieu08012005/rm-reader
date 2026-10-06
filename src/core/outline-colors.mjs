export const DEFAULT_OUTLINE_COLORS = Object.freeze({
  1: '#176f5b', 2: '#235a9f', 3: '#7845a1',
  4: '#a34e16', 5: '#157078', 6: '#a53654'
});
export const OUTLINE_FALLBACK_COLOR = '#53636e';
const validLevel = key => /^[1-9]\d{0,2}$/.test(key) || key === '1000';
const validColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function normalizeOutlineColors(input) {
  const colors = { ...DEFAULT_OUTLINE_COLORS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [level, color] of Object.entries(input)) {
      if (validLevel(level) && validColor(color)) colors[level] = color.toLowerCase();
    }
  }
  return colors;
}
export function validateOutlineColors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 1000 ||
      Object.entries(input).some(([level, color]) => !validLevel(level) || !validColor(color))) {
    throw new Error('Màu mục lục không hợp lệ. Hãy chọn màu hoặc nhập R, G, B từ 0 đến 255.');
  }
  return normalizeOutlineColors(input);
}
export function outlineLevelColor(colors, level) {
  return colors[level] || DEFAULT_OUTLINE_COLORS[level] || OUTLINE_FALLBACK_COLOR;
}
export function rgbToHex(channels) {
  if (channels.length !== 3 || channels.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('Mỗi giá trị RGB phải là số nguyên từ 0 đến 255.');
  }
  return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('');
}
export function hexToRgb(hex) {
  if (!validColor(hex)) throw new Error('Màu RGB không hợp lệ.');
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}
