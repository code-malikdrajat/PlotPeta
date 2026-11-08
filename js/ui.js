// PlotPeta: Kontrol UI: slider, drag-drop, zoom, kunci peta, header, tema

// ==================== LIVE SLIDERS & CONTROLS ====================

// Drag and drop onto Canvas
const wrapEl = $('wrap');
['dragenter', 'dragover'].forEach(name => {
  wrapEl.addEventListener(name, e => {
    e.preventDefault();
    wrapEl.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(name => {
  wrapEl.addEventListener(name, e => {
    e.preventDefault();
    wrapEl.classList.remove('dragover');
  });
});
wrapEl.addEventListener('drop', e => {
  if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]){
    const dt = new DataTransfer();
    dt.items.add(e.dataTransfer.files[0]);
    $('file').files = dt.files;
    $('file').dispatchEvent(new Event('change'));
  }
});

// Floating Zoom Controls
function zoomBy(k){
  if(!img)return;
  const cx = W() / 2, cy = H() / 2;
  const p = toI([cx, cy]);
  V.s = Math.min(Math.max(V.s * k, 0.02), 60);
  V.x = cx - p[0] * V.s;
  V.y = cy - p[1] * V.s;
  draw();
}
$('btnZoomIn').onclick = () => zoomBy(1.25);
$('btnZoomOut').onclick = () => zoomBy(1 / 1.25);
$('btnZoomFit').onclick = () => { if(img){ fitV(); draw(); } };

const lockOpenIcon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 7.5-2"></path></svg>';
const lockClosedIcon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';
function updateMapLockUI(){
  const b=$('btnMapLock');if(!b)return;
  b.classList.toggle('on',mapLocked);
  b.setAttribute('aria-pressed',String(mapLocked));
  b.title=mapLocked?'Buka kunci geser peta':'Kunci geser peta (zoom tetap aktif)';
  b.innerHTML=mapLocked?lockClosedIcon:lockOpenIcon;
  plotCanvas.style.cursor=mapLocked&&tool==='pan'?'not-allowed':tool==='pan'?'grab':'crosshair';
}
$('btnMapLock')?.addEventListener('click',()=>{
  mapLocked=!mapLocked;
  updateMapLockUI();
  setStatus('info', mapLocked?'Peta dikunci: geser dinonaktifkan; zoom tetap aktif.':'Kunci peta dibuka: geser aktif kembali.');
});
updateMapLockUI();

// Group the account tools at the right side of the header, before the login/account button.
(function arrangeHeaderTools(){
  const bar = document.getElementById('bar');
  if (!bar || document.getElementById('headerRightTools')) return;
  const tools = document.createElement('div');
  tools.id = 'headerRightTools';
  tools.setAttribute('aria-label', 'Kontrol akun');
  bar.appendChild(tools);
  ['tokenPill','exp','themeToggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) tools.appendChild(el);
  });
})();

// Dark / Light Theme Toggle
const themeBtn = $('themeToggle');
function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('plotpeta_theme', theme);
  const icon = $('themeIcon');
  if(theme === 'light'){
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    themeBtn.title = 'Ganti ke Mode Gelap';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    themeBtn.title = 'Ganti ke Mode Terang';
  }
}
const savedTheme = localStorage.getItem('plotpeta_theme') || 'dark';
setTheme(savedTheme);
themeBtn.onclick = () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
};

// ==================== STATUS STRIP API ====================
function setStatus(keadaan, pesan, data) {
  const el = document.getElementById('st');
  if (!el) return;
  const dotClass = { ready:'', busy:'warn', error:'error', info:'', context:'' }[keadaan] || '';
  const dot = `<span class="status-dot${dotClass ? ' ' + dotClass : ''}"></span>`;
  if (data && keadaan === 'context') {
    const parts = [];
    if (data.zoom != null) parts.push(`Zoom <b>${Math.round(data.zoom * 100)}%</b>`);
    if (data.x != null && data.y != null) {
      parts.push(`X <b>${data.x.toFixed(1)}</b> Y <b>${data.y.toFixed(1)}</b>`);
    } else if (data.px != null) {
      parts.push(`px <b>${Math.round(data.px)}</b>, <b>${Math.round(data.py)}</b>`);
    }
    if (data.tool) parts.push(data.tool);
    if (data.segments != null) parts.push(`<b>${data.segments}</b> segmen`);
    el.innerHTML = dot + '<span>' + parts.join(' <span style="opacity:.4">·</span> ') + '</span>';
  } else {
    el.innerHTML = dot + '<span>' + pesan + '</span>';
  }
}

// ==================== FILE MENU ====================
const fileMenuEl = document.getElementById('fileMenu');
const btnFileMenu = document.getElementById('btnFileMenu');
if (btnFileMenu && fileMenuEl) {
  btnFileMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btnFileMenu.getBoundingClientRect();
    fileMenuEl.style.left = rect.left + 'px';
    fileMenuEl.style.top = (rect.bottom + 4) + 'px';
    fileMenuEl.hidden = !fileMenuEl.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!fileMenuEl.hidden && !fileMenuEl.contains(e.target) && e.target !== btnFileMenu) {
      fileMenuEl.hidden = true;
    }
  });
  fileMenuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    fileMenuEl.hidden = true;
    if (action === 'open-map') document.getElementById('file')?.click();
    else if (action === 'open-project') document.getElementById('op')?.click();
    else if (action === 'save-project') document.getElementById('sp')?.click();
    else if (action === 'export') document.getElementById('exp')?.click();
    else if (action === 'close-map') document.getElementById('btnClearMap')?.click();
  });
}

// ==================== PAN NAV BUTTON ====================
function syncPanNav() {
  const b = document.getElementById('btnPanNav');
  if (!b) return;
  const on = (typeof tool !== 'undefined' && tool === 'pan');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
const btnPanNav = document.getElementById('btnPanNav');
if (btnPanNav) {
  btnPanNav.addEventListener('click', () => {
    if (typeof setTool !== 'function') return;
    setTool(tool === 'pan' ? null : 'pan');
    syncPanNav();
  });
}
syncPanNav();

// ==================== ACTION BAR ====================
function updateActionBar() {
  syncPanNav();
  const bar = document.getElementById('actionBar');
  const finishBtn = document.getElementById('btnFinish');
  const cancelBtn = document.getElementById('btnCancel');
  const undoBtn = document.getElementById('btnUndo');
  const snap = document.getElementById('btnSnapAction');
  if (!bar || !finishBtn || !cancelBtn || !undoBtn || !snap) return;

  bar.hidden = !img;
  const drawingCount = (typeof cur !== 'undefined' && Array.isArray(cur)) ? cur.length : 0;
  finishBtn.hidden = drawingCount < 2;
  cancelBtn.hidden = drawingCount === 0;
  const hasHistory = (typeof hist !== 'undefined' && hist.length > 0) || drawingCount > 0;
  undoBtn.disabled = !hasHistory;

  const snapCheck = document.getElementById('snap');
  if (snapCheck) snap.setAttribute('aria-pressed', snapCheck.checked ? 'true' : 'false');
}

const btnSnapAction = document.getElementById('btnSnapAction');
if (btnSnapAction) {
  btnSnapAction.addEventListener('click', () => {
    const snapCheck = document.getElementById('snap');
    if (snapCheck) {
      snapCheck.checked = !snapCheck.checked;
      updateActionBar();
      if (typeof setStatus === 'function') setStatus('info', snapCheck.checked ? 'Snap aktif' : 'Snap nonaktif');
    }
  });
}
const btnFinishAction = document.getElementById('btnFinish');
if (btnFinishAction) {
  btnFinishAction.addEventListener('click', () => {
    if (typeof finish === 'function') finish();
    updateActionBar();
  });
}
const btnCancelAction = document.getElementById('btnCancel');
if (btnCancelAction) {
  btnCancelAction.addEventListener('click', () => {
    if (typeof cur !== 'undefined') cur = [];
    if (typeof setStatus === 'function') setStatus('info', 'Dibatalkan');
    if (typeof draw === 'function') draw();
    updateActionBar();
  });
}
const btnUndoAction = document.getElementById('btnUndo');
if (btnUndoAction) {
  btnUndoAction.addEventListener('click', () => {
    if (typeof undo === 'function') undo();
    updateActionBar();
  });
}
// ==================== SIDEBAR ACCORDION (Fase 2B) ====================
const ACC_KEY = 'pp_acc_open';
let accOpen = {};
try { accOpen = JSON.parse(localStorage.getItem(ACC_KEY) || '{}') || {}; } catch (_) { accOpen = {}; }
function saveAccOpen() { try { localStorage.setItem(ACC_KEY, JSON.stringify(accOpen)); } catch (_) {} }
function accSection(id) { return document.querySelector('.pp-acc[data-acc="' + id + '"]'); }

(function initAccordion() {
  document.querySelectorAll('.pp-acc').forEach(sec => {
    const id = sec.dataset.acc;
    const head = sec.querySelector('.box-header');
    const body = sec.querySelector('.acc-body');
    if (!head || !body) return;
    const meta = document.createElement('span');
    meta.className = 'acc-meta';
    meta.id = 'accMeta_' + id;
    const chev = document.createElement('span');
    chev.className = 'acc-chevron';
    chev.textContent = '▾';
    head.appendChild(meta);
    head.appendChild(chev);
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    const apply = () => {
      const open = accOpen[id] !== false;
      body.hidden = !open;
      sec.classList.toggle('collapsed', !open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const toggle = () => { accOpen[id] = accOpen[id] === false; saveAccOpen(); apply(); };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    apply();
  });
})();

function accMeta(id, text) {
  const el = document.getElementById('accMeta_' + id);
  if (el) el.textContent = text || '';
}

function updateSidebarForTool() {
  const side = document.getElementById('side');
  if (!side) return;
  side.classList.toggle('side-hidden', !img);
  if (!img) return;
  const secs = { kalibrasi:false, deteksi:false, teks:false, poligon:false, proyek:true };
  const idle = tool === 'pan' || tool === null;
  secs.kalibrasi = tool === 'cal' || (idle && cal.mode === 'map');
  secs.deteksi = tool === 'A';
  secs.teks = tool === 'T' || texts.length > 0 || (typeof aiTexts !== 'undefined' && aiTexts.length > 0);
  secs.poligon = ['P','M','E'].includes(tool) || polys.length > 0;
  Object.keys(secs).forEach(id => {
    const sec = accSection(id);
    if (sec) sec.hidden = !secs[id];
  });
  const ov = document.getElementById('overviewCard');
  if (ov) ov.classList.toggle('hide', !idle);
  accMeta('kalibrasi', cal.mode === 'map' ? (cal.ok ? 'Terkalibrasi' : 'Belum') : 'Lokal');
  accMeta('deteksi', cand.length ? cand.length + ' jalur' : '');
  accMeta('teks', (texts.length + (typeof aiTexts !== 'undefined' ? aiTexts.length : 0)) + ' teks');
  accMeta('poligon', polys.length + ' bidang');
  if (typeof maybeCoachFromState === 'function') maybeCoachFromState();
}

function updateOverview() {
  const ov = document.getElementById('overviewCard');
  if (!ov || !img) return;
  const m = document.getElementById('ovMap');
  if (m) m.textContent = (mapName || 'Peta') + ' · ' + iw + ' × ' + ih + ' px';
  const nTexts = texts.length + (typeof aiTexts !== 'undefined' ? aiTexts.length : 0);
  if (document.getElementById('ovLines')) document.getElementById('ovLines').textContent = lines.length;
  if (document.getElementById('ovPolys')) document.getElementById('ovPolys').textContent = polys.length;
  if (document.getElementById('ovTexts')) document.getElementById('ovTexts').textContent = nTexts;
  const hint = document.getElementById('ovHint');
  if (hint) {
    const bal = (typeof currentTokenBalance === 'number') ? currentTokenBalance : 0;
    const hasObj = lines.length > 0 || polys.length > 0 || nTexts > 0;
    let h;
    if (typeof cand !== 'undefined' && cand.length) h = 'Langkah 2: Rapikan hasil deteksi, lalu Terima semua';
    else if (cal.mode === 'map' && !cal.ok && hasObj) h = 'Langkah 2a: Selesaikan Kalibrasi (C)';
    else if (!lines.length) h = 'Langkah 1: Deteksi Cepat (A) atau Garis penuh (P)';
    else if (!nTexts) h = 'Langkah 3: Tambah Teks Bidang (T)';
    else if (bal < 1) h = 'Butuh token — Isi ulang dulu';
    else h = 'Langkah 4: Simpan DXF' + ((typeof tokenBiaya === 'object' && tokenBiaya && Number(tokenBiaya.ekspor_dxf) === 0) ? ' (Gratis)' : '');
    hint.textContent = h;
    const needToken = h.indexOf('Butuh token') === 0;
    hint.classList.toggle('clickable', needToken);
    hint.dataset.action = needToken ? 'topup' : '';
  }
}

document.getElementById('ovHint')?.addEventListener('click', () => {
  const hint = document.getElementById('ovHint');
  if (hint && hint.dataset.action === 'topup' && typeof openTopupModal === 'function') openTopupModal();
});

// Space+drag = temporary pan (tidak saat mengetik / menggambar).
let spacePrevTool = null;
function isTypingTarget(t) {
  return !!t && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable);
}
addEventListener('keydown', e => {
  if (e.code !== 'Space' || isTypingTarget(e.target)) return;
  if (spacePrevTool !== null || cur.length) return;
  e.preventDefault();
  spacePrevTool = tool;
  if (tool !== 'pan') setTool('pan');
  plotCanvas.style.cursor = 'grab';
});
addEventListener('keyup', e => {
  if (e.code !== 'Space' || spacePrevTool === null) return;
  const prev = spacePrevTool;
  spacePrevTool = null;
  setTool(prev === undefined ? 'pan' : prev);
});
addEventListener('blur', () => {
  if (spacePrevTool === null) return;
  const prev = spacePrevTool;
  spacePrevTool = null;
  setTool(prev === undefined ? 'pan' : prev);
});
// ==================== TOAST + CONFIRM + PROMPT (Fase 2B) ====================
function showToast(msg, type, duration) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'info');
  el.innerHTML = '<span>' + esc(String(msg == null ? '' : msg)) + '</span><button type="button" aria-label="Tutup">×</button>';
  stack.appendChild(el);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  const t = setTimeout(() => el.remove(), duration > 0 ? duration : 4000);
  el.querySelector('button').onclick = () => { clearTimeout(t); el.remove(); };
}

let confirmOpts = null, promptOpts = null;
function closeConfirm(ok) {
  const m = document.getElementById('modalConfirm');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  const o = confirmOpts;
  confirmOpts = null;
  const checked = !!(document.getElementById('confirmCheck') && document.getElementById('confirmCheck').checked);
  if (!o) return;
  if (ok) { if (typeof o.onConfirm === 'function') o.onConfirm(checked); }
  else if (typeof o.onCancel === 'function') o.onCancel();
}
function showConfirm(opts) {
  const m = document.getElementById('modalConfirm');
  if (!m || m.classList.contains('open')) return;
  confirmOpts = opts || {};
  document.getElementById('confirmTitle').textContent = confirmOpts.title || 'Konfirmasi';
  document.getElementById('confirmBody').textContent = confirmOpts.body || '';
  const ok = document.getElementById('confirmOk'), cancel = document.getElementById('confirmCancel');
  ok.textContent = confirmOpts.confirmText || 'OK';
  cancel.textContent = confirmOpts.cancelText || 'Batal';
  ok.className = 'btn ' + (confirmOpts.danger ? 'danger' : 'pri');
  const cw = document.getElementById('confirmCheckWrap'), cc = document.getElementById('confirmCheck');
  if (cw && cc) {
    if (confirmOpts.checkboxLabel) {
      cw.style.display = 'flex';
      document.getElementById('confirmCheckLabel').textContent = confirmOpts.checkboxLabel;
      cc.checked = !!confirmOpts.checkboxChecked;
    } else {
      cw.style.display = 'none';
      cc.checked = false;
    }
  }
  m.classList.add('open');
  const focusEl = (confirmOpts.danger || !confirmOpts.focusPrimary) ? cancel : ok;
  setTimeout(() => { try { focusEl.focus(); } catch (_) {} }, 30);
}

function closePrompt(ok) {
  const m = document.getElementById('modalPrompt');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  const o = promptOpts;
  promptOpts = null;
  if (!o) return;
  const v = document.getElementById('promptInput').value;
  if (ok) { if (typeof o.onConfirm === 'function') o.onConfirm(v); }
  else if (typeof o.onCancel === 'function') o.onCancel();
}
function showPrompt(opts) {
  const m = document.getElementById('modalPrompt');
  if (!m || m.classList.contains('open')) return;
  promptOpts = opts || {};
  document.getElementById('promptTitle').textContent = promptOpts.title || 'Input';
  document.getElementById('promptLabel').textContent = promptOpts.label || '';
  const inp = document.getElementById('promptInput');
  inp.value = promptOpts.defaultValue || '';
  inp.placeholder = promptOpts.placeholder || '';
  m.classList.add('open');
  setTimeout(() => { try { inp.focus(); inp.select(); } catch (_) {} }, 30);
}

document.getElementById('confirmOk').onclick = () => closeConfirm(true);
document.getElementById('confirmCancel').onclick = () => closeConfirm(false);
document.getElementById('promptOk').onclick = () => closePrompt(true);
document.getElementById('promptCancel').onclick = () => closePrompt(false);
addEventListener('keydown', e => {
  const c = document.getElementById('modalConfirm');
  if (c.classList.contains('open')) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeConfirm(false); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeConfirm(true); }
    return;
  }
  const p = document.getElementById('modalPrompt');
  if (p.classList.contains('open')) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePrompt(false); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closePrompt(true); }
  }
}, true);

window.showToast = showToast;
window.showConfirm = showConfirm;
window.showPrompt = showPrompt;
// ==================== FASE 3: banner relink / restore ====================
document.getElementById('relinkPick')?.addEventListener('click', () => document.getElementById('file')?.click());
document.getElementById('relinkExport')?.addEventListener('click', () => document.getElementById('exp')?.click());
document.getElementById('relinkClose')?.addEventListener('click', () => document.getElementById('relinkBanner')?.classList.add('hide'));

document.getElementById('restoreKeep')?.addEventListener('click', () => {
  clearTimeout(window.__ppRestoreTimer);
  document.getElementById('restoreBanner')?.classList.add('hide');
});
document.getElementById('restoreNew')?.addEventListener('click', async () => {
  document.getElementById('restoreBanner')?.classList.add('hide');
  clearTimeout(window.__ppRestoreTimer);
  try { if (window.__ppClear) await window.__ppClear(); } catch (_) {}
  img = null; iw = 0; ih = 0; mapName = '';
  lines = []; texts = []; polys = []; gaps = []; cand = []; cur = []; hist = []; aiTexts = []; aiRaw = [];
  candDropped = []; lastDetR = null;
  selT = -1; aiSel = -1; dirty = false; window.__ppAutosaved = false;
  box = null; mv = null; drag = null; mouse = null; erasePick = null; addLinePick = null;
  cal.pts = []; cal.ok = false; cal.M = null;
  ['cx0','cy0','cx1','cy1','cx2','cy2','cx3','cy3'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  setCoordMode('local'); crs(); tform(); stat();
  if (typeof setStatus === 'function') setStatus('ready', 'Belum ada peta');
  if (typeof updateFileChip === 'function') updateFileChip();
  if (typeof updateDropzone === 'function') updateDropzone();
  draw();
  if (window.polyAutoSync) window.polyAutoSync();
  if (typeof aiUpdateCostUI === 'function') aiUpdateCostUI();
});

// ==================== FASE 3: coach mark ====================
const COACH_KEY = 'pp_coach_seen';
let coachSeen = [];
try { coachSeen = JSON.parse(localStorage.getItem(COACH_KEY) || '[]') || []; } catch (_) { coachSeen = []; }
const coachSessionSeen = new Set();
const coachTexts = {
  drawer: 'Mulai dari sini. Gambar batas dengan <b>Garis penuh</b>, atau biarkan AI mendeteksi otomatis dengan <b>Deteksi Cepat</b>.',
  poligon: 'Poligon bidang dibuat otomatis. Ikut diekspor di layer poligon saat Ekspor DXF.',
  export: 'Simpan proyek agar bisa dibuka lagi. <b>File ▾ → Simpan proyek</b> (Ctrl+S).'
};
let coachCurrent = null;
function showCoach(id, anchor) {
  if (!id || coachSeen.includes(id) || coachSessionSeen.has(id)) return;
  const ov = document.getElementById('coachOverlay');
  const card = document.getElementById('coachCard');
  const txt = document.getElementById('coachText');
  if (!ov || !card || !txt) return;
  coachCurrent = id;
  txt.innerHTML = coachTexts[id] || '';
  document.getElementById('coachNever').checked = false;
  ov.classList.remove('hide');
  let left = Math.max(10, (window.innerWidth - 380) / 2);
  let top = Math.max(70, (window.innerHeight - 220) / 2);
  if (anchor && anchor.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    left = r.right + 12;
    if (left + 370 > window.innerWidth) left = Math.max(10, r.left - 370);
    top = Math.min(window.innerHeight - 220, Math.max(10, r.top));
  }
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}
function closeCoach(never) {
  if (coachCurrent) {
    if (never) {
      if (!coachSeen.includes(coachCurrent)) coachSeen.push(coachCurrent);
      try { localStorage.setItem(COACH_KEY, JSON.stringify(coachSeen)); } catch (_) {}
    } else {
      coachSessionSeen.add(coachCurrent);
    }
  }
  coachCurrent = null;
  document.getElementById('coachOverlay')?.classList.add('hide');
}
document.getElementById('coachOk')?.addEventListener('click', () => closeCoach(document.getElementById('coachNever').checked));
document.getElementById('coachSkip')?.addEventListener('click', () => closeCoach(document.getElementById('coachNever').checked));
window.showCoach = showCoach;

// Trigger 1 (peta pertama) dan 2 (poligon pertama) dipanggil dari updateSidebarForTool.
let coachMapQueued = false, coachPolyQueued = false;
function maybeCoachFromState() {
  if (typeof img !== 'undefined' && img && !coachMapQueued && !coachSeen.includes('drawer') && !coachSessionSeen.has('drawer')) {
    coachMapQueued = true;
    setTimeout(() => showCoach('drawer', document.getElementById('toolDrawer')), 800);
  }
  if (typeof polys !== 'undefined' && polys.length > 0 && !coachPolyQueued && !coachSeen.includes('poligon') && !coachSessionSeen.has('poligon')) {
    coachPolyQueued = true;
    setTimeout(() => showCoach('poligon', document.querySelector('.pp-acc[data-acc="poligon"] .box-header')), 800);
  }
}