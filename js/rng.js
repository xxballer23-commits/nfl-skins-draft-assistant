// Seeded RNG. Every random draw in this app goes through here so that a given
// seed always produces the same rankings. Without it the board jitters on every
// re-render mid-draft and you cannot tell a real change from Monte Carlo noise.
//
// Same injectable-source pattern the tracker's shuffle() uses.

/** Hash an arbitrary string into a 32-bit seed. */
export function seedFrom(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for Monte Carlo. Returns [0, 1). */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? seedFrom(seed) : seed) >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). */
export function randInt(random, n) {
  return Math.floor(random() * n);
}
