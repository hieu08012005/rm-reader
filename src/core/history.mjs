// Scroll/zoom are live state; only deliberate jumps create history entries.
export class NavigationHistory {
  backStack = [];
  forwardStack = [];
  limit = 150;
  record(position) {
    if (!position) return;
    this.backStack.push(structuredClone(position));
    if (this.backStack.length > this.limit) this.backStack.shift();
    this.forwardStack = [];
  }
  back(current) {
    if (!this.backStack.length) return null;
    this.forwardStack.push(structuredClone(current));
    return this.backStack.pop();
  }
  forward(current) {
    if (!this.forwardStack.length) return null;
    this.backStack.push(structuredClone(current));
    return this.forwardStack.pop();
  }
  clear() { this.backStack = []; this.forwardStack = []; }
  get canBack() { return this.backStack.length > 0; }
  get canForward() { return this.forwardStack.length > 0; }
}
