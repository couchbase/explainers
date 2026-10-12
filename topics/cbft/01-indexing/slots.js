// Assigns stable slots to keys, so items don't shift as others come and go.
// A key that arrives as others leave (a merge's result replacing its
// inputs) takes a slot of its own when there's one, not one of theirs,
// so a step can show it appear while they go.
export class Slots {
  constructor(n) { this.n = n; this.byKey = new Map(); this.free = [...Array(n).keys()]; }
  sync(keys) {
    const want = new Set(keys);
    const justFreed = new Set();
    for (const [k, i] of this.byKey) if (!want.has(k)) { this.byKey.delete(k); this.free.push(i); justFreed.add(i); }
    this.free.sort((a, b) => a - b);
    let overflow = 0;
    for (const k of keys) {
      if (this.byKey.has(k)) continue;
      if (this.free.length === 0) { overflow++; continue; }
      const j = this.free.findIndex((i) => !justFreed.has(i));
      this.byKey.set(k, this.free.splice(j >= 0 ? j : 0, 1)[0]);
    }
    return overflow;
  }
  get(k) { return this.byKey.get(k); }
}

// Slots for items that are always packed left, in the given order: a
// key's slot is its position in the list (so items shift as others go).
export class PackedSlots {
  constructor(n) { this.n = n; this.byKey = new Map(); this.keys = []; }
  sync(keys) {
    this.keys = keys.slice(0, this.n);
    this.byKey = new Map(this.keys.map((k, i) => [k, i]));
    return Math.max(0, keys.length - this.n);
  }
  get(k) { return this.byKey.get(k); }
}
