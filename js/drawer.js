// PlotPeta: Laci alat kiri dan alat favorit
/* PlotPeta tool drawer and user favorites */
(function () {
  // ==================== Layer hasil "Perbaiki AI" ====================
  // Oranye (#FF8C00): garis Deteksi Cepat yang valid.
  // Ungu   (#8A2BE2): sambungan baru yang dihasilkan modul perbaikan AI.
  // clearAndRedraw() menggambar ulang SEKALI (bukan clear bertahap) supaya
  // kanvas tidak berkedip. State lapisan juga disalin ke `cand` agar tetap
  // tampil saat peta digeser/di-zoom atau digambar ulang oleh core.js.
  const LAYER_ORANGE = '#FF8C00';
  const LAYER_PURPLE = '#8A2BE2';
  let layerState = { orangeLines: [], purpleLines: [] };

  function layerPoints(line) {
    const raw = line && (line.points || line.pts);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push([x, y]);
      if (out.length >= 500) break;
    }
    return out.length >= 2 ? out : [];
  }

  function normalizeLayer(line, color) {
    const points = layerPoints(line);
    if (!points.length) return null;
    const out = { points, color };
    if (line && line.id != null) out.id = String(line.id);
    if (line && line.from != null) out.from = String(line.from);
    if (line && line.to != null) out.to = String(line.to);
    if (line && line.k) out.k = line.k;
    return out;
  }

  function normalizeLayers(list, color) {
    if (!Array.isArray(list)) return [];
    return list.map(item => normalizeLayer(item, color)).filter(Boolean);
  }

  function layerContext() {
    const cv = typeof plotCanvas !== 'undefined' ? plotCanvas : document.getElementById('plotCanvas');
    return cv && cv.getContext ? { canvas: cv, ctx: cv.getContext('2d') } : null;
  }

  function paintLayers(ctx, state) {
    if (!ctx || !state) return;
    const project = typeof toS === 'function' ? toS : (p => p);
    const stroke = (line, color, width) => {
      const pts = line.points.map(project);
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.orangeLines.forEach(line => stroke(line, LAYER_ORANGE, 2));
    state.purpleLines.forEach(line => stroke(line, line.color || LAYER_PURPLE, 2.2));
    ctx.restore();
  }

  // Salin lapisan ke sumber data kanvas utama (dipakai draw() di core.js).
  function syncLayerState(state) {
    if (typeof cand === 'undefined') return false;
    if (typeof snapshot === 'function') snapshot();
    cand = state.orangeLines.map(line => ({
      k: line.k || 'P', pts: line.points, ai: true, aiOrange: true, refine: true,
    })).concat(state.purpleLines.map(line => ({
      k: 'P', pts: line.points, ai: true, purple: true, refine: true,
    })));
    if (typeof syncCandClean === 'function') syncCandClean();
    if (typeof candMsg === 'function') candMsg();
    return true;
  }

  // Ganti seluruh lapisan lalu gambar ulang sekali (tanpa flicker).
  function clearAndRedraw(input) {
    const src = input || {};
    layerState = {
      orangeLines: normalizeLayers(src.orangeLines, LAYER_ORANGE),
      purpleLines: normalizeLayers(src.purpleLines, LAYER_PURPLE),
    };
    if (syncLayerState(layerState) && typeof draw === 'function') {
      draw();
    } else {
      const c = layerContext();
      if (c) {
        c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
        paintLayers(c.ctx, layerState);
      }
    }
    return layerState;
  }

  // Render lapisan saja (mis. dipanggil setelah core.js menggambar ulang).
  function drawLayers(ctx) {
    const c = ctx && ctx.canvas ? { ctx } : layerContext();
    if (c) paintLayers(c.ctx, layerState);
    return layerState;
  }

  window.PlotPetaDrawer = window.PlotPetaDrawer || {};
  Object.assign(window.PlotPetaDrawer, {
    colors: { orange: LAYER_ORANGE, purple: LAYER_PURPLE },
    clearAndRedraw,
    draw: drawLayers,
    layers: () => layerState,
  });

  const main = document.getElementById('main');
  const drawer = document.getElementById('toolDrawer');
  const toggle = document.getElementById('toolDrawerToggle');
  const favToggle = document.getElementById('favoriteToggle');
  const favTools = document.getElementById('favoriteBar');
  const favCount = document.getElementById('favoriteCount');
  if (!main || !drawer) return;

  toggle?.addEventListener('click', () => {
    const collapsed = main.classList.toggle('drawer-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Buka laci alat' : 'Tutup laci alat';
    if (typeof syncMode === 'function') syncMode();
  });

  favToggle?.addEventListener('click', () => {
    const expanded = favToggle.getAttribute('aria-expanded') !== 'true';
    favToggle.setAttribute('aria-expanded', String(expanded));
    favTools?.classList.toggle('hide', !expanded);
  });

  const key = 'plotpeta-tool-favorites-v1';
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { favorites = []; }
  const tools = [...drawer.querySelectorAll('button[data-tool]')];

  // Pilihan metode deteksi/hapus di bilah (muncul saat laci dilipat, karena pilihan di laci ikut tersembunyi)
  const MODE_OPTS = { A: { label: 'Area deteksi', src: 'detectMode' }, E: { label: 'Metode hapus', src: 'eraseMode' } };
  const modeWrap = document.createElement('label');
  modeWrap.className = 'fav-mode';
  modeWrap.innerHTML = '<span></span><select></select>';
  const modeLbl = modeWrap.querySelector('span'), modeSel = modeWrap.querySelector('select');
  function syncMode() {
    const cfg = MODE_OPTS[tool];
    modeWrap.classList.toggle('visible', !!cfg);
    favTools.classList.toggle('hide', !favTools.querySelector('button') && !cfg);
    const src = cfg && document.getElementById(cfg.src);
    if (!src) return;
    modeLbl.textContent = cfg.label;
    modeSel.innerHTML = src.innerHTML;
    modeSel.value = src.value;
    modeSel.dataset.src = cfg.src;
  }
  modeSel.addEventListener('change', () => {
    const src = document.getElementById(modeSel.dataset.src);
    if (src) { src.value = modeSel.value; src.dispatchEvent(new Event('change')); }
  });
  if (typeof setTool === 'function') {
    const baseSetTool = setTool;
    setTool = function () { const r = baseSetTool.apply(this, arguments); syncMode(); return r; };
  }

  function renderFavorites() {
    if (!favTools) return;
    favTools.innerHTML = '';
    const selected = tools.filter(btn => favorites.includes(btn.dataset.tool));
    favTools.classList.toggle('hide', !selected.length);
    selected.forEach(source => {
      const shortcut = document.createElement('button');
      shortcut.type = 'button';
      shortcut.className = 'favorite-tool-shortcut';
      shortcut.dataset.tool = source.dataset.tool;
      shortcut.title = source.title || '';
      shortcut.innerHTML = source.querySelector('svg')?.outerHTML || '';
      const label = document.createElement('span');
      label.textContent = source.querySelector('span:not(.tool-fav-star)')?.textContent?.trim() || source.dataset.tool;
      shortcut.appendChild(label);
      shortcut.addEventListener('click', () => source.click());
      favTools.appendChild(shortcut);
    });
    favTools.appendChild(modeWrap);
    favTools.classList.toggle('hide', !selected.length && !MODE_OPTS[tool]);
    favTools.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    syncMode();
    if (favCount) favCount.textContent = String(selected.length);
    tools.forEach(btn => {
      const star = btn.querySelector('.tool-fav-star');
      if (!star) return;
      const active = favorites.includes(btn.dataset.tool);
      star.classList.toggle('is-favorite', active);
      star.textContent = active ? '★' : '☆';
      star.title = active ? 'Hapus dari favorit' : 'Tambah ke favorit (tampil di atas peta)';
      star.setAttribute('aria-label', star.title);
    });
  }

  drawer.addEventListener('click', event => {
    const star = event.target.closest('.tool-fav-star');
    if (!star) return;
    event.preventDefault();
    event.stopPropagation();
    const tool = star.closest('button[data-tool]')?.dataset?.tool;
    if (!tool) return;
    favorites = favorites.includes(tool) ? favorites.filter(item => item !== tool) : [...favorites, tool];
    try { localStorage.setItem(key, JSON.stringify(favorites)); } catch (_) {}
    renderFavorites();
  }, true);
  drawer.addEventListener('keydown', event => {
    const star = event.target.closest('.tool-fav-star');
    if (!star || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    star.click();
  }, true);
  renderFavorites();
  updateToolModeHint();
})();
