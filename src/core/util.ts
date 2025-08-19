import { TILE_SIZE } from "./constants";
const a = 2 * Math.PI * 6378137 / 2;
const b = (a / TILE_SIZE) / 2 ** 10;

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

export function uniqueName(base: string, existing: string[]) {
  const names = new Set(existing.map(n => (n || '').toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 1;
  while (names.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}

export function pixelToLonLat(x: number, y: number) : [ number, number ] {
  const lon = (x * b - a) / a * 180;
  let lat = (a - y * b) / a * 180;
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [ lon, lat ];
}

export function lonLatToPixel(lon: number, lat: number) {
  lat = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  const x = (lon / 180 * a + a) / b;
  const y = (a - lat / 180 * a) / b;
  return [ Math.floor(x), Math.floor(y) ];
}
