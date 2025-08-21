export class LRUCache<K=any, V=any> {
  private max: number;
  private map: Map<K, V>;
  constructor(max = 400) { this.max = max; this.map = new Map(); }
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    this.map.delete(key); this.map.set(key, val);
    return val;
  }
  set(key: K, val: V) {
    if (this.map.has(key)) this.map.delete(key);
    if (val == null)
      return;
    this.map.set(key, val);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
  }
  has(key: K) { return this.map.has(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

export const imageDecodeCache = new LRUCache<string, HTMLImageElement>(64);
export const imagePixelCountCache = new LRUCache<string, number>(64);
export const paletteDetectionCache = new LRUCache<string, boolean>(200);
export const tooLargeOverlays = new Set<string>();

export function clearOverlayCache() {
  imageDecodeCache.clear();
  imagePixelCountCache.clear();
  paletteDetectionCache.clear();
  tooLargeOverlays.clear();
}
