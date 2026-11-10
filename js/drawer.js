// PlotPeta: Laci alat kiri dan alat favorit
/* PlotPeta tool drawer and user favorites */
(function () {
  // ==================== Layer hasil "Perbaiki AI" (skema 3 warna) ====================
  // Oranye (#FF8C00): kandidat Deteksi Cepat sebelum diperbaiki.
  // Biru   (#1E90FF): garis oranye yang divalidasi BENAR oleh AI.
  // Ungu   (#8A2BE2): sambungan baru yang dibuat AI untuk menutup celah.
  // renderMultiLayer() menggambar ulang SEKALI (clearRect lalu draw() core.js)
  // supaya kanvas tidak berkedip. State lapisan juga disalin ke `cand` agar
  // tetap tampil saat peta digeser/di-zoom atau digambar ulang oleh core.js.
  const LAYER_ORANGE = '#FF8C00';
  const LAYER_BLUE = '#1E90FF';
  const LAYER_PURPLE = '#8A2BE2';
  const LAYER_WIDTH = { orange: 2, blue: 2.5, purple: 3 };
  let layerState = { orangeLines: [], blueLines: [], purpleLines: [] };

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

  // Helper satu garis: bersih, tidak mengubah fungsi gambar yang sudah ada.
  // `points` memakai koordinat gambar (diproyeksikan lewat toS bila tersedia).
  function drawSingleLine(ctx, points, color, width) {
    if (!ctx || typeof ctx.beginPath !== 'function' || !Array.isArray(points)) return false;
    const project = typeof toS === 'function' ? toS : (p => p);
    const pts = [];
    for (const p of points) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const s = project([Number(p[0]), Number(p[1])]);
      if (!Array.isArray(s) || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) continue;
      pts.push(s);
    }
    if (pts.length < 2) return false;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = color || LAYER_ORANGE;
    ctx.lineWidth = Number(width) > 0 ? Number(width) : LAYER_WIDTH.orange;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    return true;
  }

  function paintLayers(ctx, state) {
    if (!ctx || !state) return;
    state.orangeLines.forEach(line => drawSingleLine(ctx, line.points, LAYER_ORANGE, LAYER_WIDTH.orange));
    state.blueLines.forEach(line => drawSingleLine(ctx, line.points, LAYER_BLUE, LAYER_WIDTH.blue));
    state.purpleLines.forEach(line => drawSingleLine(ctx, line.points, line.color || LAYER_PURPLE, LAYER_WIDTH.purple));
  }

  // ==================== Penyelarasan teks & simbol OCR ====================
  // Koordinat OCR berasal dari piksel gambar asli, sedangkan kanvas menampilkan
  // gambar yang diskalakan. Rasio berikut memetakan piksel gambar -> kanvas.
  // (canvas.width memakai devicePixelRatio, jadi dibagi dpr agar hasilnya
  // berada di ruang koordinat logis yang dipakai ctx.)
  function imageScale(canvas, image) {
    const cv = canvas || (typeof plotCanvas !== 'undefined' ? plotCanvas : document.getElementById('plotCanvas'));
    const im = image || (typeof img !== 'undefined' ? img : null);
    const iw = Number(im && (im.naturalWidth || im.width)) || 0;
    const ih = Number(im && (im.naturalHeight || im.height)) || 0;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (!cv || !iw || !ih) return { scaleX: 1, scaleY: 1, canvasWidth: 0, canvasHeight: 0, imageWidth: iw, imageHeight: ih };
    const cw = Number(cv.clientWidth) || cv.width / dpr;
    const ch = Number(cv.clientHeight) || cv.height / dpr;
    return {
      scaleX: cw / iw,
      scaleY: ch / ih,
      canvasWidth: cw,
      canvasHeight: ch,
      imageWidth: iw,
      imageHeight: ih,
    };
  }

  // Titik OCR -> koordinat kanvas. toS() sudah memuat skala gambar + pan/zoom,
  // jadi dipakai lebih dulu; bila tidak ada, pakai rasio skala langsung.
  function ocrAnchor(rawX, rawY, canvas, image) {
    const x = Number(rawX), y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (typeof toS === 'function') {
      const s = toS([x, y]);
      if (Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1])) return s;
    }
    const sc = imageScale(canvas, image);
    return [x * sc.scaleX, y * sc.scaleY];
  }

  // Label OCR selalu ber-anchor tengah (horizontal & vertikal) supaya titik
  // koordinat tepat berada di atas tulisan tangan, bukan bergeser ke kanan/bawah.
  function drawOcrLabel(ctx, text, x, y, opts) {
    const label = String(text == null ? '' : text).trim();
    if (!ctx || typeof ctx.fillText !== 'function' || !label) return false;
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
    const o = opts || {};
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = o.font || 'bold 12px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.lineWidth = Number(o.strokeWidth) > 0 ? Number(o.strokeWidth) : 3;
    ctx.strokeStyle = o.strokeStyle || '#fff';
    ctx.fillStyle = o.color || '#111';
    let tx = Number(x), ty = Number(y);
    const angle = Number(o.angle) || 0;
    if (angle) {
      ctx.translate(tx, ty);
      ctx.rotate(angle * Math.PI / 180);
      tx = 0;
      ty = 0;
    }
    if (o.background) {
      const fs = Number((/([0-9.]+)px/.exec(ctx.font) || [])[1]) || 12;
      const tw = ctx.measureText(label).width;
      const padX = 3, padY = fs * 0.18;
      ctx.fillStyle = o.background;
      ctx.fillRect(tx - tw / 2 - padX, ty - fs / 2 - padY, tw + padX * 2, fs + padY * 2);
    }
    ctx.strokeText(label, tx, ty);
    ctx.fillText(label, tx, ty);
    ctx.restore();
    return true;
  }

  // Ikon kecil (belah ketupat/segitiga) di titik anchor OCR.
  function drawOcrSymbol(ctx, x, y, opts) {
    if (!ctx || typeof ctx.beginPath !== 'function') return false;
    const px = Number(x), py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    const o = opts || {};
    const kind = o.kind === 'triangle' ? 'triangle' : 'diamond';
    const r = Number(o.size) > 0 ? Number(o.size) : 4;
    ctx.save();
    ctx.beginPath();
    if (kind === 'triangle') {
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py + r);
      ctx.lineTo(px - r, py + r);
      ctx.closePath();
    } else {
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py);
      ctx.lineTo(px, py + r);
      ctx.lineTo(px - r, py);
      ctx.closePath();
    }
    if (o.outline) {
      ctx.strokeStyle = o.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = o.color || '#a855f7';
    ctx.fill();
    ctx.restore();
    return true;
  }

  // Salin lapisan ke sumber data kanvas utama (dipakai draw() di core.js).
  function syncLayerState(state) {
    if (typeof cand === 'undefined') return false;
    if (typeof snapshot === 'function') snapshot();
    const entry = (line, flags) => Object.assign({
      k: line.k || 'P', pts: line.points, ai: true, refine: true,
    }, line.id != null ? { id: line.id } : {}, flags);
    cand = state.orangeLines.map(line => entry(line, { aiOrange: true }))
      .concat(state.blueLines.map(line => entry(line, { aiBlue: true })))
      .concat(state.purpleLines.map(line => entry(line, { purple: true })));
    if (typeof syncCandClean === 'function') syncCandClean();
    if (typeof candMsg === 'function') candMsg();
    return true;
  }

  // Ganti seluruh lapisan lalu gambar ulang sekali (tanpa flicker).
  function renderMultiLayer(input) {
    const src = input || {};
    layerState = {
      orangeLines: normalizeLayers(src.orangeLines, LAYER_ORANGE),
      blueLines: normalizeLayers(src.blueLines, LAYER_BLUE),
      purpleLines: normalizeLayers(src.purpleLines, LAYER_PURPLE),
    };
    const c = layerContext();
    if (c) c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if (syncLayerState(layerState) && typeof draw === 'function') {
      draw();
    } else if (c) {
      paintLayers(c.ctx, layerState);
    }
    return layerState;
  }

  // Kompatibilitas dengan pemanggil lama.
  function clearAndRedraw(input) {
    const src = input || {};
    return renderMultiLayer({
      orangeLines: src.orangeLines,
      blueLines: src.blueLines,
      purpleLines: src.purpleLines,
    });
  }

  // Render lapisan saja (mis. dipanggil setelah core.js menggambar ulang).
  function drawLayers(ctx) {
    const c = ctx && ctx.canvas ? { ctx } : layerContext();
    if (c) paintLayers(c.ctx, layerState);
    return layerState;
  }

  window.PlotPetaDrawer = window.PlotPetaDrawer || {};
  Object.assign(window.PlotPetaDrawer, {
    colors: { orange: LAYER_ORANGE, blue: LAYER_BLUE, purple: LAYER_PURPLE },
    widths: LAYER_WIDTH,
    renderMultiLayer,
    clearAndRedraw,
    drawSingleLine,
    imageScale,
    ocrAnchor,
    drawOcrLabel,
    drawOcrSymbol,
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

  // Mode "Atur favorit": bintang selalu tampil di layar sentuh / mobile.
  const favModeBtn = document.getElementById('btnFavMode');
  let favMode = false;
  if (favModeBtn) {
    favModeBtn.addEventListener('click', () => {
      favMode = !favMode;
      drawer.classList.toggle('favorit-mode', favMode);
      favModeBtn.classList.toggle('active', favMode);
      favModeBtn.textContent = favMode ? '✓' : '☆';
      favModeBtn.title = favMode ? 'Selesai atur favorit' : 'Atur favorit';
    });
  }

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
      const star = btn.parentElement?.querySelector('.tool-fav-star');
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
    const tool = star.parentElement.querySelector('button[data-tool]')?.dataset?.tool;
    if (!tool) return;
    favorites = favorites.includes(tool) ? favorites.filter(item => item !== tool) : [...favorites, tool];
    try { localStorage.setItem(key, JSON.stringify(favorites)); } catch (_) {}
    renderFavorites();
  });
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
