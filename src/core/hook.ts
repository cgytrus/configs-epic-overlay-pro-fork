/// <reference types="tampermonkey" />
import { config, me, saveConfig } from './store';
import { matchPixelUrl, extractPixelCoords, matchMeUrl, updateOverlays } from './overlay';
import { emit, EV_ANCHOR_SET, EV_AUTOCAP_CHANGED } from './events';
import { updateUI } from '../ui/panel';
import { type Map } from 'maplibre-gl';

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

async function mapCreated(x: Map) {
  map = x;
  page.map = x;
  await updateOverlays();
}

export function attachHook() {
  if (!map) {
    page.PromiseOrig = page.Promise;
    page.Promise = class extends page.PromiseOrig {
      constructor(executor: any) {
        super(executor);
        if (!executor.toString().includes('maps.wplace.live'))
          return;
        this.then(async (x: Map) => await mapCreated(x));
        page.Promise = page.PromiseOrig;
        page.PromiseOrig = undefined;
      }
    };
  }

  if (hookInstalled)
    return;

  const hookedFetch = (originalFetch: any) => async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : ((input as Request).url) || '';

    const meMatch = matchMeUrl(urlStr);
    if (meMatch) {
      try {
        const response = await originalFetch(input as any, init as any);
        if (!response.ok) return response;

        const ct = (response.headers.get('Content-Type') || '').toLowerCase();
        if (!ct.includes('application/json')) return response;

        const json = await response.json();
        me.data = json;

        updateUI();

        return new Response(new Blob([JSON.stringify(json)]), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (e) {
        console.error("Overlay Pro: Error processing me", e);
        return originalFetch(input as any, init as any);
      }
    }

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
