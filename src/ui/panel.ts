/// <reference types="tampermonkey" />
import { config, saveConfig, getActiveOverlay, applyTheme, type OverlayItem } from '../core/store';
import { clearOverlayCache } from '../core/cache';
import { showToast } from '../core/toast';
import { fileToDataURL, blobToDataURL, gmFetchBlob } from '../core/gm';
import { uniqueName, uid, lonLatToPixel, pixelToLonLat, selectPixel } from '../core/util';
import { decodeOverlayImage, updateOverlays } from '../core/overlay';
import { buildCCModal, openCCModal } from './ccModal';
import { buildRSModal, openRSModal } from './rsModal';
import { map, menu, user } from '../core/hook';
import { BlobReader, BlobWriter, HttpReader, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { TILE_SIZE } from '../core/constants';

let panelEl: HTMLDivElement | null = null;

function $(id: string) { return document.getElementById(id)!; }

export function createUI() {
  if (document.getElementById('overlay-pro-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'overlay-pro-panel';
  panelEl = panel;

  const panelW = 340;
  const defaultLeft = Math.max(12, window.innerWidth - panelW - 80);
  panel.style.left = (Number.isFinite(config.panelX as any) ? (config.panelX as any) : defaultLeft) + 'px';
  panel.style.top = (Number.isFinite(config.panelY as any) ? (config.panelY as any) : 120) + 'px';

  panel.innerHTML = `
      <div class="op-header" id="op-header">
        <div class="op-row in-header">
          <h3>Overlay Pro</h3>
          <div class="op-small-text" id="op-small-stats"></div>
        </div>
        <div class="op-header-actions">
          <button class="op-hdr-btn" id="op-theme-toggle" title="Toggle theme">☀️/🌙</button>
          <button class="op-toggle-btn" id="op-panel-toggle" title="Collapse">▾</button>
        </div>
      </div>
      <div class="op-content" id="op-content">
        <div class="op-section">
          <div class="op-section-title">
            <div class="op-title-left">
              <span class="op-title-text">Information</span>
            </div>
            <div class="op-title-right">
                <button class="op-chevron" id="op-collapse-stats" title="Collapse/Expand">▾</button>
            </div>
          </div>
          <div id="op-stats-body">
            <div class="op-row">
              <div>Droplets:</div>
              <div id="op-droplets-value">idk :&lt;</div>
            </div>
            <div class="op-row">
              <div>Level:</div>
              <div id="op-level-value">idk :&lt;</div>
            </div>
            <div class="op-row">
              <div>Pixel:</div>
              <div id="op-coord-display" style="cursor: pointer;">idk :&lt;</div>
            </div>
          </div>
        </div>

        <div class="op-section" id="op-mode-section">
          <div class="op-section-title">
            <div class="op-title-left">
              <span class="op-title-text">Mode</span>
            </div>
            <div class="op-title-right">
              <button class="op-chevron" id="op-collapse-mode" title="Collapse/Expand">▾</button>
            </div>
          </div>
          <div id="op-mode-body">
            <div class="op-row op-tabs">
              <button class="op-tab-btn" data-mode="full">Full</button>
              <button class="op-tab-btn" data-mode="dots">Dots</button>
              <button class="op-tab-btn" data-mode="none">Disabled</button>
            </div>
            <div class="op-mode-setting" id="op-mode-settings">
              <div class="op-row" id="op-layering-btns"><label>Layering</label></div>
              <div class="op-row"><label style="width: 60px;">Opacity</label><input type="range" min="0" max="1" step="0.05" class="op-slider op-grow" id="op-opacity-slider"><span id="op-opacity-value" style="width: 36px; text-align: right;">70%</span></div>
            </div>
          </div>
        </div>

        <div class="op-section">
          <div class="op-section-title">
            <div class="op-title-left">
              <span class="op-title-text">Overlays</span>
            </div>
            <div class="op-title-right">
              <div class="op-row in-header">
                <button class="op-button in-header" id="op-add-overlay" title="Create a new overlay">+ Add</button>
                <button class="op-button in-header" id="op-import-overlay" title="Import overlay">Import</button>
                <button class="op-button in-header" id="op-export-overlay" title="Export active overlay">Export</button>
                <button class="op-chevron" id="op-collapse-list" title="Collapse/Expand">▾</button>
                <input type="file" id="op-import-overlay-input" accept=".overlay" multiple hidden>
              </div>
            </div>
          </div>
          <div id="op-list-wrap">
            <div class="op-list resizable" id="op-overlay-list" style="height: 170px;"></div>
          </div>
        </div>

        <div class="op-section" id="op-editor-section">
          <div class="op-section-title">
            <div class="op-title-left">
              <span class="op-title-text">Editor</span>
            </div>
            <div class="op-title-right">
              <button class="op-chevron" id="op-collapse-editor" title="Collapse/Expand">▾</button>
            </div>
          </div>

          <div id="op-editor-body">
            <div class="op-row">
              <label style="width: 40px;" for="op-name">Name</label>
              <input type="text" class="op-input op-grow" id="op-name">
              <button class="op-button" id="op-move-overlay" title="Move overlay to currently selected pixel">Move</button>
            </div>

            <div class="op-row">
              <label style="width: 40px;" for="op-image-paste">Image</label>
              <button class="op-button" id="op-image-paste">Paste from clipboard</button>
            </div>

            <div class="op-row">
              <div class="op-preview" id="op-dropzone">
                <img id="op-dropzone-image" alt="No image">
                <div class="op-drop-hint" id="op-dropzone-hint">Drop here or click to browse.</div>
                <input type="file" id="op-file-input" accept="image/*" style="display:none">
              </div>
            </div>

            <div class="op-row" id="op-cc-btn-row" style="display: none; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding-top: 4px;">
              <button class="op-button" id="op-download-overlay" title="Download this overlay image">Download</button>
              <button class="op-button" id="op-open-resize" title="Resize the overlay image">Resize</button>
              <button class="op-button" id="op-open-cc" title="Match colors to Wplace palette">Color Match</button>
            </div>

            <div class="op-row"><span class="op-muted" id="op-overlay-coord-display"></span></div>
          </div>
        </div>
      </div>
  `;
  document.body.appendChild(panel);

  buildCCModal();
  buildRSModal();
  addEventListeners(panel);
  enableDrag(panel);
  updateUI();
}

function rebuildOverlayListUI() {
  const list = $('op-overlay-list');
  list.innerHTML = '';
  for (const ov of config.overlays) {
    const item = document.createElement('div');
    item.className = 'op-item' + (ov.id === config.activeOverlayId ? ' active' : '');
    const localTag = !ov.image ? ' (no image)' : '';
    item.innerHTML = `
        <input type="radio" name="op-active" ${ov.id === config.activeOverlayId ? 'checked' : ''} title="Set active"/>
        <input type="checkbox" ${ov.enabled ? 'checked' : ''} title="Toggle enabled"/>
        <div class="op-item-name" title="${(ov.name || '(unnamed)') + localTag}">${(ov.name || '(unnamed)') + localTag}</div>
        <button class="op-button" title="Jump to location">Jump</button>
        <button class="op-icon-btn" title="Delete overlay">🗑️</button>
    `;
    const [radio, checkbox, nameDiv, jumpBtn, trashBtn] = item.children as any as [HTMLInputElement, HTMLInputElement, HTMLDivElement, HTMLButtonElement, HTMLButtonElement];
    radio.addEventListener('change', async () => { config.activeOverlayId = ov.id; await saveConfig(['activeOverlayId']); updateUI(); });
    checkbox.addEventListener('change', async () => {
      ov.enabled = checkbox.checked; await saveConfig(['overlays']); clearOverlayCache(); updateUI();
      await updateOverlays();
    });
    nameDiv.addEventListener('click', async () => { config.activeOverlayId = ov.id; await saveConfig(['activeOverlayId']); updateUI(); });
    jumpBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const img = await decodeOverlayImage(ov.image);
      const camera = map.cameraForBounds([
        pixelToLonLat(ov.x, ov.y),
        pixelToLonLat(ov.x + img.width, ov.y + img.height)
      ], {
        padding: { top: 40, bottom: 12 + 133 + 40, right: 40, left: 40 }
      });
      camera.zoom = Math.max(camera.zoom, 11);
      camera.bearing = null;
      selectPixel(ov.x, ov.y, camera.zoom);
      map.flyTo(camera);
      updateUI();
    });
    trashBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete overlay "${ov.name || '(unnamed)'}"?`)) return;
      const idx = config.overlays.findIndex(o => o.id === ov.id);
      if (idx >= 0) {
        config.overlays.splice(idx, 1);
        if (config.activeOverlayId === ov.id) config.activeOverlayId = config.overlays[0]?.id || null;
        await saveConfig(['overlays', 'activeOverlayId']); clearOverlayCache(); updateUI();
        await updateOverlays();
      }
    });
    list.appendChild(item);
  }
}

async function addBlankOverlay() {
  if (menu.name !== 'pixelSelected' || !menu.latLon) {
    showToast('Select a pixel to place the overlay on first!', 'error', 5000);
    return;
  }
  const [ x, y ] = lonLatToPixel(menu.latLon[1], menu.latLon[0]);
  const name = uniqueName('Overlay', config.overlays.map(o => o.name || ''));
  const ov = { id: uid(), name, enabled: true, image: null, x, y, opacity: 0.7 };
  config.overlays.push(ov);
  config.activeOverlayId = ov.id;
  await saveConfig(['overlays', 'activeOverlayId']);
  clearOverlayCache();
  await updateOverlays();
  updateUI();
  return ov;
}

async function setOverlayImageFromBlob(ov: OverlayItem, blob: Blob) {
  if (!blob || !String(blob.type).startsWith('image/')) {
    showToast('Please choose an image file.', 'error');
    return;
  }
  await setOverlayImage(ov, await blobToDataURL(blob));
}

async function setOverlayImageFromURL(ov: OverlayItem, url: string) {
  await setOverlayImageFromBlob(ov, await gmFetchBlob(url));
}

async function setOverlayImageFromFile(ov: OverlayItem, file: File) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    showToast('Please choose an image file.', 'error');
    return;
  }
  await setOverlayImage(ov, await fileToDataURL(file));
}

async function setOverlayImage(ov: OverlayItem, image: string) {
  ov.image = image;
  await saveConfig(['overlays']);
  clearOverlayCache();
  updateUI();
  await updateOverlays();
  showToast(`Image loaded.`);
}

async function importOverlays(files: FileList) {
  let imported = 0
  let failed = 0;
  let shouldOverride = null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const zip = new ZipReader(new BlobReader(file));
      const entries = await zip.getEntries();
      const metaFile = entries.find(x => x.filename == 'meta.json');
      const imageFile = entries.find(x => x.filename == 'image.png');
      if (!metaFile) {
        showToast(`Failed to import ${file.name}: missing meta.json`);
        failed++;
        continue;
      }
      if (!imageFile) {
        showToast(`Failed to import ${file.name}: missing image.png`);
        failed++;
        continue;
      }

      const meta = JSON.parse(await metaFile.getData(new TextWriter()));
      const image = await blobToDataURL(await imageFile.getData(new BlobWriter()));

      const override = shouldOverride === false ? undefined : config.overlays.find(x => x.name.toLowerCase() === meta.name.toLowerCase());
      if (shouldOverride === null && override) {
        shouldOverride = confirm('Some imported overlays have names that are already in use.\n\nOK to override overlays with overlapping names.\nCancel to rename imported overlays.');
      }
      if (override && shouldOverride) {
        override.image = image;
        override.x = meta.x !== undefined ? meta.x : override.x;
        override.y = meta.y !== undefined ? meta.y : override.y;
      }
      else {
        config.overlays.push({
          id: uid(),
          name: uniqueName(meta.name || 'Imported Overlay', config.overlays.map(o => o.name || '')),
          enabled: true,
          image,
          x: Number.isFinite(meta.x) ? meta.x : 0,
          y: Number.isFinite(meta.y) ? meta.y : 0
        });
      }
      imported++;
    }
    catch (e) {
      showToast(`Failed to import ${file.name}: ${e}`);
      failed++;
      continue;
    }
  }
  if (imported > 0) {
    config.activeOverlayId = config.overlays[config.overlays.length - 1].id;
    await saveConfig(['overlays', 'activeOverlayId']); clearOverlayCache(); updateUI();
    await updateOverlays();
  }
  showToast(`Import finished. Imported: ${imported}${failed ? `, Failed: ${failed}` : ''}`, 'info', 5000);
}

async function exportActiveOverlay() {
  const ov = getActiveOverlay();
  if (!ov) {
    showToast('No overlay selected.', 'error');
    return;
  }
  if (!ov.image) {
    showToast('Overlay doesn\'t have an image.', 'error');
    return;
  }
  try {
    const blob = new BlobWriter('octet/stream');
    const zip = new ZipWriter(blob, { level: 0 });
    await zip.add('meta.json', new TextReader(JSON.stringify({
      name: ov.name,
      x: ov.x == 0 ? undefined : ov.x,
      y: ov.y == 0 ? undefined : ov.y
    }, null, 2)));
    await zip.add('image.png', new HttpReader(ov.image));
    await zip.close();
    const url = URL.createObjectURL(await blob.getData());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ov.name}.overlay`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported overlay "${ov.name}"!`, 'success');
  }
  catch (e) {
    showToast(`Failed to export overlay: ${e}`, 'error', 5000);
  }
}

function addEventListeners(panel: HTMLDivElement) {
  $('op-theme-toggle').addEventListener('click', async (e) => { e.stopPropagation(); config.theme = config.theme === 'light' ? 'dark' : 'light'; await saveConfig(['theme']); applyTheme(); updateThemeToggle(); });
  $('op-panel-toggle').addEventListener('click', (e) => { e.stopPropagation(); config.isPanelCollapsed = !config.isPanelCollapsed; saveConfig(['isPanelCollapsed']); updateUI(); });

  $('op-coord-display').addEventListener('click', () => {
    if (menu.name !== 'pixelSelected' || !menu.latLon) {
      showToast('Select a pixel to copy its position.', 'error');
      return;
    }
    const [ x, y ] = lonLatToPixel(menu.latLon[1], menu.latLon[0]);
    navigator.clipboard.writeText(`  "x": ${x},\n  "y": ${y}`)
      .then(() => {
        showToast('Copied position to clipboard!', 'success');
      })
      .catch(x => {
        showToast(`Failed to copy position to clipboard: ${x}`, 'error');
      });
  });

  panel.querySelectorAll('.op-tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const mode = btn.getAttribute('data-mode') as 'full' | 'dots' | 'none';
        config.overlayStyle = mode;
        saveConfig(['overlayStyle']);
        updateUI();
        await updateOverlays();
    });
  });

  $('op-opacity-slider').addEventListener('input', async (e: any) => {
    config.overlayOpacity = parseFloat(e.target.value);
    $('op-opacity-value').textContent = Math.round(config.overlayOpacity * 100) + '%';
  });
  $('op-opacity-slider').addEventListener('change', async () => { await saveConfig(['overlayOpacity']); await updateOverlays(); });

  const importOverlay = $('op-import-overlay');
  const importOverlayInput = $('op-import-overlay-input') as HTMLInputElement;
  $('op-add-overlay').addEventListener('click', async () => { try { await addBlankOverlay(); } catch (e) { console.error(e); } });
  importOverlay.addEventListener('click', () => importOverlayInput.click());
  importOverlayInput.addEventListener('change', async () => { await importOverlays(importOverlayInput.files); importOverlayInput.value = null; });
  importOverlay.addEventListener('drop', async e => { e.preventDefault(); await importOverlays(e.dataTransfer.files) });
  importOverlay.addEventListener('dragover', (e: any) => e.preventDefault());
  $('op-export-overlay').addEventListener('click', async () => await exportActiveOverlay());
  $('op-collapse-stats').addEventListener('click', () => { config.collapseStats = !config.collapseStats; saveConfig(['collapseStats']); updateUI(); });
  $('op-collapse-mode').addEventListener('click', () => { config.collapseMode = !config.collapseMode; saveConfig(['collapseMode']); updateUI(); });
  $('op-collapse-list').addEventListener('click', () => { config.collapseList = !config.collapseList; saveConfig(['collapseList']); updateUI(); });
  $('op-collapse-editor').addEventListener('click', () => { config.collapseEditor = !config.collapseEditor; saveConfig(['collapseEditor']); updateUI(); });

  $('op-name').addEventListener('change', async (e: any) => {
    const ov = getActiveOverlay(); if (!ov) return;
    const desired = (e.target.value || '').trim() || 'Overlay';
    if (config.overlays.some(o => o.id !== ov.id && (o.name || '').toLowerCase() === desired.toLowerCase())) {
      ov.name = uniqueName(desired, config.overlays.map(o => o.name || ''));
      showToast(`Name in use. Renamed to "${ov.name}".`);
    } else { ov.name = desired; }
    await saveConfig(['overlays']); rebuildOverlayListUI();
    await updateOverlays();
  });

  $('op-image-paste').addEventListener('click', async () => {
    const ov = getActiveOverlay();
    if (!ov) {
      showToast('No active overlay selected.', 'error');
      return;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(x => x.startsWith('image/'));
      if (imageType) {
        try {
          await setOverlayImageFromBlob(ov, await item.getType(imageType));
        }
        catch (err) {
          console.error(err);
          showToast('Failed to load pasted image.', 'error');
        }
        break;
      }
      if (!item.types.includes('text/plain'))
        continue;
      try {
        await setOverlayImageFromURL(ov, await (await item.getType('text/plain')).text());
      }
      catch (err) {
        console.error(err);
        showToast('Failed to load pasted image.', 'error');
      }
      break;
    }
    const url = ( $('op-image-url') as HTMLInputElement ).value.trim(); if (!url) { showToast('Enter an image link first.', 'error'); return; }
    try { await setOverlayImageFromURL(ov, url); } catch (e) { console.error(e); showToast('Failed to fetch image.', 'error'); }
  });

  const dropzone = $('op-dropzone');
  dropzone.addEventListener('click', () => $('op-file-input').click());
  $('op-file-input').addEventListener('change', async (e: any) => {
    const ov = getActiveOverlay();
    if (!ov)
      return;
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file)
      return;
    try {
      await setOverlayImageFromFile(ov, file);
    }
    catch (err) {
      console.error(err);
      showToast('Failed to load local image.', 'error');
    }
  });
  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, (e: any) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drop-highlight'); }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e: any) => { e.preventDefault(); e.stopPropagation(); if (evt === 'dragleave' && e.target !== dropzone) return; dropzone.classList.remove('drop-highlight'); }));
  dropzone.addEventListener('drop', async e => {
    const ov = getActiveOverlay();
    if (!ov)
      return;
    if (!e.dataTransfer || !e.dataTransfer.items)
      return;
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const item: DataTransferItem = e.dataTransfer.items[i];
      const file = item.getAsFile();
      if (file) {
        try {
          await setOverlayImageFromFile(ov, file);
        }
        catch (err) {
          console.error(err);
          showToast('Failed to load dropped image.', 'error');
        }
        break;
      }
      item.getAsString(async str => {
        if (!URL.canParse(str))
          return;
        try {
          await setOverlayImageFromURL(ov, str);
        }
        catch (err) {
          console.error(err);
          showToast('Failed to load dropped image.', 'error');
        }
      });
    }
  });

  $('op-move-overlay').addEventListener('click', async () => {
    if (menu.name !== 'pixelSelected' || !menu.latLon) {
      showToast('Select a pixel to move to first!', 'error', 5000);
      return;
    }
    const ov = getActiveOverlay();
    [ ov.x, ov.y ] = lonLatToPixel(menu.latLon[1], menu.latLon[0]);
    await saveConfig(['overlays']);
    clearOverlayCache();
    await updateOverlays();
  });

  $('op-download-overlay').addEventListener('click', () => {
    const ov = getActiveOverlay();
    if (!ov || !ov.image) { showToast('No overlay image to download.'); return; }
    const a = document.createElement('a');
    a.href = ov.image;
    a.download = `${(ov.name || 'overlay').replace(/[^\w.-]+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $('op-open-cc').addEventListener('click', () => {
    const ov = getActiveOverlay(); if (!ov || !ov.image) { showToast('No overlay image to edit.'); return; }
    openCCModal(ov);
  });
  const resizeBtn = $('op-open-resize');
  if (resizeBtn) {
    resizeBtn.addEventListener('click', () => {
      const ov = getActiveOverlay();
      if (!ov || !ov.image) { showToast('No overlay image to resize.'); return; }
      openRSModal(ov);
    });
  }
}

function enableDrag(panel: HTMLDivElement) {
  const header = panel.querySelector('#op-header') as HTMLDivElement;
  if (!header) return;

  let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0, moved = false;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isDragging = true; moved = false; startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect(); startLeft = rect.left; startTop = rect.top;
    (header as any).setPointerCapture?.(e.pointerId); e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop  = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = clamp(startLeft + dx, 8, maxLeft) + 'px';
    panel.style.top  = clamp(startTop  + dy, 8, maxTop)  + 'px';
    moved = true;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false; (header as any).releasePointerCapture?.(e.pointerId);
    if (moved) {
      config.panelX = parseInt(panel.style.left, 10) || 0;
      config.panelY = parseInt(panel.style.top, 10) || 0;
      saveConfig(['panelX', 'panelY']);
    }
  };
  header.addEventListener('pointerdown', onPointerDown);
  header.addEventListener('pointermove', onPointerMove);
  header.addEventListener('pointerup', onPointerUp);
  header.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop  = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    const newLeft = Math.min(Math.max(rect.left, 8), maxLeft);
    const newTop  = Math.min(Math.max(rect.top, 8), maxTop);
    panel.style.left = newLeft + 'px'; panel.style.top = newTop + 'px';
    config.panelX = newLeft; config.panelY = newTop; saveConfig(['panelX', 'panelY']);
  });
}

function updateEditorUI() {
  const editorSect = $('op-editor-section');
  const editorBody = $('op-editor-body');
  const ov = getActiveOverlay();

  editorSect.style.display = ov ? 'flex' : 'none';
  if (!ov) return;

  ( $('op-name') as HTMLInputElement ).value = ov.name || '';

  const dropzoneImage = $('op-dropzone-image') as HTMLImageElement;
  const dropzoneHint = $('op-dropzone-hint');
  const ccRow = $('op-cc-btn-row');

  if (ov.image) {
    dropzoneImage.src = ov.image;
    dropzoneImage.style.display = undefined;
    dropzoneHint.style.display = 'none';
    ccRow.style.display = 'flex';
  }
  else {
    dropzoneImage.style.display = 'none';
    dropzoneHint.style.display = undefined;
    ccRow.style.display = 'none';
  }

  const overlayCoordDisplay = $('op-overlay-coord-display');
  if (overlayCoordDisplay) {
    overlayCoordDisplay.textContent = `pos: (${ov.x}, ${ov.y}) | (${Math.floor(ov.x / TILE_SIZE)}, ${Math.floor(ov.y / TILE_SIZE)}) | (${Math.floor(ov.x % TILE_SIZE)}, ${Math.floor(ov.y % TILE_SIZE)})`;
  }

  editorBody.style.display = config.collapseEditor ? 'none' : 'block';
  const chevron = $('op-collapse-editor');
  if (chevron) chevron.textContent = config.collapseEditor ? '▸' : '▾';
}

export function updateThemeToggle() {
  const themeToggle = document.getElementById('op-theme-toggle');
  themeToggle.textContent = config.theme === 'dark' ? '☀️' : '🌙';
}

function levelPixels(level) {
  return Math.ceil(Math.pow(level * Math.pow(30, 0.65), 1 / 0.65));
}

export function updateUI() {
  if (!panelEl) return;

  const ov = getActiveOverlay();

  applyTheme();
  updateThemeToggle();

  const content = $('op-content');
  const toggle = $('op-panel-toggle');
  const header = $('op-header');
  const collapsed = !!config.isPanelCollapsed;
  content.style.display = collapsed ? 'none' : 'flex';
  toggle.textContent = collapsed ? '▸' : '▾';
  toggle.title = collapsed ? 'Expand' : 'Collapse';
  header.style = collapsed ? 'border-bottom: none;' : undefined;

  // stats
  const statsBody = $('op-stats-body');
  const statsCz = $('op-collapse-stats');
  const dropletsValue = $('op-droplets-value');
  const levelValue = $('op-level-value');
  const smallStats = $('op-small-stats');
  if (statsBody) statsBody.style.display = config.collapseStats ? 'none' : 'block';
  if (statsCz) statsCz.textContent = config.collapseStats ? '▸' : '▾';
  if (user && user.data) {
    const level = Math.floor(user.data.level);
    const percent = Math.floor((user.data.level - level) * 100.0);
    const forCurrentLevel = levelPixels(level - 1);
    const forNextLevel = levelPixels(level);
    const pixels = user.data.pixelsPainted;
    if (dropletsValue) {
      dropletsValue.textContent = `${user.data.droplets}`;
    }
    if (levelValue) {
      levelValue.textContent = `${level} (${percent}% ${pixels - forNextLevel}/${pixels - forCurrentLevel}/${forNextLevel - forCurrentLevel})`;
    }
    if (smallStats) {
      smallStats.textContent = `(${user.data.droplets}💧| ${pixels - forNextLevel}/${pixels - forCurrentLevel}/${forNextLevel - forCurrentLevel})`;
    }
  }
  else {
    if (dropletsValue) {
      dropletsValue.textContent = 'idk :<';
    }
    if (levelValue) {
      levelValue.textContent = 'idk :<';
    }
    if (smallStats) {
      smallStats.textContent = '(offline or logged out)';
    }
  }

  if (smallStats && !collapsed) {
    smallStats.textContent = `v${GM_info.script.version}`;
  }

  const coordDisplay = $('op-coord-display');
  if (coordDisplay) {
    if (menu.name === 'pixelSelected' && menu.latLon) {
      const [ x, y ] = lonLatToPixel(menu.latLon[1], menu.latLon[0]);
      coordDisplay.textContent = `(${x}, ${y}) (${Math.floor(x / TILE_SIZE)}, ${Math.floor(y / TILE_SIZE)}) (${Math.floor(x % TILE_SIZE)}, ${Math.floor(y % TILE_SIZE)})`;
    }
    else {
      coordDisplay.textContent = 'none';
    }
  }

  // --- Mode Tabs ---
  panelEl.querySelectorAll('.op-tab-btn').forEach(btn => {
    const mode = btn.getAttribute('data-mode');
    let isActive = mode === config.overlayStyle;
    btn.classList.toggle('active', isActive);
  });

  const modeBody = $('op-mode-body');
  const modeCz = $('op-collapse-mode');
  if (modeBody) modeBody.style.display = config.collapseMode ? 'none' : 'block';
  if (modeCz) modeCz.textContent = config.collapseMode ? '▸' : '▾';

  // --- Mode Settings ---
  if (ov) {
    ($('op-opacity-slider') as HTMLInputElement).value = String(config.overlayOpacity);
    $('op-opacity-value').textContent = Math.round(config.overlayOpacity * 100) + '%';
  }

  const layeringBtns = $('op-layering-btns');
  layeringBtns.innerHTML = '';
  for (const layering of [ 'Behind', 'Above', 'Top' ]) {
    const button = document.createElement('button');
    button.textContent = layering;
    button.className = 'op-button' + (config.overlayLayering === layering.toLowerCase() ? ' active' : '');
    button.addEventListener('click', async () => {
      config.overlayLayering = layering.toLowerCase() as 'behind' | 'above' | 'top';
      saveConfig(['overlayLayering']);
      updateUI();
      await updateOverlays();
    });
    layeringBtns.appendChild(button);
  }

  const listWrap = $('op-list-wrap');
  const listCz = $('op-collapse-list');
  listWrap.style.display = config.collapseList ? 'none' : 'block';
  if (listCz) listCz.textContent = config.collapseList ? '▸' : '▾';

  rebuildOverlayListUI();
  updateEditorUI();
}
