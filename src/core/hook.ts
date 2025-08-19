/// <reference types="tampermonkey" />
import { config, saveConfig } from './store';
import { matchPixelUrl, extractPixelCoords, updateOverlays } from './overlay';
import { emit, EV_ANCHOR_SET, EV_AUTOCAP_CHANGED } from './events';
import { updateUI } from '../ui/panel';
import { type Map } from 'maplibre-gl';
import { findExport, findModule, moduleFilters } from './modules';

let hookInstalled = false;
let updateUICallback: null | (() => void) = null;
const page: any = unsafeWindow;

export function setUpdateUI(cb: () => void) {
  updateUICallback = cb;
}

export function getUpdateUI() {
  return updateUICallback;
}

export let map: Map | null = null;
export let user: any = null;

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
          await updateOverlays();
        });
        page.Promise = page.PromiseOrig;
        page.PromiseOrig = undefined;
      }
    };
  }

  if (hookInstalled)
    return;

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

  const hookedFetch = (originalFetch: any) => async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : ((input as Request).url) || '';

    // Anchor auto-capture: watch pixel endpoint, then store/normalize
    if (config.autoCapturePixelUrl && config.activeOverlayId) {
      const pixelMatch = matchPixelUrl(urlStr);
      if (pixelMatch) {
        const ov = config.overlays.find(o => o.id === config.activeOverlayId);
        if (ov) {
          const changed = (ov.pixelUrl !== pixelMatch.normalized);
          if (changed) {
            ov.pixelUrl = pixelMatch.normalized;
            ov.offsetX = 0; ov.offsetY = 0;
            await saveConfig(['overlays']);

            // turn off autocapture and notify UI (via events)
            config.autoCapturePixelUrl = false;
            await saveConfig(['autoCapturePixelUrl']);

            // keep legacy callback for any existing wiring
            updateUICallback?.();

            const c = extractPixelCoords(ov.pixelUrl);
            emit(EV_ANCHOR_SET, { overlayId: ov.id, name: ov.name, chunk1: c.chunk1, chunk2: c.chunk2, posX: c.posX, posY: c.posY });
            emit(EV_AUTOCAP_CHANGED, { enabled: false });
            await updateOverlays();
          }
        }
      }
    }

    return originalFetch(input as any, init as any);
  };

  page.fetch = hookedFetch(page.fetch);
  window.fetch = hookedFetch(window.fetch) as any;

  hookInstalled = true;
}
