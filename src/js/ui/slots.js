// Assigns stable slots to keys, so items don't shift as others come and go.
export class Slots {
  constructor(n) { this.n = n; this.byKey = new Map(); this.free = [...Array(n).keys()]; }
  sync(keys) {
    const want = new Set(keys);
    for (const [k, i] of this.byKey) if (!want.has(k)) { this.byKey.delete(k); this.free.push(i); }
    this.free.sort((a, b) => a - b);
    let overflow = 0;
    for (const k of keys) {
      if (this.byKey.has(k)) continue;
      if (this.free.length === 0) { overflow++; continue; }
      this.byKey.set(k, this.free.shift());
    }
    return overflow;
  }
  get(k) { return this.byKey.get(k); }
}
