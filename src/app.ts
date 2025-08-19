/// <reference types="tampermonkey" />
import { loadConfig, applyTheme } from './core/store';
import { attachHook } from './core/hook';
import { injectStyles } from './ui/styles';
import { createUI } from './ui/panel';

export async function bootstrapApp() {
  injectStyles();
  await loadConfig();
  applyTheme();
  createUI();
  attachHook();
  console.log('Overlay Pro UI ready.');
}