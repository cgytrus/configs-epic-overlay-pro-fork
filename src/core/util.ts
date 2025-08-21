import { TILE_SIZE } from "./constants";
import { menu } from "./hook";
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

export function selectPixel(x: number, y: number, zoom: number) {
  const lonLat = pixelToLonLat(x + 0.5, y + 0.5);
  unsafeWindow.localStorage.setItem('location', JSON.stringify({
    lng: lonLat[0],
    lat: lonLat[1],
    zoom
  }));
  menu.name = 'pixelSelected';
  // i dont know how to silence the stupid ts error
  if (menu.name === 'pixelSelected')
    menu.latLon = [ lonLat[1], lonLat[0] ];
}
