/// <reference types="tampermonkey" />
import { updateOverlays } from './overlay';
import { updateUI } from '../ui/panel';
import type { Map, Subscription } from 'maplibre-gl';
import { findExport, findModule, hook, moduleFilters } from './modules';
import { clearOverlayCache } from './cache';
import { createCanvas } from './canvas';

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

  let paintPreviewTiles: any;
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

      hook(value, 'place', orig => (latLon: [ number, number ]) => {
        try {
          const { tile, pixel }: {
            tile: [ number, number ],
            pixel: [ number, number ]
          } = value.gm.latLonToTileAndPixel(...latLon, value.input.zoom);
          const canvasPos = value.getCanvasPos(value.gm.latLonToPixelsFloor(...latLon, value.input.zoom));

          // update crosshair if tile updates while painting
          let subscription: Subscription;
          subscription = map.on('sourcedata', (x: any) => {
            if (!x.coord || !x.tile)
              return;
            if (x.sourceId !== 'pixel-art-layer')
              return;
            if (x.coord.canonical.x != tile[0] || x.coord.canonical.y != tile[1])
              return;
            if (subscription) {
              subscription.unsubscribe();
            }
            const canvas = value.canvases.get(canvasPos.key);
            if (!canvas || !canvas.annotations.has(canvas.getPixelKey(canvasPos.innerPos.x, canvasPos.innerPos.y))) {
              subscription.unsubscribe();
              return;
            }
            value.remove(latLon);
            value.place(latLon);
          });

          let useImg: typeof normal | typeof red = normal;

          const previewCanvas: HTMLCanvasElement = paintPreviewTiles.get(`${tile[0]},${tile[1]}`).canvas;
          const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true })!;
          const painted = previewCtx.getImageData(pixel[0], previewCanvas.height - pixel[1] - 1, 1, 1).data;

          const cache = map.style.sourceCaches['pixel-art-layer'];
          const key = cache.getVisibleCoordinates().find(x => x.canonical.x == tile[0] && x.canonical.y == tile[1])?.key;
          if (painted && key) {
            const tile = cache.getTileByID(key);
            const current = pickColorOnMapTexture(tile.texture.texture, ...pixel);
            if (current && current.every((x, i) => x == painted[i])) {
              useImg = red;
            }
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

async function onMap() {
  clearOverlayCache();
  await updateOverlays();
  updateUI();
}

let fbo: WebGLFramebuffer | undefined;
function pickColorOnMapTexture(texture: WebGLTexture, x: number, y: number) {
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
    return null;
  }
  const data = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  return data;
};
