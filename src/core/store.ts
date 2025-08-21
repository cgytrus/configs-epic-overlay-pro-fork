/// <reference types="tampermonkey" />
import { TILE_SIZE } from './constants';
import { gmGet, gmSet } from './gm';
import { DEFAULT_FREE_KEYS, DEFAULT_PAID_KEYS } from './palette';

export type OverlayItem = {
  id: string;
  name: string;
  enabled: boolean;
  image: string | null;
  x: number;
  y: number;
};

export type Config = {
  overlays: OverlayItem[];
  activeOverlayId: string | null;
  overlayLayering: 'behind' | 'above' | 'top';
  overlayStyle: 'full' | 'dots' | 'none';
  overlayOpacity: number;
  isPanelCollapsed: boolean;
  panelX: number | null;
  panelY: number | null;
  theme: 'light' | 'dark';
  collapseStats: boolean;
  collapseMode: boolean;
  collapseList: boolean;
  collapseEditor: boolean;
  ccFreeKeys: string[];
  ccPaidKeys: string[];
  ccZoom: number;
  ccRealtime: boolean;
};

export const config: Config = {
  overlays: [],
  activeOverlayId: null,
  overlayLayering: 'top',
  overlayStyle: 'dots',
  overlayOpacity: 0.7,
  isPanelCollapsed: false,
  panelX: null,
  panelY: null,
  theme: 'light',
  collapseStats: false,
  collapseMode: false,
  collapseList: false,
  collapseEditor: false,
  ccFreeKeys: DEFAULT_FREE_KEYS.slice(),
  ccPaidKeys: DEFAULT_PAID_KEYS.slice(),
  ccZoom: 1.0,
  ccRealtime: false,
};

export const CONFIG_KEYS = Object.keys(config) as (keyof Config)[];

export async function loadConfig() {
  try {
    await Promise.all(CONFIG_KEYS.map(async k => {
      (config as any)[k] = await gmGet(k as string, (config as any)[k]);
    }));
    for (const ov of config.overlays) {
      try {
        if ((ov as any).imageBase64) {
          ov.image = (ov as any).imageBase64;
          (ov as any).imageBase64 = undefined;
        }
        if ((ov as any).pixelUrl) {
          const u = new URL((ov as any).pixelUrl);
          const parts = u.pathname.split('/');
          const sp = new URLSearchParams(u.search);
          ov.x = parseInt(parts[3], 10) * TILE_SIZE + parseInt(sp.get('x') || '0', 10);
          ov.y = parseInt(parts[4], 10) * TILE_SIZE + parseInt(sp.get('y') || '0', 10);
          (ov as any).pixelUrl = undefined;
        }
        if ((ov as any).offsetX) {
          ov.x += (ov as any).offsetX;
          (ov as any).offsetX = undefined;
        }
        if ((ov as any).offsetY) {
          ov.y += (ov as any).offsetY;
          (ov as any).offsetY = undefined;
        }
      }
      catch (e) {
        console.error(e);
      }
    }
    if (!Array.isArray(config.ccFreeKeys) || config.ccFreeKeys.length === 0) config.ccFreeKeys = DEFAULT_FREE_KEYS.slice();
    if (!Array.isArray(config.ccPaidKeys)) config.ccPaidKeys = DEFAULT_PAID_KEYS.slice();
    if (!Number.isFinite(config.ccZoom) || config.ccZoom <= 0) config.ccZoom = 1.0;
    if (typeof config.ccRealtime !== 'boolean') config.ccRealtime = false;
  } catch (e) {
    console.error('Overlay Pro: Failed to load config', e);
  }
}

export async function saveConfig(keys: (keyof Config)[] = CONFIG_KEYS) {
  try {
    await Promise.all(keys.map(k => gmSet(k as string, (config as any)[k])));
  } catch (e) {
    console.error('Overlay Pro: Failed to save config', e);
  }
}

export function getActiveOverlay(): OverlayItem | null {
  return config.overlays.find(o => o.id === config.activeOverlayId) || null;
}

export function applyTheme() {
  document.body.classList.toggle('op-theme-dark', config.theme === 'dark');
  document.body.classList.toggle('op-theme-light', config.theme !== 'dark');
  const stack = document.getElementById('op-toast-stack');
  if (stack) stack.classList.toggle('op-dark', config.theme === 'dark');
}