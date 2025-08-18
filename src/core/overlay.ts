import { createCanvas, canvasToBlob, blobToImage, loadImage } from './canvas';
import { MINIFY_SCALE, MINIFY_SCALE_SYMBOL, TILE_SIZE, MAX_OVERLAY_DIM } from './constants';
import { imageDecodeCache, overlayCache, tooLargeOverlays, paletteDetectionCache, clearOverlayCache } from './cache';
import { showToast } from './toast';
import { config, saveConfig, type OverlayItem } from './store';
import { WPLACE_FREE, WPLACE_PAID, SYMBOL_TILES, SYMBOL_W, SYMBOL_H } from './palette';
import { getUpdateUI } from './hook';

const ALL_COLORS = [...WPLACE_FREE, ...WPLACE_PAID];
const colorIndexMap = new Map<string, number>();
ALL_COLORS.forEach((c, i) => colorIndexMap.set(c.join(','), i));

const LUT_SIZE = 32; // 32x32x32 = 32KB
const LUT_SHIFT = 8 - Math.log2(LUT_SIZE); // 3 for 32x32x32
const colorLUT = new Uint8Array(LUT_SIZE * LUT_SIZE * LUT_SIZE);
let colorLutBuilt = false;

function buildColorLUT() {
  if (colorLutBuilt)
    return;
  for (let r = 0; r < LUT_SIZE; r++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      for (let b = 0; b < LUT_SIZE; b++) {
        const realR = (r << LUT_SHIFT) | ((1 << LUT_SHIFT) - 1);
        const realG = (g << LUT_SHIFT) | ((1 << LUT_SHIFT) - 1);
        const realB = (b << LUT_SHIFT) | ((1 << LUT_SHIFT) - 1);
        const index = findClosestColorIndex(realR, realG, realB);
        colorLUT[r * LUT_SIZE * LUT_SIZE + g * LUT_SIZE + b] = index;
      }
    }
  }
  colorLutBuilt = true;
}

function findColorIndexLUT(r: number, g: number, b: number): number {
  buildColorLUT();
  const lutR = r >> LUT_SHIFT;
  const lutG = g >> LUT_SHIFT;
  const lutB = b >> LUT_SHIFT;
  return colorLUT[lutR * LUT_SIZE * LUT_SIZE + lutG * LUT_SIZE + lutB];
}

function findClosestColorIndex(r: number, g: number, b: number) {
  let minDistance = Infinity;
  let index = 0;
  for (let i = 0; i < ALL_COLORS.length; i++) {
    const color = ALL_COLORS[i];
    const distance = Math.sqrt(
      Math.pow(r - color[0], 2) +
      Math.pow(g - color[1], 2) +
      Math.pow(b - color[2], 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      index = i;
    }
  }
  return index;
}

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

export function matchTileUrl(urlStr: string) {
  try {
    const u = new URL(urlStr, location.href);
    if (u.hostname !== 'backend.wplace.live' || !u.pathname.startsWith('/files/')) return null;
    const m = u.pathname.match(/\/(\d+)\/(\d+)\.png$/i);
    if (!m) return null;
    return { chunk1: parseInt(m[1], 10), chunk2: parseInt(m[2], 10) };
  } catch { return null; }
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

export function rectIntersect(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  const x = Math.max(ax, bx), y = Math.max(ay, by);
  const r = Math.min(ax + aw, bx + bw), b = Math.min(ay + ah, by + bh);
  const w = Math.max(0, r - x), h = Math.max(0, b - y);
  return { x, y, w, h };
}

function isPalettePerfectImage(img: HTMLImageElement): boolean {
  const key = img.src;
  const cached = paletteDetectionCache.get(key);
  if (cached !== undefined) return cached;

  const canvas = createCanvas(img.width, img.height) as any;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    
    if (a === 0) continue;
    
    // Skip #deface transparency
    if (r === 0xde && g === 0xfa && b === 0xce) continue;
    
    const colorKey = `${r},${g},${b}`;
    if (!colorIndexMap.has(colorKey)) {
      paletteDetectionCache.set(key, false);
      return false;
    }
  }
  
  paletteDetectionCache.set(key, true);
  return true;
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

export function overlaySignature(ov: OverlayItem, isPalettePerfect?: boolean) {
  const perfectFlag = isPalettePerfect !== undefined ? (isPalettePerfect ? 'P' : 'I') : 'U';
  return [ov.imageId, ov.pixelUrl || 'null', ov.offsetX, ov.offsetY, ov.opacity, perfectFlag].join('|');
}

export async function buildOverlayDataForChunkUnified(
  ov: OverlayItem,
  targetChunk1: number,
  targetChunk2: number,
  mode: 'behind' | 'above' | 'minify'
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

  const drawX = (base.chunk1 * TILE_SIZE + base.posX + ov.offsetX) - (targetChunk1 * TILE_SIZE);
  const drawY = (base.chunk2 * TILE_SIZE + base.posY + ov.offsetY) - (targetChunk2 * TILE_SIZE);

  // Check if image is palette-perfect for optimization
  const isPalettePerfect = isPalettePerfectImage(img);
  const sig = overlaySignature(ov, isPalettePerfect);
  const cacheKey = `ov:${ov.id}|sig:${sig}|tile:${targetChunk1},${targetChunk2}|mode:${mode}`;
  const cached = undefined;//overlayCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const colorStrength = (mode === 'minify') ? 1.0 : ov.opacity;
  const whiteStrength = 1 - colorStrength;

  if (mode !== 'minify') {
    const isect = rectIntersect(0, 0, TILE_SIZE, TILE_SIZE, drawX, drawY, wImg, hImg);
    if (isect.w === 0 || isect.h === 0) { overlayCache.set(cacheKey, null); return null; }

    const canvas = createCanvas(TILE_SIZE, TILE_SIZE) as any;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img as any, drawX, drawY);

    const imageData = ctx.getImageData(isect.x, isect.y, isect.w, isect.h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      // Special case for #deface color
      if (r === 0xde && g === 0xfa && b === 0xce) {
        continue;
      }
      if (a > 0) {
        data[i]     = Math.round(r * colorStrength + 255 * whiteStrength);
        data[i + 1] = Math.round(g * colorStrength + 255 * whiteStrength);
        data[i + 2] = Math.round(b * colorStrength + 255 * whiteStrength);
        data[i + 3] = 255;
      }
    }

    const result = { imageData, dx: isect.x, dy: isect.y, scaled: false };
    overlayCache.set(cacheKey, result);
    return result;
  } else {
    if (config.minifyStyle === 'symbols') {
      const scale = MINIFY_SCALE_SYMBOL;
      const tileW = TILE_SIZE * scale;
      const tileH = TILE_SIZE * scale;
      const drawXScaled = Math.round(drawX * scale);
      const drawYScaled = Math.round(drawY * scale);
      const wScaled = wImg * scale;
      const hScaled = hImg * scale;

      const isect = rectIntersect(0, 0, tileW, tileH, drawXScaled, drawYScaled, wScaled, hScaled);
      if (isect.w === 0 || isect.h === 0) { overlayCache.set(cacheKey, null); return null; }

      const canvas = createCanvas(wImg, hImg) as any;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img as any, 0, 0);
      const originalImageData = ctx.getImageData(0, 0, wImg, hImg);

      const outCanvas = createCanvas(tileW, tileH) as any;
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true })!;
      const outputImageData = outCtx.createImageData(tileW, tileH);
      const outData = outputImageData.data;

      // Precompute symbol centering offsets for performance
      const centerX = (scale - SYMBOL_W) >> 1;
      const centerY = (scale - SYMBOL_H) >> 1;
      
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const imgX = x - drawX;
          const imgY = y - drawY;
          if (imgX >= 0 && imgX < wImg && imgY >= 0 && imgY < hImg) {
            const idx = (imgY * wImg + imgX) * 4;
            const r = originalImageData.data[idx];
            const g = originalImageData.data[idx+1];
            const b = originalImageData.data[idx+2];
            const a = originalImageData.data[idx+3];

            // Early exit for transparent or deface pixels
            if (a <= 128 || (r === 0xde && g === 0xfa && b === 0xce)) continue;

            let colorIndex: number;
            
            // Fast path for palette-perfect images
            if (isPalettePerfect) {
              const colorKey = `${r},${g},${b}`;
              colorIndex = colorIndexMap.get(colorKey) ?? 0;
            } else {
              // Use LUT for fast color matching
              colorIndex = findColorIndexLUT(r, g, b);
            }

            if (colorIndex < SYMBOL_TILES.length) {
              const symbol = SYMBOL_TILES[colorIndex];
              const tileX = x * scale;
              const tileY = y * scale;
              
              // Cache palette color to avoid repeated array access
              const paletteColor = ALL_COLORS[colorIndex];
              const a_r = paletteColor[0];
              const a_g = paletteColor[1];
              const a_b = paletteColor[2];

              for (let sy = 0; sy < SYMBOL_H; sy++) {
                for (let sx = 0; sx < SYMBOL_W; sx++) {
                  const bit_idx = sy * SYMBOL_W + sx;
                  const bit = (symbol >>> bit_idx) & 1;
                  if (bit) {
                    const outX = tileX + sx + centerX;
                    const outY = tileY + sy + centerY;
                    if (outX >= 0 && outX < tileW && outY >= 0 && outY < tileH) {
                      const outIdx = (outY * tileW + outX) * 4;
                      outData[outIdx] = a_r;
                      outData[outIdx+1] = a_g;
                      outData[outIdx+2] = a_b;
                      outData[outIdx+3] = 255;
                    }
                  }
                }
              }
            }
          }
        }
      }
      outCtx.putImageData(outputImageData, 0, 0);

      const finalIsect = rectIntersect(0, 0, tileW, tileH, 0, 0, tileW, tileH);
      const finalImageData = outCtx.getImageData(finalIsect.x, finalIsect.y, finalIsect.w, finalIsect.h);

      const result = { imageData: finalImageData, dx: finalIsect.x, dy: finalIsect.y, scaled: true, scale };
      overlayCache.set(cacheKey, result);
      return result;
    } else { // 'dots'
        const scale = MINIFY_SCALE;
        const tileW = TILE_SIZE * scale;
        const tileH = TILE_SIZE * scale;
        const drawXScaled = Math.round(drawX * scale);
        const drawYScaled = Math.round(drawY * scale);
        const wScaled = wImg * scale;
        const hScaled = hImg * scale;

        const isect = rectIntersect(0, 0, tileW, tileH, drawXScaled, drawYScaled, wScaled, hScaled);
        if (isect.w === 0 || isect.h === 0) { overlayCache.set(cacheKey, null); return null; }

        const canvas = createCanvas(tileW, tileH) as any;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, tileW, tileH);
        ctx.drawImage(img as any, 0, 0, wImg, hImg, drawXScaled, drawYScaled, wScaled, hScaled);

        const imageData = ctx.getImageData(isect.x, isect.y, isect.w, isect.h);
        const data = imageData.data;
        const center = Math.floor(scale / 2);
        const width = isect.w;

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a === 0) continue;

          const px = (i / 4) % width;
          const py = Math.floor((i / 4) / width);
          const absX = isect.x + px;
          const absY = isect.y + py;

          if ((absX % scale) === center && (absY % scale) === center) {
            data[i]     = Math.round(data[i]     * colorStrength + 255 * whiteStrength);
            data[i + 1] = Math.round(data[i + 1] * colorStrength + 255 * whiteStrength);
            data[i + 2] = Math.round(data[i + 2] * colorStrength + 255 * whiteStrength);
            data[i + 3] = 255;
          } else {
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
          }
        }
        const result = { imageData, dx: isect.x, dy: isect.y, scaled: true, scale };
        overlayCache.set(cacheKey, result);
        return result;
    }
  }
}

export async function composeTileUnified(
  originalBlob: Blob,
  overlayDatas: Array<{ imageData: ImageData, dx: number, dy: number, scaled?: boolean } | null>,
  mode: 'behind' | 'above' | 'minify'
) {
  if (!overlayDatas || overlayDatas.length === 0) return originalBlob;
  const originalImage = await blobToImage(originalBlob) as any;

  if (mode === 'minify') {
    const scale = config.minifyStyle === 'symbols' ? MINIFY_SCALE_SYMBOL : MINIFY_SCALE;
    const w = originalImage.width, h = originalImage.height;

    const baseCanvas = createCanvas(w * scale, h * scale) as any;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true })!;
    baseCtx.imageSmoothingEnabled = false;
    baseCtx.drawImage(originalImage, 0, 0, w * scale, h * scale);
    const scaledBaseImageData = baseCtx.getImageData(0, 0, w * scale, h * scale);

    const canvas = createCanvas(w * scale, h * scale) as any;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.putImageData(scaledBaseImageData, 0, 0);

    for (const ovd of overlayDatas) {
      if (!ovd) continue;
      const tw = ovd.imageData.width;
      const th = ovd.imageData.height;
      if (!tw || !th) continue;
      const temp = createCanvas(tw, th) as any;
      const tctx = temp.getContext('2d', { willReadFrequently: true })!;
      tctx.putImageData(ovd.imageData, 0, 0);
      ctx.drawImage(temp, ovd.dx, ovd.dy);
    }
    return await canvasToBlob(canvas);
  }

  const w = originalImage.width, h = originalImage.height;
  const canvas = createCanvas(w, h) as any;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (mode === 'behind') {
    for (const ovd of overlayDatas) {
      if (!ovd) continue;
      const temp = createCanvas(ovd.imageData.width, ovd.imageData.height) as any;
      const tctx = temp.getContext('2d', { willReadFrequently: true })!;
      tctx.putImageData(ovd.imageData, 0, 0);
      ctx.drawImage(temp, ovd.dx, ovd.dy);
    }
    ctx.drawImage(originalImage, 0, 0);
    return await canvasToBlob(canvas);
  } else {
    ctx.drawImage(originalImage, 0, 0);
    for (const ovd of overlayDatas) {
      if (!ovd) continue;
      const temp = createCanvas(ovd.imageData.width, ovd.imageData.height) as any;
      const tctx = temp.getContext('2d', { willReadFrequently: true })!;
      tctx.putImageData(ovd.imageData, 0, 0);
      ctx.drawImage(temp, ovd.dx, ovd.dy);
    }
    return await canvasToBlob(canvas);
  }
}

export async function displayImageFromData(newOverlay: OverlayItem) {
  if (!config.overlays) {
    config.overlays = [];
  }
  config.overlays.push(newOverlay);
  await saveConfig();
  
  clearOverlayCache();

  const updateUI = getUpdateUI();
  if (updateUI) {
    updateUI();
  }
}