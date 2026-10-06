import { DEFAULT_OUTLINE_COLORS, normalizeOutlineColors, outlineLevelColor, rgbToHex, hexToRgb } from './core/outline-colors.mjs';

export class OutlineColorEditor {
  constructor({ desktop, getDepth, onPreview, onSaved }) {
    this.desktop = desktop; this.getDepth = getDepth; this.onPreview = onPreview; this.onSaved = onSaved;
    this.colors = normalizeOutlineColors();
    this.dialog = document.getElementById('outline-colors-dialog');
    this.list = document.getElementById('outline-color-levels');
    this.error = document.getElementById('outline-colors-error');
    document.getElementById('outline-colors-button').onclick = () => this.open();
    for (const id of ['outline-colors-close', 'outline-colors-cancel']) document.getElementById(id).onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => this.onPreview(this.colors));
    document.getElementById('outline-colors-reset').onclick = () => {
      this.draft = normalizeOutlineColors(); this.render(); this.preview();
    };
    document.getElementById('outline-colors-add').onclick = () => {
      this.count++; this.render();
      this.list.lastElementChild.scrollIntoView({ block: 'nearest' });
      this.list.lastElementChild.querySelector('input[type=number]').focus();
    };
    document.getElementById('outline-colors-form').onsubmit = async event => {
      event.preventDefault(); this.error.textContent = '';
      const save = document.getElementById('outline-colors-save'); save.disabled = true;
      try {
        const colors = await this.desktop.saveOutlineColors(this.draft);
        this.update(colors); await this.onSaved(); this.dialog.close();
      } catch (error) {
        this.error.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      } finally { save.disabled = false; }
    };
  }
  update(colors) { this.colors = normalizeOutlineColors(colors); this.onPreview(this.colors); }
  open() {
    this.draft = { ...this.colors };
    this.count = Math.max(6, this.getDepth(), ...Object.keys(this.colors).map(Number));
    this.error.textContent = ''; this.render(); this.dialog.showModal();
  }
  preview() { this.onPreview(this.draft); }
  render() {
    this.list.replaceChildren(); this.error.textContent = '';
    document.getElementById('outline-colors-add').disabled = this.count >= 1000;
    for (let level = 1; level <= this.count; level++) {
      const row = document.createElement('div'); row.className = 'outline-color-level'; row.dataset.level = level;
      const title = document.createElement('strong'); title.textContent = `Cấp ${level}`;
      const picker = document.createElement('input'); picker.type = 'color'; picker.value = outlineLevelColor(this.draft, level);
      this.draft[level] = picker.value;
      picker.setAttribute('aria-label', `Chọn màu cấp ${level}`);
      const sample = document.createElement('span'); sample.className = 'outline-color-sample'; sample.textContent = 'Mục lục mẫu'; sample.style.color = picker.value;
      const inputs = hexToRgb(picker.value).map((value, index) => {
        const label = document.createElement('label'); label.textContent = ['R', 'G', 'B'][index];
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '255'; input.step = '1'; input.required = true;
        input.value = value; input.setAttribute('aria-label', `${['R', 'G', 'B'][index]} cấp ${level}`);
        input.oninput = () => {
          if (inputs.some(node => !node.checkValidity())) return;
          const color = rgbToHex(inputs.map(node => Number(node.value)));
          this.draft[level] = color; picker.value = color; sample.style.color = color; this.preview();
        };
        label.append(input); row.append(label); return input;
      });
      picker.oninput = () => {
        this.draft[level] = picker.value;
        hexToRgb(picker.value).forEach((value, index) => { inputs[index].value = value; });
        sample.style.color = picker.value; this.preview();
      };
      row.prepend(title, picker); row.append(sample); this.list.append(row);
    }
  }
}
