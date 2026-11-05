/* ============================================================================
 * ALAT UJI SEMENTARA: "Isi Bidang" (tool F)
 *
 * Tujuan: membuktikan bahwa poligon satu bidang bisa dibentuk dari SATU klik
 * di dalam bidang (klik = pengganti titik teks nomor hak). Nol token, tanpa AI,
 * tanpa Supabase, tanpa polygonize().
 *
 * Hasil uji hanya hidup di array `fillPolys` (memori) dan TIDAK pernah ditulis
 * ke polys/lines/texts/cand/aiTexts/hist/snapshot, simpan proyek, atau DXF.
 *
 * CARA MENGHAPUS ALAT INI SEPENUHNYA:
 *   1. Hapus file js/isi-bidang.js.
 *   2. Hapus 2 baris kait di js/core.js:
 *        - di click(): if(tool==='F'){ ... isiBidangClick(p,sp,ev); return }
 *        - di draw():  if(typeof isiBidangDraw==='function') isiBidangDraw(ctx);
 *   3. Hapus <script src="js/isi-bidang.js?v=1"></script> di index.html.
 *   4. Muat ulang halaman. Tidak ada data proyek yang perlu dibersihkan.
 * ========================================================================== */

var fillPolys = [];
var fillOpts = { ink: true, lines: false, gap: 2, min: 40, eps: 1.5, showWall: false, rings: false };
var fillLastMask = null;
var fillInkCache = null;
var fillWallCache = null;
var fillPanel = null, fillListEl = null, fillDirtyList = true;
var fillBusy = false;

function fillSay(msg) {
  var el = document.getElementById('dMsg');
  if (el) el.textContent = msg;
}

function fillNum(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fillClamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Persegi kerja berpusat di p, sisi `side` px, dijepit ke batas gambar.
function fillMakeRect(p, side) {
  var w = Math.min(iw, side);
  var h = Math.min(ih, side);
  var x = p[0] - w / 2;
  var y = p[1] - h / 2;
  x = Math.max(0, Math.min(iw - w, x));
  y = Math.max(0, Math.min(ih - h, y));
  return { x: x, y: y, w: w, h: h };
}

// Perbesar jendela x1.6 (maks 3200 px). Null bila tidak bisa membesar lagi.
function fillGrowRect(rect, p) {
  var cur = Math.max(rect.w, rect.h);
  var next = Math.min(3200, Math.max(cur * 1.6, cur + 1));
  if (next <= cur + 0.5) return null;
  var r = fillMakeRect(p, next);
  if (r.w === rect.w && r.h === rect.h) return null;
  return r;
}

function fillGetInk(rect, sc) {
  var key = rect.x + '|' + rect.y + '|' + rect.w + '|' + rect.h + '|' + sc;
  if (fillInkCache && fillInkCache.img === img && fillInkCache.key === key) return fillInkCache;
  var b = ppBinarize(rect, sc);
  fillInkCache = {
    img: img,
    key: key,
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    sc: sc,
    bin: b.bin,
    w: b.w,
    h: b.h,
  };
  return fillInkCache;
}

// Rasterkan lines + cand (tebal 3 px) ke mask dinding.
function fillRasterLines(dst, w, h, rect, sx, sy) {
  var cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  var g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff';
  // Mask berada di resolusi jendela, jadi tebal 3 px dihitung di ruang jendela.
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  var drawPts = function (pts) {
    if (!Array.isArray(pts) || pts.length < 2) return;
    g.beginPath();
    var started = false;
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      if (!q || q.length < 2) continue;
      var x = (Number(q[0]) - rect.x) * sx;
      var y = (Number(q[1]) - rect.y) * sy;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (started) g.lineTo(x, y);
      else { g.moveTo(x, y); started = true; }
    }
    if (started) g.stroke();
  };
  if (typeof lines !== 'undefined' && lines) lines.forEach(function (l) { drawPts(l && l.pts); });
  if (typeof cand !== 'undefined' && cand) cand.forEach(function (l) { drawPts(l && l.pts); });
  var data = g.getImageData(0, 0, w, h).data;
  for (var k = 0; k < w * h; k++) {
    if (data[k * 4] > 32) dst[k] = 1;
  }
}

function fillBuildWall(rect, sc) {
  // Cache hanya saat mode garis OFF: isi lines/cand bisa berubah tanpa mengubah
  // rect/sc, jadi mask gabungan tidak aman di-cache. Bin tinta mentah tetap
  // di-cache terpisah oleh fillGetInk().
  var key = rect.x + '|' + rect.y + '|' + rect.w + '|' + rect.h + '|' + sc +
    '|' + (fillOpts.ink ? 1 : 0) + '|' + fillOpts.min;
  if (!fillOpts.lines && fillWallCache && fillWallCache.img === img && fillWallCache.key === key) {
    return fillWallCache.out;
  }
  var out;
  if (fillOpts.ink) {
    var ink = fillGetInk(rect, sc);
    var w = ink.w, h = ink.h;
    var wall = new Uint8Array(w * h);
    wall.set(ink.bin);
    var minSide = fillOpts.min * (w / rect.w);
    if (minSide > 0) ppDropSmall(wall, w, h, minSide);
    if (fillOpts.lines) fillRasterLines(wall, w, h, rect, w / rect.w, h / rect.h);
    out = { wall: wall, w: w, h: h };
  } else {
    // Hanya garis terdeteksi: jangan jalankan ppDropSmall pada mask garis.
    var lw = Math.max(32, Math.round(rect.w * sc));
    var lh = Math.max(32, Math.round(rect.h * sc));
    var lwall = new Uint8Array(lw * lh);
    fillRasterLines(lwall, lw, lh, rect, lw / rect.w, lh / rect.h);
    out = { wall: lwall, w: lw, h: lh };
  }
  if (!fillOpts.lines) fillWallCache = { img: img, key: key, out: out };
  return out;
}

// Distance transform chamfer dua lintasan (jarak ke piksel mask terdekat).
function fillDT(d, w, h) {
  var INF = 1e9, x, y, i, v, row;
  for (y = 0; y < h; y++) {
    row = y * w;
    for (x = 0; x < w; x++) {
      i = row + x;
      v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) {
        if (d[i - w] + 1 < v) v = d[i - w] + 1;
        if (x > 0 && d[i - w - 1] + 1.41421356 < v) v = d[i - w - 1] + 1.41421356;
        if (x + 1 < w && d[i - w + 1] + 1.41421356 < v) v = d[i - w + 1] + 1.41421356;
      }
      d[i] = v;
    }
  }
  for (y = h - 1; y >= 0; y--) {
    row = y * w;
    for (x = w - 1; x >= 0; x--) {
      i = row + x;
      v = d[i];
      if (v === 0) continue;
      if (x + 1 < w && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y + 1 < h) {
        if (d[i + w] + 1 < v) v = d[i + w] + 1;
        if (x > 0 && d[i + w - 1] + 1.41421356 < v) v = d[i + w - 1] + 1.41421356;
        if (x + 1 < w && d[i + w + 1] + 1.41421356 < v) v = d[i + w + 1] + 1.41421356;
      }
      d[i] = v;
    }
  }
  return d;
}

function fillDistance(mask, w, h) {
  var N = w * h, d = new Float32Array(N), i;
  for (i = 0; i < N; i++) d[i] = mask[i] ? 0 : 1e9;
  return fillDT(d, w, h);
}

// Isi 4-arah dari seed pada piksel bukan dinding.
function fillFlood(wall, w, h, seed) {
  var N = w * h;
  var q = new Int32Array(N);
  var seen = new Uint8Array(N);
  var qh = 0, qt = 0;
  q[qt++] = seed;
  seen[seed] = 1;
  var touches = false, count = 0;
  while (qh < qt) {
    var i = q[qh++];
    count++;
    var x = i % w, y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
    if (x > 0) {
      var j = i - 1;
      if (!wall[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; }
    }
    if (x + 1 < w) {
      j = i + 1;
      if (!wall[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; }
    }
    if (y > 0) {
      j = i - w;
      if (!wall[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; }
    }
    if (y + 1 < h) {
      j = i + w;
      if (!wall[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; }
    }
  }
  return { fill: seen, count: count, touches: touches };
}

// Kembalikan isian ke tepi dinding asli (kompensasi dilasi), tanpa menembus dinding.
function fillExpand(fill, wallRaw, w, h, r, dist) {
  var N = w * h, i;
  for (i = 0; i < N; i++) dist[i] = fill[i] ? 0 : 1e9;
  fillDT(dist, w, h);
  var out = new Uint8Array(N);
  for (i = 0; i < N; i++) out[i] = (dist[i] <= r + 1e-6 && !wallRaw[i]) ? 1 : 0;
  return out;
}

// Telusuri kontur luar komponen (Moore-neighbor). Lubang diabaikan.
function fillTrace(mask, w, h) {
  var sx = -1, sy = -1, x, y;
  for (y = 0; y < h && sy < 0; y++) {
    for (x = 0; x < w; x++) {
      if (mask[y * w + x]) { sx = x; sy = y; break; }
    }
  }
  if (sx < 0) return [];
  var dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var ring = [];
  var cx = sx, cy = sy, bx = sx - 1, by = sy;
  var maxSteps = w * h * 8 + 1000;
  for (var step = 0; step < maxSteps; step++) {
    ring.push([cx, cy]);
    var bi = -1, k;
    for (k = 0; k < 8; k++) {
      if (cx + dirs[k][0] === bx && cy + dirs[k][1] === by) { bi = k; break; }
    }
    if (bi < 0) bi = 4;
    var moved = false;
    for (k = 1; k <= 8; k++) {
      var di = (bi + k) & 7;
      var nx = cx + dirs[di][0], ny = cy + dirs[di][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!mask[ny * w + nx]) continue;
      var pd = (di + 7) & 7;
      bx = cx + dirs[pd][0];
      by = cy + dirs[pd][1];
      cx = nx;
      cy = ny;
      moved = true;
      break;
    }
    if (!moved) break;
    if (cx === sx && cy === sy) break;
  }
  return ring;
}

function fillDP(pts, eps) {
  if (pts.length < 3) return pts.slice();
  return ppDP(pts, eps).map(function (i) { return pts[i]; });
}

// Sederhanakan cincin tertutup: potong di dua titik terjauh, DP tiap busur.
function fillSimplifyClosed(ring, eps) {
  var n = ring.length;
  if (n < 4) return ring.slice();
  var i, i1 = 0, i2 = 0, best = -1;
  for (i = 0; i < n; i++) {
    var dx = ring[i][0] - ring[0][0];
    var dy = ring[i][1] - ring[0][1];
    var d = dx * dx + dy * dy;
    if (d > best) { best = d; i1 = i; }
  }
  best = -1;
  for (i = 0; i < n; i++) {
    dx = ring[i][0] - ring[i1][0];
    dy = ring[i][1] - ring[i1][1];
    d = dx * dx + dy * dy;
    if (d > best) { best = d; i2 = i; }
  }
  if (i2 === i1) i2 = (i1 + Math.floor(n / 2)) % n;

  var a = [], b = [], guard = 0;
  i = i1;
  while (true) {
    a.push(ring[i]);
    if (i === i2) break;
    i = (i + 1) % n;
    if (++guard > n + 1) break;
  }
  guard = 0;
  i = i2;
  while (true) {
    b.push(ring[i]);
    if (i === i1) break;
    i = (i + 1) % n;
    if (++guard > n + 1) break;
  }
  var sa = fillDP(a, eps);
  var sb = fillDP(b, eps);
  var out = sa.slice(0, sa.length - 1).concat(sb.slice(0, sb.length - 1));
  return out.length >= 3 ? out : ring.slice();
}

function fillRingArea(ring) {
  var a = 0, n = ring.length;
  for (var i = 0; i < n; i++) {
    var p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function fillHullArea(ring) {
  if (ring.length < 3) return 0;
  var pts = ring.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var cross = function (o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  };
  var lower = [], upper = [], i;
  for (i = 0; i < pts.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
    lower.push(pts[i]);
  }
  for (i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  lower.pop();
  upper.pop();
  var hull = lower.concat(upper);
  return hull.length < 3 ? 0 : fillRingArea(hull);
}

// Sampel titik tiap step px sepanjang sisi cincin.
function fillSamples(ring, step) {
  var out = [], n = ring.length;
  if (n < 2) return ring.map(function (p) { return p.slice(); });
  for (var i = 0; i < n; i++) {
    var a = ring[i], b = ring[(i + 1) % n];
    var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var k = Math.max(1, Math.ceil(len / step));
    for (var j = 0; j < k; j++) {
      var t = j / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function fillGapBetween(a, b) {
  var A = a._samples || [], B = b._samples || [];
  var best = Infinity;
  for (var i = 0; i < A.length; i++) {
    for (var j = 0; j < B.length; j++) {
      var dx = A[i][0] - B[j][0], dy = A[i][1] - B[j][1];
      var d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return best === Infinity ? null : Math.sqrt(best);
}

function fillRecomputeGaps() {
  var i, j;
  for (i = 0; i < fillPolys.length; i++) {
    var p = fillPolys[i];
    p._samples = p.leak ? [] : fillSamples(p.ring, 3);
    p.gapToNeighbor = null;
  }
  for (i = 0; i < fillPolys.length; i++) {
    if (fillPolys[i].leak) continue;
    for (j = i + 1; j < fillPolys.length; j++) {
      if (fillPolys[j].leak) continue;
      var d = fillGapBetween(fillPolys[i], fillPolys[j]);
      if (d == null) continue;
      if (fillPolys[i].gapToNeighbor == null || d < fillPolys[i].gapToNeighbor) fillPolys[i].gapToNeighbor = d;
      if (fillPolys[j].gapToNeighbor == null || d < fillPolys[j].gapToNeighbor) fillPolys[j].gapToNeighbor = d;
    }
  }
  fillDirtyList = true;
}

function fillNow() {
  return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
}

// Simpan hasil satu klik + klasifikasi.
function fillFinish(seedImg, ring, rect, sc, melebar, touchesMax, mask, t0) {
  var area = fillRingArea(ring);
  var hullArea = fillHullArea(ring);
  var solidity = hullArea > 1e-9 ? area / hullArea : 1;
  var leak = !!(touchesMax || area > 0.35 * iw * ih);
  var warn = !leak && (solidity < 0.35 || area < 400);
  var status = leak ? 'BOCOR' : warn ? 'PERIKSA' : 'OK';
  var durasiMs = Math.max(0, Math.round(fillNow() - t0));

  var poly = {
    ring: ring,
    seed: [seedImg[0], seedImg[1]],
    area: area,
    pts: ring.length,
    solidity: solidity,
    leak: leak,
    warn: warn,
    gapToNeighbor: null,
    status: status,
    durasiMs: durasiMs,
    jendela: [rect.x, rect.y, rect.w, rect.h],
    sc: sc,
    melebar: !!melebar,
  };
  fillPolys.push(poly);
  fillLastMask = mask || null;
  fillRecomputeGaps();

  var n = fillPolys.length;
  var gap = poly.gapToNeighbor == null ? '—' : Math.round(poly.gapToNeighbor) + ' px';
  var msg = '#' + n + ' ' + status + ': luas ' + Math.round(area) + ' px², ' + ring.length +
    ' titik, solidity ' + solidity.toFixed(2) + ', jarak ' + gap + ', ' + durasiMs + ' ms.';
  if (leak) {
    msg += ' Isian menyentuh tepi jendela maksimum atau terlalu luas; cincin merah tidak dihitung sebagai poligon.';
  } else if (warn) {
    msg += ' Perlu diperiksa (solidity < 0.35 atau luas < 400 px²).';
  }
  fillSay(msg);
  return poly;
}

function fillRunClick(p, t0) {
  var side = 1400;
  var rect = fillMakeRect(p, side);
  var melebar = false;
  var attempts = 0;

  while (attempts++ < 6) {
    var sc = Math.min(1, Math.sqrt(4e6 / (rect.w * rect.h)));
    var built = fillBuildWall(rect, sc);
    var w = built.w, h = built.h, wall = built.wall;
    var sx = w / rect.w, sy = h / rect.h;
    var i;

    var wallCount = 0;
    for (i = 0; i < wall.length; i++) {
      if (wall[i]) { wallCount = 1; break; }
    }

    // Tidak ada dinding sama sekali: pasti bocor. Hindari BFS di area kosong.
    if (!wallCount) {
      var border = [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h],
        [rect.x, rect.y + rect.h],
      ];
      return fillFinish(p, border, rect, sc, melebar, true, null, t0);
    }

    var r = fillOpts.gap * Math.min(sx, sy);
    var dist = fillDistance(wall, w, h);
    var wallD = new Uint8Array(w * h);
    for (i = 0; i < wallD.length; i++) wallD[i] = dist[i] <= r + 1e-6 ? 1 : 0;

    var si = Math.round((p[0] - rect.x) * sx);
    var sj = Math.round((p[1] - rect.y) * sy);
    si = fillClamp(si, 0, w - 1);
    sj = fillClamp(sj, 0, h - 1);
    var seed = sj * w + si;

    // Seed jatuh di dinding -> cari piksel kosong terdekat (<= 6 px gambar).
    if (wallD[seed]) {
      var rad = Math.max(1, Math.round(6 * Math.min(sx, sy)));
      var best = -1, bd = Infinity;
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          var nx = si + dx, ny = sj + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (wallD[ni]) continue;
          var dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = ni; }
        }
      }
      if (best < 0) {
        fillSay('Titik jatuh di garis, geser sedikit.');
        return null;
      }
      seed = best;
    }

    var flood = fillFlood(wallD, w, h, seed);

    if (flood.touches) {
      var next = fillGrowRect(rect, p);
      if (next) {
        rect = next;
        melebar = true;
        continue;
      }
    }

    var fillMask = fillExpand(flood.fill, wall, w, h, r, dist);
    var ringPx = fillTrace(fillMask, w, h);
    if (ringPx.length < 3) {
      fillSay('Isian kosong; coba klik di tengah bidang.');
      return null;
    }
    var eps = Math.max(0.2, fillOpts.eps * Math.min(sx, sy));
    var simp = fillSimplifyClosed(ringPx, eps);
    var ring = simp.map(function (q) {
      return [rect.x + q[0] / sx, rect.y + q[1] / sy];
    });

    return fillFinish(
      p, ring, rect, sc, melebar, !!flood.touches,
      { wallD: wallD, w: w, h: h, rect: rect, sx: sx, sy: sy },
      t0
    );
  }
  fillSay('Isi Bidang gagal: jendela kerja tidak stabil. Coba klik ulang.');
  return null;
}

// Titik masuk dari core.js click().
function isiBidangClick(p, sp, ev) {
  if (!img || !iw || !ih) {
    fillSay('Buka gambar peta dulu.');
    return;
  }
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
      p[0] < 0 || p[1] < 0 || p[0] >= iw || p[1] >= ih) {
    fillSay('Klik di dalam gambar peta.');
    return;
  }
  if (fillBusy) return;

  // Shift+klik menghapus poligon uji yang ada, bukan membuat yang baru.
  if (ev && ev.shiftKey) {
    var idx = -1;
    for (var i = fillPolys.length - 1; i >= 0; i--) {
      if (typeof pointInPolygon === 'function' && pointInPolygon(p, fillPolys[i].ring)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      fillSay('Shift+klik: tidak ada poligon uji di titik itu.');
      return;
    }
    fillPolys.splice(idx, 1);
    fillRecomputeGaps();
    fillSay('Poligon uji #' + (idx + 1) + ' dihapus. Sisa ' + fillPolys.length + '.');
    draw();
    return;
  }

  if (!fillOpts.ink && !fillOpts.lines) {
    fillSay('Aktifkan minimal satu sumber dinding: tinta peta atau garis terdeteksi.');
    return;
  }

  fillBusy = true;
  var t0 = fillNow();
  try {
    var poly = fillRunClick(p, t0);
    if (poly) draw();
  } catch (err) {
    fillSay('Isi Bidang gagal: ' + (err && err.message ? err.message : 'kesalahan tidak dikenal'));
  } finally {
    fillBusy = false;
  }
}

// ============================ UI panel ============================

function fillRenderList() {
  fillDirtyList = false;
  if (!fillListEl) return;
  if (!fillPolys.length) {
    fillListEl.innerHTML = '<span style="color:var(--text-muted)">Belum ada hasil. Klik di dalam bidang pada peta.</span>';
    return;
  }
  var rows = [];
  for (var i = 0; i < fillPolys.length; i++) {
    var p = fillPolys[i];
    var color = p.status === 'OK' ? '#10b981' : p.status === 'BOCOR' ? '#ef4444' : '#d97706';
    var gap = p.gapToNeighbor == null ? '—' : Math.round(p.gapToNeighbor) + 'px';
    rows.push(
      '<div style="color:' + color + '">#' + (i + 1) +
      '&nbsp; luas ' + Math.round(p.area) + 'px²' +
      '&nbsp; titik ' + p.pts +
      '&nbsp; solidity ' + p.solidity.toFixed(2) +
      '&nbsp; jarak ' + gap +
      '&nbsp; ' + p.status +
      ' <span style="color:var(--text-muted)">' + p.durasiMs + ' ms</span></div>'
    );
  }
  fillListEl.innerHTML = rows.join('');
}

function fillSyncPanel() {
  if (!fillPanel) return;
  var show = (typeof tool !== 'undefined' && tool === 'F');
  // Pakai kelas, bukan inline display, agar aturan CSS (laci diciutkan /
  // layar kecil) tetap bisa menyembunyikan panel.
  fillPanel.classList.toggle('mode-visible', show);
  if (show && fillDirtyList) fillRenderList();
}

function fillRemoveLast() {
  if (!fillPolys.length) {
    fillSay('Belum ada poligon uji.');
    return;
  }
  var n = fillPolys.length;
  fillPolys.pop();
  fillRecomputeGaps();
  fillSay('Poligon uji #' + n + ' dihapus. Sisa ' + fillPolys.length + '.');
  draw();
}

function fillClear() {
  if (!fillPolys.length) {
    fillSay('Belum ada poligon uji.');
    return;
  }
  fillPolys.length = 0;
  fillLastMask = null;
  fillRecomputeGaps();
  fillSay('Semua hasil uji dihapus.');
  draw();
}

function fillCopyFallback(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function fillCopy() {
  var payload = {
    opsi: {
      dindingTinta: !!fillOpts.ink,
      dindingGarisTerdeteksi: !!fillOpts.lines,
      tutupCelahPx: fillOpts.gap,
      abaikanCoretanPx: fillOpts.min,
      simplifikasiPx: fillOpts.eps,
      sertakanCincin: !!fillOpts.rings,
    },
    hasil: fillPolys.map(function (p, i) {
      var o = {
        n: i + 1,
        status: p.status,
        area: Math.round(p.area),
        pts: p.pts,
        solidity: Math.round(p.solidity * 1000) / 1000,
        gapToNeighbor: p.gapToNeighbor == null ? null : Math.round(p.gapToNeighbor * 10) / 10,
        durasiMs: p.durasiMs,
        jendela: p.jendela.map(function (v) { return Math.round(v * 10) / 10; }),
        sc: Math.round(p.sc * 1000) / 1000,
        melebar: !!p.melebar,
      };
      if (fillOpts.rings) o.ring = p.ring;
      return o;
    }),
  };
  var text = JSON.stringify(payload, null, 2);
  var done = function (ok) {
    if (ok) fillSay('Hasil uji disalin (' + fillPolys.length + ' bidang).');
    else {
      fillSay('Gagal menyalin otomatis; JSON hasil uji dicetak ke console.');
      try { console.log(text); } catch (_) {}
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function () { done(true); },
      function () { done(fillCopyFallback(text)); }
    );
  } else {
    done(fillCopyFallback(text));
  }
}

function fillInitUI() {
  if (document.getElementById('isiBidangBtn')) return;
  var list = document.querySelector('.tool-drawer-list');
  var btnA = document.querySelector('button[data-tool="A"]');
  if (!list) return;

  var btn = document.createElement('button');
  btn.id = 'isiBidangBtn';
  btn.type = 'button';
  btn.dataset.tool = 'F';
  btn.title = 'Uji: bentuk poligon bidang dari satu klik di dalam bidang (tanpa AI, tanpa token)';
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6l7-3 9 4-2 12-9 2-5-6z"></path><circle cx="12" cy="12" r="1.6" fill="currentColor"></circle></svg>' +
    '<span>Isi Bidang (uji)</span>';
  btn.onclick = function () { setTool('F'); };
  // Sebelum Deteksi Cepat supaya tombol itu tetap menempel pada panel opsinya.
  if (btnA && btnA.parentNode === list) btnA.insertAdjacentElement('beforebegin', btn);
  else list.appendChild(btn);

  var panel = document.createElement('div');
  panel.id = 'isiBidangPanel';
  panel.className = 'tool-mode-options';
  panel.style.margin = '0 0 6px 0';
  panel.innerHTML =
    '<div style="font-weight:700;color:var(--text-main);font-size:11px">Isi Bidang (uji sementara)</div>' +
    '<label style="flex-direction:row;align-items:center;gap:6px"><input id="fillInk" type="checkbox" checked style="width:auto"><span>Dinding: tinta peta</span></label>' +
    '<label style="flex-direction:row;align-items:center;gap:6px"><input id="fillLines" type="checkbox" style="width:auto"><span>Dinding: garis terdeteksi (lines + cand)</span></label>' +
    '<label><span>Tutup celah (px): <b id="fillGapVal">2</b></span><input id="fillGap" type="range" min="0" max="6" step="1" value="2" style="width:100%"></label>' +
    '<label><span>Abaikan coretan lebih kecil dari (px): <b id="fillMinVal">40</b></span><input id="fillMin" type="range" min="10" max="120" step="1" value="40" style="width:100%"></label>' +
    '<label><span>Simplifikasi (px): <b id="fillEpsVal">1.5</b></span><input id="fillEps" type="range" min="0.5" max="4" step="0.1" value="1.5" style="width:100%"></label>' +
    '<label style="flex-direction:row;align-items:center;gap:6px"><input id="fillShowWall" type="checkbox" style="width:auto"><span>Lihat dinding (overlay merah transparan)</span></label>' +
    '<div style="display:flex;gap:4px">' +
    '<button type="button" id="fillUndoBtn" style="flex:1;font-size:10px;padding:5px 3px">Hapus terakhir</button>' +
    '<button type="button" id="fillClearBtn" style="flex:1;font-size:10px;padding:5px 3px">Hapus semua</button>' +
    '<button type="button" id="fillCopyBtn" style="flex:1;font-size:10px;padding:5px 3px">Salin hasil uji</button>' +
    '</div>' +
    '<label style="flex-direction:row;align-items:center;gap:6px"><input id="fillRings" type="checkbox" style="width:auto"><span>sertakan cincin pada JSON</span></label>' +
    '<div id="fillList" style="max-height:170px;overflow:auto;font-size:10.5px;line-height:1.45;border-top:1px solid var(--border);padding-top:6px">' +
    '<span style="color:var(--text-muted)">Belum ada hasil. Klik di dalam bidang pada peta.</span></div>';
  btn.insertAdjacentElement('afterend', panel);

  fillPanel = panel;
  fillListEl = document.getElementById('fillList');

  var ink = document.getElementById('fillInk');
  var linesEl = document.getElementById('fillLines');
  var gap = document.getElementById('fillGap');
  var min = document.getElementById('fillMin');
  var eps = document.getElementById('fillEps');
  var wall = document.getElementById('fillShowWall');
  var rings = document.getElementById('fillRings');

  if (ink) ink.onchange = function () { fillOpts.ink = !!ink.checked; draw(); };
  if (linesEl) linesEl.onchange = function () { fillOpts.lines = !!linesEl.checked; draw(); };
  if (gap) gap.oninput = function () {
    fillOpts.gap = fillNum(gap.value);
    var v = document.getElementById('fillGapVal');
    if (v) v.textContent = String(fillOpts.gap);
  };
  if (min) min.oninput = function () {
    fillOpts.min = fillNum(min.value);
    var v = document.getElementById('fillMinVal');
    if (v) v.textContent = String(fillOpts.min);
  };
  if (eps) eps.oninput = function () {
    fillOpts.eps = fillNum(eps.value);
    var v = document.getElementById('fillEpsVal');
    if (v) v.textContent = fillOpts.eps.toFixed(1);
  };
  if (wall) wall.onchange = function () { fillOpts.showWall = !!wall.checked; draw(); };
  if (rings) rings.onchange = function () { fillOpts.rings = !!rings.checked; };

  var undo = document.getElementById('fillUndoBtn');
  var clear = document.getElementById('fillClearBtn');
  var copy = document.getElementById('fillCopyBtn');
  if (undo) undo.onclick = fillRemoveLast;
  if (clear) clear.onclick = fillClear;
  if (copy) copy.onclick = fillCopy;

  fillRenderList();
}

// ============================ Penggambaran ============================

function fillDrawMask(ctx, m) {
  if (!m || !m.wallD) return;
  if (!m._canvas) {
    var cv = document.createElement('canvas');
    cv.width = m.w;
    cv.height = m.h;
    var g = cv.getContext('2d');
    if (!g) return;
    var id = g.createImageData(m.w, m.h);
    var data = id.data;
    for (var i = 0; i < m.w * m.h; i++) {
      if (m.wallD[i]) {
        data[i * 4] = 239;
        data[i * 4 + 1] = 68;
        data[i * 4 + 2] = 68;
        data[i * 4 + 3] = 95;
      }
    }
    g.putImageData(id, 0, 0);
    m._canvas = cv;
  }
  var x0 = m.rect.x * V.s + V.x;
  var y0 = m.rect.y * V.s + V.y;
  var wpx = (m.w / m.sx) * V.s;
  var hpx = (m.h / m.sy) * V.s;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(m._canvas, x0, y0, wpx, hpx);
  ctx.restore();
}

// Titik masuk dari core.js draw().
function isiBidangDraw(ctx) {
  fillSyncPanel();
  if (!ctx) return;

  if (fillOpts.showWall && fillLastMask) fillDrawMask(ctx, fillLastMask);

  for (var i = 0; i < fillPolys.length; i++) {
    var p = fillPolys[i];
    if (!p.ring || p.ring.length < 2) continue;
    var color = p.status === 'OK' ? '#10b981' : p.status === 'BOCOR' ? '#ef4444' : '#f59e0b';
    ctx.save();
    ctx.beginPath();
    for (var k = 0; k < p.ring.length; k++) {
      var s = toS(p.ring[k]);
      if (k) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    }
    ctx.closePath();
    if (p.status === 'BOCOR') {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = p.status === 'OK' ? 'rgba(16,185,129,.22)' : 'rgba(245,158,11,.22)';
      ctx.fill();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    var sd = toS(p.seed);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sd[0], sd[1] - 6);
    ctx.lineTo(sd[0] + 6, sd[1]);
    ctx.lineTo(sd[0], sd[1] + 6);
    ctx.lineTo(sd[0] - 6, sd[1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.font = 'bold 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeText('#' + (i + 1), sd[0] + 8, sd[1] - 2);
    ctx.fillStyle = color;
    ctx.fillText('#' + (i + 1), sd[0] + 8, sd[1] - 2);
    ctx.restore();
  }
}

fillInitUI();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fillInitUI, { once: true });
}
