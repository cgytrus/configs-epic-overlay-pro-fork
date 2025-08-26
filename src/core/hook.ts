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
