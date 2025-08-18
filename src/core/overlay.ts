import { createCanvas, loadImage, canvasToDataURLSafe } from './canvas';
import { MINIFY_SCALE, TILE_SIZE, MAX_OVERLAY_DIM } from './constants';
import { imageDecodeCache, tooLargeOverlays, clearOverlayCache } from './cache';
import { showToast } from './toast';
import { config, saveConfig, type OverlayItem } from './store';
import { WPLACE_FREE, WPLACE_PAID } from './palette';
import { getUpdateUI, map } from './hook';
import { ImageSource, type Coordinates } from 'maplibre-gl';

const ALL_COLORS = [...WPLACE_FREE, ...WPLACE_PAID];
const colorIndexMap = new Map<string, number>();
ALL_COLORS.forEach((c, i) => colorIndexMap.set(c.join(','), i));

export function extractPixelCoords(pixelUrl: string) {
  try {
    const u = new URL(pixelUrl);
    const parts = u.pathname.split('/');
    const sp = new URLSearchParams(u.search);
    return {
      chunk1: parseInt(parts[3], 10),
      chunk2: parseInt(parts[4], 10),
      posX: parseInt(sp.get('x') || '0', 10),
      posY: parseInt(sp.get('y') || '0', 10)
    };
  } catch {
    return { chunk1: 0, chunk2: 0, posX: 0, posY: 0 };
  }
}

export function matchPixelUrl(urlStr: string) {
  try {
    const u = new URL(urlStr, location.href);
    if (u.hostname !== 'backend.wplace.live') return null;
    const m = u.pathname.match(/\/s0\/pixel\/(\d+)\/(\d+)$/);
    if (!m) return null;
    const sp = u.searchParams;
    return { normalized: `https://backend.wplace.live/s0/pixel/${m[1]}/${m[2]}?x=${sp.get('x')||0}&y=${sp.get('y')||0}` };
  } catch { return null; }
}

export function matchMeUrl(urlStr: string) {
  try {
    const u = new URL(urlStr, location.href);
    if (u.hostname !== 'backend.wplace.live') return null;
    if (u.pathname !== '/me') return null;
    return true;
  } catch { return null; }
}

export async function decodeOverlayImage(imageBase64: string | null) {
  if (!imageBase64) return null;
  const key = imageBase64;
  const cached = imageDecodeCache.get(key);
  if (cached) return cached;
  const img = await loadImage(imageBase64);
  imageDecodeCache.set(key, img);
  return img;
}

function tileAndPixelToLonLat(tx: number, ty: number, px: number, py: number) : [ number, number ] {
  const x = tx * TILE_SIZE + px;
  const y = ty * TILE_SIZE + py;
  const a = 2 * Math.PI * 6378137 / 2;
  const b = (a / TILE_SIZE) / 2 ** 10;
  const lon = (x * b - a) / a * 180;
  let lat = (a - y * b) / a * 180;
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [ lon, lat ];
}

export async function buildOverlayDataForChunkUnified(
  ov: OverlayItem,
  style: 'full' | 'dots'
) {
  if (!ov?.enabled || !ov.imageBase64 || !ov.pixelUrl) return null;
  if (tooLargeOverlays.has(ov.id)) return null;

  const img = await decodeOverlayImage(ov.imageBase64);
  if (!img) return null;

  const wImg = img.width, hImg = img.height;
  if (wImg >= MAX_OVERLAY_DIM || hImg >= MAX_OVERLAY_DIM) {
    tooLargeOverlays.add(ov.id);
    showToast(`Overlay "${ov.name}" skipped: image too large (must be smaller than ${MAX_OVERLAY_DIM}×${MAX_OVERLAY_DIM}; got ${wImg}×${hImg}).`);
    return null;
  }

  const base = extractPixelCoords(ov.pixelUrl);
  if (!Number.isFinite(base.chunk1) || !Number.isFinite(base.chunk2)) return null;

  const coordinates: Coordinates = [
    tileAndPixelToLonLat(base.chunk1, base.chunk2, base.posX + ov.offsetX, base.posY + ov.offsetY),
    tileAndPixelToLonLat(base.chunk1, base.chunk2, base.posX + ov.offsetX + wImg, base.posY + ov.offsetY),
    tileAndPixelToLonLat(base.chunk1, base.chunk2, base.posX + ov.offsetX + wImg, base.posY + ov.offsetY + hImg),
    tileAndPixelToLonLat(base.chunk1, base.chunk2, base.posX + ov.offsetX, base.posY + ov.offsetY + hImg),
  ];

  switch (style) {
    case 'full': {
      const canvas = createCanvas(wImg, hImg) as any;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img as any, 0, 0);
      return { url: await canvasToDataURLSafe(canvas), coordinates };
    }
    case 'dots': {
      const scale = MINIFY_SCALE;
      const wScaled = wImg * scale;
      const hScaled = hImg * scale;

      const canvas = createCanvas(wScaled, hScaled) as any;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;

      const center = Math.floor((scale - 1) / 2);
      for (let y = 0; y < hImg; y++) {
        for (let x = 0; x < wImg; x++) {
          ctx.drawImage(img as any, x, y, 1, 1, x * scale + center, y * scale + center, 1, 1);
        }
      }

      return { url: await canvasToDataURLSafe(canvas), coordinates };
    }
  }
}

const displayingOverlays = [];
export async function updateOverlays() {
  const currentOverlays = config.overlayStyle == 'none' ? [] : config.overlays.filter(o => o.enabled && o.imageBase64 && o.pixelUrl);
  for (const ov of displayingOverlays) {
    if (currentOverlays.includes(ov))
      continue;
    const name = `op-${ov.name}`;
    if (map.getLayer(name))
      map.removeLayer(name);
    if (map.getSource(name))
      map.removeSource(name);
  }
  displayingOverlays.length = 0;

  for (const ov of currentOverlays) {
    const name = `op-${ov.name}`;

    const existingSource = map.getSource<ImageSource>(name);
    const existingLayer = map.getLayer(name);

    try {
      if (existingLayer) {
        map.setPaintProperty(name, 'raster-opacity', config.overlayStyle == 'full' ? ov.opacity : 1.0);
        map.moveLayer(name, ({
          'behind': 'pixel-art-layer',
          'above': 'pixel-hover',
          'top': undefined
        })[config.overlayLayering]);
      }

      const image = await buildOverlayDataForChunkUnified(ov, config.overlayStyle as 'full' | 'dots');

      if (existingSource) {
        existingSource.updateImage(image);
      }
      else {
        map.addSource(name, {
          type: 'image',
          url: image.url,
          coordinates: image.coordinates
        });
      }

      if (!existingLayer) {
        map.addLayer({
          id: name,
          type: 'raster',
          source: name,
          paint: {
            'raster-resampling': 'nearest',
            'raster-opacity': config.overlayStyle == 'full' ? ov.opacity : 1.0
          }
        }, ({
          'behind': 'pixel-art-layer',
          'above': 'pixel-hover',
          'top': undefined
        })[config.overlayLayering]);
      }

      displayingOverlays.push(ov);
    }
    catch (e) {
      if (map.getLayer(name))
        map.removeLayer(name);
      if (map.getSource(name))
        map.removeSource(name);
      console.error(e);
    }
  }
}

export async function displayImageFromData(newOverlay: OverlayItem) {
  if (!config.overlays) {
    config.overlays = [];
  }
  config.overlays.push(newOverlay);
  await saveConfig();

  clearOverlayCache();
  await updateOverlays();

  const updateUI = getUpdateUI();
  if (updateUI) {
    updateUI();
  }
}