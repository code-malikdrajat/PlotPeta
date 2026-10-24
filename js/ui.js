// PlotPeta: Kontrol UI: slider, drag-drop, zoom, kunci peta, header, tema
// ==================== LIVE SLIDERS & CONTROLS ====================
const sliderPairs = [
  ['dT', 'val_dT', ''],
  ['dL', 'val_dL', ' px'],
  ['dG', 'val_dG', ' px'],
  ['linkMax', 'val_linkMax', ' px'],
  ['magR', 'val_magR', ' px']
];
sliderPairs.forEach(([sliderId, labelId, suffix]) => {
  const s = $(sliderId), l = $(labelId);
  if(s && l){
    s.addEventListener('input', () => { l.textContent = s.value + suffix; });
  }
});


// Slider manual hanya tampil saat "Parameter otomatis" dimatikan.
function syncManualSliders(){
  const auto=$('autoParamToggle')?.checked ?? true;
  $('manualBasicSliders')?.classList.toggle('hide',auto);
  $('manualMagnetSliders')?.classList.toggle('hide',auto);
}
$('autoParamToggle')?.addEventListener('change',syncManualSliders);
syncManualSliders();

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
  $('st').innerHTML='<span class="status-dot"></span><span>'+(mapLocked?'Peta dikunci: geser dinonaktifkan; zoom tetap aktif.':'Kunci peta dibuka: geser aktif kembali.')+'</span>';
});
updateMapLockUI();

// Group the account tools at the right side of the header, before the login/account button.
(function arrangeHeaderTools(){
  const bar = document.getElementById('bar');
  if (!bar || document.getElementById('headerRightTools')) return;
  const tools = document.createElement('div');
  tools.id = 'headerRightTools';
  tools.setAttribute('aria-label', 'Kontrol akun dan proyek');
  bar.appendChild(tools);
  ['tokenPill','btnCloudProjects','exp','themeToggle'].forEach(id => {
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
