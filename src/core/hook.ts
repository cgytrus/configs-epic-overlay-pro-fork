/// <reference types="tampermonkey" />
import { updateOverlays } from './overlay';
import { updateUI } from '../ui/panel';
import type { Map } from 'maplibre-gl';
import { findExport, findModule, moduleFilters } from './modules';
import { clearOverlayCache } from './cache';

let hookInstalled = false;

const page: any = unsafeWindow;

export let map: Map | null = null;
export let user: any = null;
export let menu: any = { name: 'mainMenu' };

export function attachHook() {
  if (!map) {
    page.PromiseOrig = page.Promise;
    page.Promise = class extends page.PromiseOrig {
      constructor(executor: any) {
        super(executor);
        if (!executor.toString().includes('maps.wplace.live'))
          return;
        this.then(async (x: Map) => {
          map = x;
          page._map = x;
          clearOverlayCache();
          await updateOverlays();
          updateUI();
        });
        page.Promise = page.PromiseOrig;
        page.PromiseOrig = undefined;
      }
    };
  }

  if (hookInstalled)
    return;

  const possibleMenuNames = [ 'mainMenu', 'pixelSelected', 'paintingPixel', 'selectHq' ];
  page.ProxyOrig = page.Proxy;
  page.Proxy = class {
    constructor(target: any, handler: any) {
      const proxy = new page.ProxyOrig(target, handler);
      if (!target || !target.name || !possibleMenuNames.includes(target.name))
        return proxy;
      menu = proxy;
      page._menu = proxy;
      updateUI();
      return proxy;
    }
  };

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
