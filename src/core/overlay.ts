import { createCanvas, loadImage, canvasToDataURLSafe } from './canvas';
import { MINIFY_SCALE, MAX_OVERLAY_DIM } from './constants';
import { imageDecodeCache, tooLargeOverlays } from './cache';
import { showToast } from './toast';
import { config, type OverlayItem } from './store';
import { WPLACE_FREE, WPLACE_PAID } from './palette';
import { map } from './hook';
import type { ImageSource, Coordinates } from 'maplibre-gl';
import { pixelToLonLat } from './util';

const ALL_COLORS = [...WPLACE_FREE, ...WPLACE_PAID];
const colorIndexMap = new Map<string, number>();
ALL_COLORS.forEach((c, i) => colorIndexMap.set(c.join(','), i));

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

export async function decodeOverlayImage(imageBase64: string | null) {
  if (!imageBase64) return null;
  const key = imageBase64;
  const cached = imageDecodeCache.get(key);
  if (cached) return cached;
  const img = await loadImage(imageBase64);
  imageDecodeCache.set(key, img);
  return img;
}

export async function buildOverlayDataForChunkUnified(
  ov: OverlayItem,
  style: 'full' | 'dots'
) {
  if (!ov?.enabled || !ov.image) return null;
  if (tooLargeOverlays.has(ov.id)) return null;

  const img = await decodeOverlayImage(ov.image);
  if (!img) return null;

  const wImg = img.width, hImg = img.height;
  if (wImg >= MAX_OVERLAY_DIM || hImg >= MAX_OVERLAY_DIM) {
    tooLargeOverlays.add(ov.id);
    showToast(`Overlay "${ov.name}" skipped: image too large (must be smaller than ${MAX_OVERLAY_DIM}×${MAX_OVERLAY_DIM}; got ${wImg}×${hImg}).`);
    return null;
  }

  const coordinates: Coordinates = [
    pixelToLonLat(ov.x, ov.y),
    pixelToLonLat(ov.x + wImg, ov.y),
    pixelToLonLat(ov.x + wImg, ov.y + hImg),
    pixelToLonLat(ov.x, ov.y + hImg),
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
  const currentOverlays = config.overlayStyle == 'none' ? [] : config.overlays.filter(o => o.enabled && o.image);
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
        map.setPaintProperty(name, 'raster-opacity', config.overlayStyle == 'full' ? config.overlayOpacity : 1.0);
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
            'raster-opacity': config.overlayStyle == 'full' ? config.overlayOpacity : 1.0
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
