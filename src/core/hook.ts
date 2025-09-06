/// <reference types="tampermonkey" />
import { updateOverlays } from './overlay';
import { updateUI } from '../ui/panel';
import type { Map } from 'maplibre-gl';
import { findExport, findModule, hook, moduleFilters } from './modules';
import { clearOverlayCache } from './cache';
import { createCanvas } from './canvas';
//import { lonLatToPixel } from './util';
//import { TILE_SIZE } from './constants';

let hookInstalled = false;

const page: any = unsafeWindow;

type Menu = { name: 'mainMenu' } |
  { name: 'selectHq' } |
  { name: 'paintingPixel' } |
  { name: 'paintingPixel', clickedLatLon: [ number, number ] } |
  { name: 'pixelSelected', latLon: [ number, number ] };
function isMenu(x: any): x is Menu {
  const possibleNames = [ 'mainMenu', 'pixelSelected', 'paintingPixel', 'selectHq' ];
  return x && x.name && possibleNames.includes(x.name);
}

export let map: Map | null = null;
export let user: any = null;
export let menu: Menu = { name: 'mainMenu' };
export let gm: any = null;

export function attachHook() {
  if (hookInstalled)
    return;

  hook(page, 'URL', (orig, unhook) => class extends orig() {
    constructor(...url: any[]) {
      if (url.length >= 1 && url[0].includes && url[0].includes('pawtect_wasm_bg')) {
        // if youre a wplace dev and you find this please help me make my overlay not trigger pawtect :rivplead:
        // it's triggered by data URIs but all im fetching is png images
        url[0] = 'https://i.hate.bots.too.and.i.love.paws.but.not.when.they.break.my.harmless.overlay.colon-less-than';
        unhook();
      }
      super(...url);
    }
  });

  hook(page, 'Promise', (orig, unhook) => class extends orig() {
    constructor(executor: any) {
      super(executor);
      if (!executor.toString().includes('maps.wplace.live'))
        return;
      this.then(async (x: Map) => {
        map = x;
        page._map = x;
        await onMap();
      });
      unhook();
    }
  });

  hook(page, 'Proxy', orig => class {
    constructor(target: any, handler: any) {
      const proxy = new (orig())(target, handler);
      if (!isMenu(target))
        return proxy;
      menu = proxy;
      page._menu = proxy;
      updateUI();
      return proxy;
    }
  });

  // unused rn but maybe ill switch to this later
  hook(page, 'Map', (orig, unhook) => class extends orig() {
    constructor(...args: any[]) {
      super(...args);
    }
    set(key: any, value: any) {
      if (value && value.gm && !gm) {
        gm = value.gm;
        page._gm = value.gm;
        unhook();
      }
      return super.set(key, value);
    }
  });

  hook(page, 'Map', orig => class extends orig() {
    constructor(...args: any[]) {
      super(...args);
    }
    set(key: any, value: any) {
      if (!value || !value.input)
        return super.set(key, value);

      if (value.input.id.startsWith && value.input.id.startsWith('paint-preview'))
        paintPreviewTiles = this;

      if (value.input.id !== 'paint-crosshair')
        return super.set(key, value);

      const normal: HTMLImageElement = value.input.img;

      const red = createCanvas(normal.width, normal.height);
      const ctx = red.getContext('2d', { willReadFrequently: true })! as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      ctx.drawImage(normal, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ff8080';
      ctx.fillRect(0, 0, red.width, red.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(normal, 0, 0);
      red['naturalWidth'] = red.width;
      red['naturalHeight'] = red.height;

      hook(value, 'place', orig => (latLon: [ number, number ], custom: { painted: [ number, number, number, number ], current: [ number, number, number, number ] }) => {
        try {
          const { tile, pixel }: {
            tile: [ number, number ],
            pixel: [ number, number ]
          } = value.gm.latLonToTileAndPixel(...latLon, value.input.zoom);
          const canvasPos = value.getCanvasPos(value.gm.latLonToPixelsFloor(...latLon, value.input.zoom));
          if (!paintingAnnotations.has(tile[0] * 100000 + tile[1]))
            paintingAnnotations.set(tile[0] * 100000 + tile[1], []);
          paintingAnnotations.get(tile[0] * 100000 + tile[1]).push({ crosshair: value, latLon, pixel, canvasPos });

          let useImg: typeof normal | typeof red = normal;

          const painted = custom && custom.painted || (() => {
            const previewCanvas: HTMLCanvasElement = paintPreviewTiles.get(`${tile[0]},${tile[1]}`).canvas;
            if (!previewCanvas)
              return [];
            return pickColorsOnCanvas(previewCanvas, [ { x: pixel[0], y: previewCanvas.height - pixel[1] - 1 } ])[0];
          })();
          const current = custom && custom.current || pickColorsOnMapLayer('pixel-art-layer', { x: tile[0], y: tile[1] }, [ { x: pixel[0], y: pixel[1] } ])[0];

          if (painted && painted.length == 4 && current && current.length == 4 && current.every((x, i) => x == painted[i])) {
            useImg = red;
          }

          if (value.input.img != useImg) {
            value.input.img = useImg;
            for (const [ _, canvas ] of value.canvases) {
              canvas.input.img = useImg;
            }
          }
        }
        catch (e) {
          console.error(e);
        }
        return orig().call(value, latLon);
      });

      return super.set(key, value);
    }
  });

  findModule(moduleFilters['backend']).then(x => {
    user = findExport(x, prop => prop && Object.getOwnPropertyNames(Object.getPrototypeOf(prop)).includes('cooldown'));
    if (!user) {
      console.warn('user property not found in backend module');
      return;
    }
    page._user = user;

    const userProto = Object.getPrototypeOf(user);

    const cooldownOrig = Object.getOwnPropertyDescriptor(userProto, 'cooldown');
    Object.defineProperty(userProto, 'cooldownOrig', cooldownOrig);
    Object.defineProperty(userProto, 'cooldown', {
      get: function() {
        return Math.ceil(cooldownOrig.get.call(this) / 1000.0) * 1000.0;
      },
      configurable: true
    });

    new BroadcastChannel('user-channel').onmessage = () => {
      updateUI();
    };
  });

  hookInstalled = true;
}

let paintPreviewTiles: any;
const paintingAnnotations = new window.Map<number, any[]>();
async function onMap() {
  //const refreshTilesOrig = map.refreshTiles;
  //map.refreshTiles = (sourceId, tileIds) => {
  //  if (sourceId !== 'pixel-art-layer')
  //    return refreshTilesOrig.call(map, sourceId, tileIds);
  //  //const cache = map.style.sourceCaches['pixel-art-layer'];
  //  //if (!cache)
  //  //  return refreshTilesOrig.call(map, sourceId, tileIds);
  //  //const center = map.getBounds().getCenter();
  //  //let [ x, y ] = lonLatToPixel(center.lng, center.lat);
  //  //x = Math.floor(x / TILE_SIZE);
  //  //y = Math.floor(y / TILE_SIZE);
  //  //const paused = cache._paused;
  //  //cache._paused = false;
  //  const zoom = map.getZoom();
  //  map.setZoom(Math.max(zoom, 11));
  //  refreshTilesOrig.call(map, sourceId, tileIds);
  //  map.setZoom(zoom);
  //  //if (paused)
  //  //  cache.pause();
  //};

  //const addSourceOrig = map.addSource;
  //map.addSource = (id, source) => {
  //  if (id === 'pixel-art-layer' && source.type === 'raster')
  //    source.tileSize = 64;
  //  const ret = addSourceOrig.call(map, id, source);
  //  if (id === 'pixel-art-layer') {
  //    const updateOrig = map.style.sourceCaches['pixel-art-layer'].update;
  //    map.style.sourceCaches['pixel-art-layer'].update = (transform, terrain) => {
  //      const t = transform.clone();
  //      t.setZoom(Math.max(t.zoom, 11));
  //      return updateOrig.call(map.style.sourceCaches['pixel-art-layer'], t, terrain);
  //    };
  //  }
  //  return ret;
  //};

  //map.on('zoom', () => {
  //  if (!map.style.sourceCaches['pixel-art-layer'])
  //    return;
  //  if (map.getZoom() < 10.6) {
  //    map.style.sourceCaches['pixel-art-layer'].pause();
  //  }
  //  else {
  //    map.style.sourceCaches['pixel-art-layer'].resume();
  //  }
  //});

  // update crosshair if tile updates while painting
  map.on('sourcedata', (e: any) => {
    if (!e.coord || !e.tile || !e.sourceId)
      return;
    if (e.sourceId !== 'pixel-art-layer')
      return;
    for (const [ key, annotations ] of paintingAnnotations) {
      const tile = { x: Math.floor(key / 100000), y: key % 100000 };
      if (e.coord.canonical.x != tile.x || e.coord.canonical.y != tile.y)
        continue;

      const previewCanvas: HTMLCanvasElement = paintPreviewTiles.get(`${tile.x},${tile.y}`)?.canvas;
      const painted = previewCanvas ? pickColorsOnCanvas(previewCanvas, annotations.map(x => ({ x: x.pixel[0], y: previewCanvas.height - x.pixel[1] - 1 }))) : [];
      const current = pickColorsOnMapLayer('pixel-art-layer', tile, annotations.map(x => ({ x: x.pixel[0], y: x.pixel[1] })));

      const length = annotations.length;
      for (let i = 0; i < length; i++) {
        const { crosshair, latLon, canvasPos } = annotations.shift();
        const canvas = crosshair.canvases.get(canvasPos.key);
        if (!canvas || !canvas.annotations.has(canvas.getPixelKey(canvasPos.innerPos.x, canvasPos.innerPos.y)))
          continue;
        crosshair.remove(latLon);
        crosshair.place(latLon, { painted: painted.length && painted[i], current: current.length && current[i] });
      }
    }
  });

  clearOverlayCache();
  await updateOverlays();
  updateUI();
}

let fbo: WebGLFramebuffer | undefined;
function pickColorsOnMapTexture(texture: WebGLTexture, points: { x: number, y: number }[]): [ number, number, number, number ][] {
  if (points.length === 0)
    return [];
  const gl = map.painter.context.gl;
  if (!fbo) {
    fbo = gl.createFramebuffer();
  }
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status != gl.FRAMEBUFFER_COMPLETE) {
    console.error('framebuffer incomplete', status);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    return [];
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX)
      minX = point.x;
    if (point.x > maxX)
      maxX = point.x;
    if (point.y < minY)
      minY = point.y;
    if (point.y > maxY)
      maxY = point.y;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const data = new Uint8Array(w * h * 4);
  gl.readPixels(minX, minY, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  let res = [];
  for (const point of points) {
    const index = ((point.y - minY) * w + (point.x - minX)) * 4;
    res.push([ data[index + 0], data[index + 1], data[index + 2], data[index + 3] ]);
  }
  return res;
};

function pickColorsOnMapLayer(id: string, tile: { x: number, y: number }, points: { x: number, y: number }[]): [ number, number, number, number ][] {
  if (!map || !map.style || !map.style.sourceCaches)
    return [];
  const cache = map.style.sourceCaches[id];
  if (!cache)
    return [];
  const cacheKey = cache.getVisibleCoordinates().find(x => x.canonical.x == tile.x && x.canonical.y == tile.y)?.key;
  if (!cacheKey)
    return [];
  const tileTile = cache.getTileByID(cacheKey);
  if (!tileTile || !tileTile.texture || !tileTile.texture.texture)
    return [];
  return pickColorsOnMapTexture(tileTile.texture.texture, points);
}

function pickColorsOnCanvas(canvas: OffscreenCanvas | HTMLCanvasElement, points: { x: number, y: number }[]): [ number, number, number, number ][] {
  if (points.length === 0)
    return [];
  if (!canvas)
    return [];
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX)
      minX = point.x;
    if (point.x > maxX)
      maxX = point.x;
    if (point.y < minY)
      minY = point.y;
    if (point.y > maxY)
      maxY = point.y;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  if (!ctx)
    return [];
  const data = ctx.getImageData(minX, minY, w, h).data;
  let res = [];
  for (const point of points) {
    const index = ((point.y - minY) * w + (point.x - minX)) * 4;
    res.push([ data[index + 0], data[index + 1], data[index + 2], data[index + 3] ]);
  }
  return res;
}
