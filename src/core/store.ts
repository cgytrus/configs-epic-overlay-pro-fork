/// <reference types="tampermonkey" />
import { gmGet, gmSet } from './gm';
import { DEFAULT_FREE_KEYS, DEFAULT_PAID_KEYS } from './palette';

export type OverlayItem = {
  id: string;
  name: string;
  enabled: boolean;
  imageUrl: string | null;
  imageBase64: string | null;
  imageId: string;
  isLocal: boolean;
  pixelUrl: string | null;
  offsetX: number;
  offsetY: number;
  opacity: number;
};

export type Config = {
  overlays: OverlayItem[];
  activeOverlayId: string | null;
  overlayMode: 'behind' | 'above' | 'minify' | 'original';
  minifyStyle: 'dots' | 'symbols';
  isPanelCollapsed: boolean;
  autoCapturePixelUrl: boolean;
  panelX: number | null;
  panelY: number | null;
  theme: 'light' | 'dark';
  collapseStats: boolean;
  collapseMode: boolean;
  collapseList: boolean;
  collapseEditor: boolean;
  collapsePositioning: boolean;
  ccFreeKeys: string[];
  ccPaidKeys: string[];
  ccZoom: number;
  ccRealtime: boolean;
};

export const config: Config = {
  overlays: [],
  activeOverlayId: null,
  overlayMode: 'behind',
  minifyStyle: 'dots',
  isPanelCollapsed: false,
  autoCapturePixelUrl: false,
  panelX: null,
  panelY: null,
  theme: 'light',
  collapseStats: false,
  collapseMode: false,
  collapseList: false,
  collapseEditor: false,
  collapsePositioning: false,
  ccFreeKeys: DEFAULT_FREE_KEYS.slice(),
  ccPaidKeys: DEFAULT_PAID_KEYS.slice(),
  ccZoom: 1.0,
  ccRealtime: false,
};

export const me: { data: any } = {
  data: { }
};

export const CONFIG_KEYS = Object.keys(config) as (keyof Config)[];

export async function loadConfig() {
  try {
    await Promise.all(CONFIG_KEYS.map(async k => {
      (config as any)[k] = await gmGet(k as string, (config as any)[k]);
    }));
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