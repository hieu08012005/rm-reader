export const DEFAULT_VOCAB_FOLDER = 'default';
const cleanName = name => typeof name === 'string' ? name.trim().normalize('NFC') : '';
export function migrateVocabulary(state) {
  state.vocabulary = Array.isArray(state.vocabulary) ? state.vocabulary : [];
  state.vocabularyFolders = Array.isArray(state.vocabularyFolders) ? state.vocabularyFolders.filter(folder => folder?.id && cleanName(folder.name)) : [];
  if (!state.vocabularyFolders.some(folder => folder.id === DEFAULT_VOCAB_FOLDER)) state.vocabularyFolders.unshift({ id: DEFAULT_VOCAB_FOLDER, name: 'Chưa phân loại', isDefault: true });
  const ids = new Set(state.vocabularyFolders.map(folder => folder.id));
  for (const entry of state.vocabulary) if (!ids.has(entry.folderId)) entry.folderId = DEFAULT_VOCAB_FOLDER;
  state.vocabularyStudy ||= {};
}
export function validateFolderName(name, folders, currentId) {
  const value = cleanName(name);
  if (!value || value.length > 80 || /[\x00-\x1f]/.test(value)) throw new Error('Tên thư mục phải có từ 1 đến 80 ký tự, không chứa ký tự xuống dòng.');
  if (folders.some(folder => folder.id !== currentId && cleanName(folder.name).toLocaleLowerCase('vi') === value.toLocaleLowerCase('vi'))) throw new Error('Tên thư mục đã tồn tại.');
  return value;
}
export function requireVocabFolder(state, id) {
  const folder = state.vocabularyFolders.find(folder => folder.id === id);
  if (!folder) throw new Error('Hãy chọn một thư mục vocab hợp lệ.');
  return folder;
}
export function normalizeStudyAnswer(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}
export function studyEntries(entries) { return entries.filter(entry => entry.text?.trim() && entry.translation?.trim()); }
export function uniqueMatchingEntries(entries) {
  const words = new Set(), meanings = new Set();
  return studyEntries(entries).filter(entry => {
    const word = normalizeStudyAnswer(entry.text), meaning = normalizeStudyAnswer(entry.translation);
    if (words.has(word) || meanings.has(meaning)) return false;
    words.add(word); meanings.add(meaning); return true;
  });
}
export function shuffled(items, random = Math.random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [output[index], output[target]] = [output[target], output[index]]; }
  return output;
}
