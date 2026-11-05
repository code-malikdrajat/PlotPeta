// PlotPeta: Perbaiki dengan AI (validasi)
// Kandidat Deteksi Cepat (oranye) dipecah per ruas dan dikirim sebagai "orange"
// ke Edge Function detect-ai mode "validate". VLM menilai tiap potong (keep/remove),
// menambah garis hanya bila ada jejak tinta, dan membaca teks hak/su ber-bbox.
// Ruas yang tetap = biru, yang salah = dihapus, tambahan AI = ungu. Ruas yang tidak
// sempat dinilai tetap oranye. Snap ke tinta dan pembentukan poligon tetap di client.
// Biaya token: dipotong SEKALI di awal (aksi "start"); bila tidak ada hasil sama
// sekali, token otomatis dikembalikan saat aksi "finish" (lihat sql/5).

const AI_TILE = 1024, AI_OVERLAP = 0.12, AI_CONC = 3, AI_SNAP_R = 6, AI_COORD = 1000, AI_MAX_TILES = 300;
const AI_MIN_INK = 0.004, AI_ORANGE_MAX = 150, AI_BRIDGE_END = 25;

var aiTexts = [];
var aiRaw = [];
// Tidak dipakai lagi di alur validasi (oranye berubah warna), tetapi tetap
// disediakan agar pembersihan overlay dari modul lain tidak error.
var aiHintOverlay = [];
let aiBusy = false, aiCancel = false;

const AI_RE_NO = /^(M|HM|HGB|HGU|HP|HPL|C)\.?\s?\d+[A-Z0-9\/\-]*$/i;
const AI_RE_SU = /^(SU|GS)\.?\s?\d+\/\d{2,4}$/i;

function aiSay(msg) {
  const a = $("dMsg");
  if (a) a.textContent = msg;
  const b = $("aiMsg");
  if (b) b.textContent = msg;
}

// Biaya satu proses Perbaiki dengan AI (settings admin: deteksi_ai x tile_per_blok).
// tokenBiaya dimuat supabase.js lewat get_biaya_token.
function aiBiayaUntuk(tileCount) {
  const tb = (typeof tokenBiaya === "object" && tokenBiaya) ? tokenBiaya : null;
  const perBlok = tb && Number(tb.tile_per_blok) >= 1 ? Number(tb.tile_per_blok) : 20;
  const raw = tb ? Number(tb.deteksi_ai) : NaN;
  const biaya = tb && tb.deteksi_ai != null && Number.isFinite(raw) ? Math.max(0, raw) : 1;
  return biaya * Math.ceil(Math.max(1, tileCount) / perBlok);
}

// Batasi area kerja ke dalam batas gambar (minimal 1x1 px).
function aiClampArea(r) {
  if (!r || !(Number(r.w) > 0) || !(Number(r.h) > 0)) return { x: 0, y: 0, w: iw, h: ih };
  const x = Math.max(0, Math.min(iw - 1, Math.round(Number(r.x) || 0)));
  const y = Math.max(0, Math.min(ih - 1, Math.round(Number(r.y) || 0)));
  const x1 = Math.max(x + 1, Math.min(iw, Math.round((Number(r.x) || 0) + Number(r.w))));
  const y1 = Math.max(y + 1, Math.min(ih, Math.round((Number(r.y) || 0) + Number(r.h))));
  return { x, y, w: x1 - x, h: y1 - y };
}

// Area refine = area Deteksi Cepat terakhir, bukan seluruh peta.
function aiRefineArea() {
  return aiClampArea(typeof lastDetR !== "undefined" ? lastDetR : null);
}

// Tampilkan bagian "Perbaiki dengan AI" hanya setelah Deteksi Cepat dijalankan.
// Saat proses berjalan, tombol utama diganti tombol Batal.
function aiUpdateRefineUI() {
  const box = $("aiRefineBox"), btn = $("aiRefine"), cancel = $("aiCancel");
  const detected = !!img && typeof lastDetR !== "undefined" && !!lastDetR;
  if (box) box.classList.toggle("hide", !detected && !aiBusy);
  if (btn) btn.classList.toggle("hide", !detected || aiBusy);
  if (cancel) cancel.classList.toggle("hide", !aiBusy);
}

// Perbarui label biaya + saldo di panel Deteksi Cepat.
function aiUpdateCostUI() {
  const box = $("aiCost");
  const btn = $("aiRefine");
  const detected = !!img && typeof lastDetR !== "undefined" && !!lastDetR;
  if (!img) {
    if (box) box.textContent = "";
    aiUpdateRefineUI();
    return;
  }
  const baseTiles = aiMakeTiles(detected ? aiRefineArea() : { x: 0, y: 0, w: iw, h: ih });
  const tileCount = detected ? baseTiles.filter(t => aiInkRatio(t) >= AI_MIN_INK).length : baseTiles.length;
  const cost = aiBiayaUntuk(tileCount);
  const perBlok = (typeof tokenBiaya === "object" && tokenBiaya && Number(tokenBiaya.tile_per_blok) >= 1)
    ? Number(tokenBiaya.tile_per_blok) : 20;
  if (box) {
    box.textContent = detected
      ? "Biaya: " + cost + " token per " + perBlok + " tile. Saldo: " + currentTokenBalance + " token."
      : "Jalankan Deteksi Cepat dulu, lalu tekan Perbaiki dengan AI.";
  }
  if (btn) btn.textContent = "Perbaiki dengan AI (" + cost + " token)";
  aiUpdateRefineUI();
}

async function aiErrorFromInvoke(error, fallback) {
  let msg = "";
  let status = 0;
  const ctx = error && error.context;
  if (ctx) {
    status = ctx.status || 0;
    if (typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j && j.message) msg = j.message;
      } catch (_) { /* abaikan */ }
    }
  }
  const e = new Error(msg || fallback);
  e.status = status;
  return e;
}

async function aiInvoke(action, body, fallbackMsg) {
  const { data, error } = await sb.functions.invoke("detect-ai", { body });
  if (error) throw await aiErrorFromInvoke(error, fallbackMsg);
  if (!data || data.ok !== true) {
    const e = new Error((data && data.message) || fallbackMsg);
    e.status = 0;
    throw e;
  }
  return data;
}

function aiPositions(start, total, size, step) {
  if (total <= size) return [start];
  const out = [];
  const last = start + total - size;
  for (let p = start; p < last; p += step) out.push(p);
  out.push(last);
  return out;
}

function aiMakeTiles(R) {
  const w = Math.max(1, Math.min(AI_TILE, Math.round(R.w)));
  const h = Math.max(1, Math.min(AI_TILE, Math.round(R.h)));
  const stepX = Math.max(1, Math.round(w * (1 - AI_OVERLAP)));
  const stepY = Math.max(1, Math.round(h * (1 - AI_OVERLAP)));
  const xs = aiPositions(Math.round(R.x), Math.round(R.w), w, stepX);
  const ys = aiPositions(Math.round(R.y), Math.round(R.h), h, stepY);
  const tiles = [];
  for (const y of ys) {
    for (const x of xs) tiles.push({ x, y, w, h });
  }
  return tiles;
}

// Perkiraan cepat rasio piksel tinta pada tile. Dipakai untuk melewati tile kosong
// supaya tidak membuang token dan waktu. Sampel diambil pada resolusi asli (stride 2)
// agar garis tipis tidak hilang karena penskalaan.
const aiInkCache = new Map();
let aiInkImg = null;
function aiInkRatio(tile) {
  if (aiInkImg !== img) { aiInkImg = img; aiInkCache.clear(); }
  const key = tile.x + "," + tile.y + "," + tile.w + "," + tile.h;
  if (aiInkCache.has(key)) return aiInkCache.get(key);
  const w = Math.max(1, Math.round(tile.w)), h = Math.max(1, Math.round(tile.h));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(img, tile.x, tile.y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const stride = 2;
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    }
  }
  const th = Math.min(240, sum / Math.max(1, n) - 8);
  let ink = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < th) ink++;
    }
  }
  const ratio = ink / Math.max(1, n);
  aiInkCache.set(key, ratio);
  return ratio;
}

// Potong satu ruas ke kotak tile (Liang-Barsky). Null bila tidak beririsan.
function aiClipSeg(ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.x0, r.x1 - ax, ay - r.y0, r.y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [[ax + dx * t0, ay + dy * t0], [ax + dx * t1, ay + dy * t1]];
}

// Jumlah ruas satu rantai (termasuk ruas penutup bila closed).
function aiSegCount(c) {
  const pts = c && c.pts;
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  return pts.length - 1 + (c.closed && pts.length > 2 ? 1 : 0);
}

function aiSegEnd(c, i) {
  const pts = c && c.pts;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  if (i >= 0 && i < pts.length - 1) return [pts[i], pts[i + 1]];
  if (i === pts.length - 1 && c.closed && pts.length > 2) {
    return [pts[pts.length - 1], pts[0]];
  }
  return null;
}

// Titik-titik ruas from..to (inklusif) sebagai satu polyline.
function aiSegSlice(c, from, to) {
  const out = [];
  for (let s = from; s <= to; s++) {
    const e = aiSegEnd(c, s);
    if (!e) continue;
    if (!out.length) out.push([e[0][0], e[0][1]]);
    const last = out[out.length - 1];
    if (Math.hypot(last[0] - e[1][0], last[1] - e[1][1]) > 1e-6) {
      out.push([e[1][0], e[1][1]]);
    }
  }
  return out;
}

function aiPolyLen(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return total;
}

// Kurangi jumlah titik ke maksimal max tanpa membuang ujung.
function aiLimitPoints(pts, max) {
  if (pts.length <= max) return pts;
  const out = [pts[0]];
  const inner = max - 2;
  for (let i = 1; i <= inner; i++) {
    const idx = Math.round((i * (pts.length - 1)) / (inner + 1));
    out.push(pts[idx]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Potongan oranye per tile: klip tiap ruas kandidat, gabung ruas berurutan yang
// benar-benar bersambung, sederhanakan dengan ppDP (eps 1 px), normalisasi 0-1000.
function aiOrangePiecesForTile(tile, source) {
  const out = [];
  if (!Array.isArray(source)) return out;
  const r = { x0: tile.x, y0: tile.y, x1: tile.x + tile.w, y1: tile.y + tile.h };
  const counters = [];

  const flush = (run) => {
    if (!run || run.pts.length < 2) return;
    const keep = ppDP(run.pts, 1);
    let pts = keep.map(i => run.pts[i]);
    pts = aiLimitPoints(pts, 40);
    const len = aiPolyLen(pts);
    if (len < 1.5) return;
    const n = counters[run.ci] || 0;
    counters[run.ci] = n + 1;
    const norm = pts.map(p => [
      Math.round(Math.max(0, Math.min(AI_COORD, ((p[0] - r.x0) / tile.w) * AI_COORD)) * 10) / 10,
      Math.round(Math.max(0, Math.min(AI_COORD, ((p[1] - r.y0) / tile.h) * AI_COORD)) * 10) / 10,
    ]);
    out.push({
      id: "c" + run.ci + "." + n,
      ci: run.ci,
      segFrom: run.segFrom,
      segTo: run.segTo,
      pts,
      len,
      norm,
    });
  };

  for (let ci = 0; ci < source.length; ci++) {
    const c = source[ci];
    const segCount = aiSegCount(c);
    if (!segCount) continue;
    let run = null;
    const closeRun = () => { flush(run); run = null; };
    for (let seg = 0; seg < segCount; seg++) {
      const ends = aiSegEnd(c, seg);
      if (!ends) { closeRun(); continue; }
      const clip = aiClipSeg(ends[0][0], ends[0][1], ends[1][0], ends[1][1], r);
      if (!clip) { closeRun(); continue; }
      const p = clip[0], q = clip[1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5) { closeRun(); continue; }
      if (run && run.segTo === seg - 1) {
        const last = run.pts[run.pts.length - 1];
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) <= 1.5) {
          run.pts.push([q[0], q[1]]);
          run.segTo = seg;
          continue;
        }
      }
      closeRun();
      run = { ci, segFrom: seg, segTo: seg, pts: [[p[0], p[1]], [q[0], q[1]]] };
    }
    closeRun();
  }

  // Maksimal 150 potong per tile: ambil yang terpanjang; sisanya tidak dinilai.
  out.sort((a, b) => b.len - a.len);
  return out.slice(0, AI_ORANGE_MAX);
}

function aiConcurrent(items, n, worker) {
  let next = 0;
  const runners = [];
  const count = Math.min(n, items.length);
  for (let k = 0; k < count; k++) {
    runners.push((async () => {
      while (true) {
        if (aiCancel) return;
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    })());
  }
  return Promise.all(runners);
}

function aiDensify(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
  }
  return out;
}

// Kerangka tinta tile (memakai ppBinarize/ppDropSmall/ppThin dari mesin-jejak.js).
function aiSkeleton(tile) {
  const b = ppBinarize(tile, 1);
  const bin = b.bin, w = b.w, h = b.h;
  ppDropSmall(bin, w, h, 10);
  ppThin(bin, w, h);
  const buckets = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      const key = ((x / AI_SNAP_R) | 0) + "," + ((y / AI_SNAP_R) | 0);
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push([x, y]);
    }
  }
  return { buckets, w, h, sx: tile.w / w, sy: tile.h / h };
}

function aiNearest(buckets, x, y, r) {
  const gx = (x / AI_SNAP_R) | 0, gy = (y / AI_SNAP_R) | 0;
  let best = null, bd = r * r;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const arr = buckets.get((gx + ox) + "," + (gy + oy));
      if (!arr) continue;
      for (const p of arr) {
        const dx = p[0] - x, dy = p[1] - y;
        const d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = p; }
      }
    }
  }
  return best;
}

// Kembalikan kelompok berurutan: {sup:boolean, pts:[[x,y],...]} dalam koordinat gambar.
function aiSnapPolyline(pts, tile, sk) {
  const dense = aiDensify(pts, 3);
  const out = [], flags = [];
  for (const p of dense) {
    const bx = (p[0] - tile.x) / sk.sx;
    const by = (p[1] - tile.y) / sk.sy;
    const hit = aiNearest(sk.buckets, bx, by, AI_SNAP_R);
    if (hit) {
      out.push([tile.x + hit[0] * sk.sx, tile.y + hit[1] * sk.sy]);
      flags.push(true);
    } else {
      out.push(p);
      flags.push(false);
    }
  }
  if (!out.length) return [];
  // Kelompokkan dulu berdasarkan dukungan tinta, baru sederhanakan tiap kelompok.
  // Bila DP dilakukan lebih dulu, bagian tengah yang tidak bertinta bisa hilang
  // pada garis lurus dan seluruh garis keliru dianggap didukung tinta.
  const groups = [];
  let start = 0;
  for (let i = 1; i <= out.length; i++) {
    if (i === out.length || flags[i] !== flags[start]) {
      if (i - start >= 2) {
        const part = out.slice(start, i);
        const keep = ppDP(part, 1.2);
        const pts = keep.map(k => part[k]);
        if (pts.length >= 2) groups.push({ sup: flags[start], pts });
      }
      start = i;
    }
  }
  return groups;
}

function aiNormText(value) {
  return String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, " ");
}

function aiUnionBox(a, b) {
  if (!a && !b) return null;
  if (!a) return b.slice();
  if (!b) return a.slice();
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

// Rapikan bbox AI ke tulisan sebenarnya: binarisasi area box + 25% (min 8 px),
// buang komponen besar/panjang (garis peta), lalu ambil kotak gabungan komponen.
// Bila tidak yakin (pusat bergeser > 30% diagonal), pakai bbox AI apa adanya.
function aiFitTextBox(box) {
  const raw = Array.isArray(box) ? box.map(Number) : null;
  if (!raw || raw.length < 4 || !raw.every(Number.isFinite)) return box;
  const bx0 = Math.min(raw[0], raw[2]), bx1 = Math.max(raw[0], raw[2]);
  const by0 = Math.min(raw[1], raw[3]), by1 = Math.max(raw[1], raw[3]);
  const aiBox = [bx0, by0, bx1, by1];
  if (!img || !(iw > 0) || !(ih > 0)) return aiBox;
  const bw = bx1 - bx0, bh = by1 - by0;
  if (!(bw > 1) || !(bh > 1)) return aiBox;

  const padX = Math.max(8, bw * 0.25), padY = Math.max(8, bh * 0.25);
  const rx = Math.max(0, Math.floor(bx0 - padX));
  const ry = Math.max(0, Math.floor(by0 - padY));
  const rx1 = Math.min(iw, Math.ceil(bx1 + padX));
  const ry1 = Math.min(ih, Math.ceil(by1 + padY));
  const rw = rx1 - rx, rh = ry1 - ry;
  if (rw < 2 || rh < 2) return aiBox;

  let binData;
  try {
    binData = ppBinarize({ x: rx, y: ry, w: rw, h: rh }, 1);
  } catch (_) {
    return aiBox;
  }
  const bin = binData.bin, w = binData.w, h = binData.h;
  if (!bin || !w || !h) return aiBox;
  const seen = new Uint8Array(w * h);
  const sx = rw / w, sy = rh / h;
  let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
  let found = 0;

  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let minx = w, maxx = -1, miny = h, maxy = -1;
    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k / w) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x > 0) { const j = k - 1; if (bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
      if (x + 1 < w) { const j = k + 1; if (bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
      if (y > 0) { const j = k - w; if (bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
      if (y + 1 < h) { const j = k + w; if (bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
    }
    const cw = (maxx - minx + 1) * sx;
    const ch = (maxy - miny + 1) * sy;
    // Garis peta yang melintasi tulisan biasanya jauh lebih panjang/tinggi.
    if (ch > bh * 1.6 || cw > bw * 1.3) continue;
    if (cw < 1 || ch < 1) continue;
    const gx0 = rx + minx * sx, gy0 = ry + miny * sy;
    const gx1 = rx + (maxx + 1) * sx, gy1 = ry + (maxy + 1) * sy;
    ux0 = Math.min(ux0, gx0);
    uy0 = Math.min(uy0, gy0);
    ux1 = Math.max(ux1, gx1);
    uy1 = Math.max(uy1, gy1);
    found++;
  }

  if (!found) return aiBox;
  const acx = (bx0 + bx1) / 2, acy = (by0 + by1) / 2;
  const tcx = (ux0 + ux1) / 2, tcy = (uy0 + uy1) / 2;
  const diag = Math.hypot(bw, bh);
  if (Math.hypot(tcx - acx, tcy - acy) > 0.3 * diag) return aiBox;
  const tw = ux1 - ux0, th = uy1 - uy0;
  if (tw < 2 || th < 2) return aiBox;
  if (tw > bw * 1.8 || th > bh * 1.8) return aiBox;
  return [
    Math.max(0, ux0),
    Math.max(0, uy0),
    Math.min(iw, ux1),
    Math.min(ih, uy1),
  ];
}

function aiBuildTexts(entries) {
  // Dedup antar tile: teks sama dan berdekatan (< 40 px gambar) dianggap satu.
  const uniq = [];
  for (const e of entries) {
    const dup = uniq.some(o => o.text === e.text && Math.hypot(o.p[0] - e.p[0], o.p[1] - e.p[1]) < 40);
    if (!dup) uniq.push(e);
  }

  const used = new Set();
  const out = [];
  uniq.forEach((e, i) => {
    if (e.kind !== "hak" || used.has(i)) return;
    const limit = 0.06 * Math.max(e.tw, e.th);
    let best = -1, bd = limit;
    uniq.forEach((o, j) => {
      if (o.kind !== "su" || used.has(j)) return;
      const d = Math.hypot(o.p[0] - e.p[0], o.p[1] - e.p[1]);
      if (d < bd) { bd = d; best = j; }
    });
    const item = { p: e.p.slice(), no: e.text, ai: true };
    if (e.box) item.box = e.box.slice();
    if (Number.isFinite(e.angle)) item.angle = e.angle;
    if (best >= 0) {
      const su = uniq[best];
      used.add(best);
      item.su = su.text;
      if (e.box && su.box) {
        const box = aiUnionBox(e.box, su.box);
        item.box = box;
        item.p = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      } else {
        item.p = [(e.p[0] + su.p[0]) / 2, (e.p[1] + su.p[1]) / 2];
      }
    }
    if (!AI_RE_NO.test(item.no)) item.fmtWarn = true;
    if (item.su && !AI_RE_SU.test(item.su)) item.fmtWarn = true;
    out.push(item);
    used.add(i);
  });
  uniq.forEach((e, i) => {
    if (e.kind !== "su" || used.has(i)) return;
    const item = { p: e.p.slice(), su: e.text, ai: true };
    if (e.box) item.box = e.box.slice();
    if (Number.isFinite(e.angle)) item.angle = e.angle;
    if (!AI_RE_SU.test(item.su)) item.fmtWarn = true;
    out.push(item);
  });
  return out;
}

function aiPointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

// True bila >= ratio sampel polyline berada <= tol dari garis mana pun di chains.
function aiMostlyDuplicate(pts, chains, tol, ratio) {
  if (!chains.length) return false;
  const samples = aiDensify(pts, 4).slice(0, 300);
  if (!samples.length) return false;
  let hit = 0;
  for (const p of samples) {
    let near = false;
    for (const c of chains) {
      const P = c && c.pts;
      if (!Array.isArray(P) || P.length < 2) continue;
      for (let i = 0; i < P.length - 1; i++) {
        if (aiPointSegDist(p, P[i], P[i + 1]) <= tol) { near = true; break; }
      }
      if (near) break;
    }
    if (near) hit++;
  }
  return hit / samples.length >= ratio;
}

function aiEndpointNear(p, chains, maxD) {
  for (const c of chains) {
    const P = c && c.pts;
    if (!Array.isArray(P) || P.length < 2 || c.closed) continue;
    if (Math.hypot(p[0] - P[0][0], p[1] - P[0][1]) <= maxD) return true;
    const e = P[P.length - 1];
    if (Math.hypot(p[0] - e[0], p[1] - e[1]) <= maxD) return true;
  }
  return false;
}

// Garis tambahan AI: snap ke tinta, lalu hanya pertahankan yang didukung tinta
// (solid) atau menjembatani dua ujung rantai yang bertahan (putus-putus).
function aiBuildPurple(rebuilt, results) {
  const bridgeChains = rebuilt.slice();
  const dupChains = rebuilt.filter(c => c.aiBlue);
  const purple = [];

  for (const r of results) {
    if (!r.add || !r.add.length) continue;
    let sk;
    try { sk = aiSkeleton(r.tile); } catch (_) { continue; }
    for (const add of r.add) {
      const pts = [];
      for (const q of (add && add.points) || []) {
        if (!Array.isArray(q) || q.length < 2) continue;
        const x = Number(q[0]), y = Number(q[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push([
          r.tile.x + x / AI_COORD * r.tile.w,
          r.tile.y + y / AI_COORD * r.tile.h,
        ]);
      }
      if (pts.length < 2) continue;
      const groups = aiSnapPolyline(pts, r.tile, sk);
      for (const g of groups) {
        if (!g.pts || g.pts.length < 2) continue;
        if (aiPolyLen(g.pts) < 12) continue;
        if (!g.sup) {
          const a = g.pts[0], b = g.pts[g.pts.length - 1];
          if (!aiEndpointNear(a, bridgeChains, AI_BRIDGE_END)) continue;
          if (!aiEndpointNear(b, bridgeChains, AI_BRIDGE_END)) continue;
        }
        if (aiMostlyDuplicate(g.pts, dupChains, 3, 0.7)) continue;
        const chain = { k: "P", pts: g.pts, ai: true, purple: true, weak: !g.sup };
        purple.push(chain);
        bridgeChains.push(chain);
        dupChains.push(chain);
      }
    }
  }

  if (purple.length) {
    purple.forEach(c => { c.free = [true, true]; });
    try {
      if (typeof plotPetaNumberEnds === "function") plotPetaNumberEnds(purple);
    } catch (_) { /* penomoran ujung tidak wajib */ }
  }
  return purple;
}

async function aiCallTile(tile, runId, pieces) {
  const cv = document.createElement("canvas");
  cv.width = tile.w;
  cv.height = tile.h;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, tile.w, tile.h);
  cx.drawImage(img, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
  const image = cv.toDataURL("image/png");
  return await aiInvoke("tile", {
    action: "tile",
    run_id: runId,
    image,
    width: tile.w,
    height: tile.h,
    mode: "validate",
    orange: (pieces || []).map(p => ({ id: p.id, points: p.norm })),
  }, "Layanan AI gagal memproses potongan peta.");
}

async function runAiRefine() {
  if (!img) { aiSay("Buka peta dulu."); return; }
  if (typeof lastDetR === "undefined" || !lastDetR) {
    aiSay("Jalankan Deteksi Cepat dulu, lalu tekan Perbaiki dengan AI.");
    return;
  }
  return runAiDetect(aiRefineArea());
}

async function runAiDetect(R) {
  if (!img) return;
  if (!currentUser) { openAuthModal("login"); return; }
  if (aiBusy) return;
  if (!Array.isArray(cand) || !cand.length) {
    aiSay("Tidak ada garis oranye untuk dinilai.");
    return;
  }
  const area = aiClampArea(R);

  const allTiles = aiMakeTiles(area);
  const tiles = allTiles.filter(t => aiInkRatio(t) >= AI_MIN_INK);
  const skipped = allTiles.length - tiles.length;
  if (!tiles.length) {
    aiSay("Tidak ada area bertinta yang bisa diperbaiki.");
    return;
  }
  if (tiles.length > AI_MAX_TILES) {
    aiSay(
      "Area terlalu besar: " + tiles.length + " potongan bertinta (maksimal " + AI_MAX_TILES +
      "). Perkecil area Deteksi Cepat, lalu jalankan ulang."
    );
    return;
  }

  // Biaya fitur + saldo; konfirmasi sebelum mengirim apa pun.
  if (typeof loadTokenBiaya === "function") {
    try { await loadTokenBiaya(); } catch (_) { /* pakai nilai yang ada */ }
  }
  const cost = aiBiayaUntuk(tiles.length);
  if (cost > currentTokenBalance) {
    aiSay(
      "Saldo token tidak cukup (perlu " + cost + " token, saldo " + currentTokenBalance +
      "). Silakan lakukan isi ulang token terlebih dahulu."
    );
    if (typeof openTopupModal === "function") openTopupModal();
    return;
  }
  const ok = confirm(
    "Perbaiki dengan AI memakai " + cost + " token (saldo " + currentTokenBalance +
    ").\n\n" +
    "Garis oranye hasil Deteksi Cepat akan DINILAI: yang benar menjadi biru, " +
    "yang jelas bukan batas bidang dihapus, dan garis yang kurang ditambahkan ungu. " +
    "Ruas yang tidak sempat dinilai tetap oranye. Lanjutkan?\n\n" +
    "Area Deteksi Cepat dipecah menjadi " + tiles.length + " potongan" +
    (skipped ? " (" + skipped + " potongan kosong dilewati)" : "") + "."
  );
  if (!ok) return;

  // Simpan kandidat Cepat agar tidak hilang bila proses gagal total.
  const prevCand = cand.slice();
  const prevTexts = aiTexts.map(t => Object.assign({}, t));
  const prevRaw = aiRaw.slice();

  // Pecah kandidat per tile menjadi potongan ruas (id, ci, segFrom, segTo).
  const plans = tiles.map(tile => ({
    tile,
    pieces: aiOrangePiecesForTile(tile, prevCand),
  }));

  // votes[ci][seg] = {keep, remove}. Tidak ada suara = belum dinilai.
  const votes = prevCand.map(c => {
    const n = aiSegCount(c);
    return n ? new Array(n).fill(null) : [];
  });

  aiHintOverlay = [];
  aiBusy = true;
  aiCancel = false;
  aiSel = -1;
  aiUpdateCostUI();

  const btnCancel = $("aiCancel");
  if (btnCancel) btnCancel.classList.remove("hide");

  let runId = null;
  let baseMsg = null;
  let refundTokens = 0;

  const results = [];
  const errors = [];
  let rateLimited = null;
  let limitHit = false;
  let ragu = 0;

  try {
    // 1. start: potong token sekali untuk seluruh proses, dapatkan run_id.
    const started = await aiInvoke("start", { action: "start", tiles: tiles.length },
      "Gagal memulai proses Perbaiki dengan AI.");
    runId = started.run_id;

    aiSay(
      "Menilai " + tiles.length + " potongan area dengan AI... (" + cost + " token)" +
      (skipped ? " " + skipped + " potongan kosong dilewati." : "")
    );

    await aiConcurrent(plans, AI_CONC, async (plan) => {
      if (aiCancel) return;
      try {
        const data = await aiCallTile(plan.tile, runId, plan.pieces);
        results.push({
          tile: plan.tile,
          pieces: plan.pieces,
          keep: Array.isArray(data.keep) ? data.keep : [],
          remove: Array.isArray(data.remove) ? data.remove : [],
          add: Array.isArray(data.add) ? data.add : [],
          texts: Array.isArray(data.texts) ? data.texts : [],
        });
      } catch (e) {
        if (e && e.status === 429) {
          rateLimited = e.message || "Batas harian Perbaiki dengan AI tercapai. Coba lagi nanti.";
          aiCancel = true;
          return;
        }
        errors.push({ tile: plan.tile, message: e && e.message ? e.message : "Gagal" });
      }
    });

    if (rateLimited) {
      baseMsg = rateLimited;
      aiSay(rateLimited);
      return;
    }

    // 2. Pemungutan suara per ruas. Satu tile yang memuat ruas = satu suara.
    for (const r of results) {
      const keepSet = new Set(r.keep);
      const removeSet = new Set(r.remove);
      const removedPieces = r.pieces.filter(p => removeSet.has(p.id) && !keepSet.has(p.id)).length;
      const ignoreRemove = r.pieces.length >= 5 && removedPieces > r.pieces.length * 0.7;
      if (ignoreRemove) ragu++;
      const voted = new Set();
      for (const p of r.pieces) {
        let status;
        if (ignoreRemove) status = "keep";
        else if (removeSet.has(p.id) && !keepSet.has(p.id)) status = "remove";
        else status = "keep";
        for (let seg = p.segFrom; seg <= p.segTo; seg++) {
          const key = p.ci + "." + seg;
          if (voted.has(key)) continue;
          voted.add(key);
          const arr = votes[p.ci];
          if (!arr || seg < 0 || seg >= arr.length) continue;
          if (!arr[seg]) arr[seg] = { keep: 0, remove: 0 };
          if (status === "remove") arr[seg].remove++;
          else arr[seg].keep++;
        }
      }
    }

    // 3. Bangun ulang kandidat: biru = dipertahankan, tanpa flag = belum dinilai.
    const rebuilt = [];
    let blueSegs = 0, removedSegs = 0, unvaluedSegs = 0;
    prevCand.forEach((c, ci) => {
      const n = aiSegCount(c);
      if (!n) { rebuilt.push(c); return; }
      const status = [];
      for (let i = 0; i < n; i++) {
        const v = votes[ci] && votes[ci][i];
        if (!v) status.push("none");
        else if (v.remove > 0 && v.keep === 0) status.push("remove");
        else status.push("keep");
      }
      const allSame = status.every(s => s === status[0]);
      if (allSame && status[0] === "none") {
        // Seluruh rantai belum dinilai: salinan asli tanpa flag warna.
        const copy = Object.assign({}, c, { pts: c.pts.map(p => p.slice()) });
        delete copy.ai;
        delete copy.aiBlue;
        delete copy.purple;
        delete copy.weak;
        rebuilt.push(copy);
        unvaluedSegs += n;
        return;
      }
      if (allSame && status[0] === "keep" && c.closed) {
        rebuilt.push({
          k: "P",
          pts: c.pts.map(p => p.slice()),
          ai: true,
          aiBlue: true,
          closed: true,
        });
        blueSegs += n;
        return;
      }
      let i = 0;
      while (i < n) {
        const st = status[i];
        let j = i;
        while (j + 1 < n && status[j + 1] === st) j++;
        if (st === "remove") {
          removedSegs += j - i + 1;
        } else if (st === "none") {
          const pts = aiSegSlice(c, i, j);
          if (pts.length >= 2) {
            rebuilt.push({ k: "P", pts, closed: false });
            unvaluedSegs += j - i + 1;
          }
        } else {
          const pts = aiSegSlice(c, i, j);
          if (pts.length >= 2) {
            rebuilt.push({
              k: "P",
              pts,
              ai: true,
              aiBlue: true,
              closed: allSame && !!c.closed,
            });
            blueSegs += j - i + 1;
          }
        }
        i = j + 1;
      }
    });

    // 4. Garis tambahan AI (ungu solid / putus-putus).
    const purple = aiBuildPurple(rebuilt, results);

    // 5. Teks hak/su dengan bbox rapat + angle.
    const textEntries = [];
    for (const r of results) {
      for (const t of r.texts) {
        if (!t || t.text == null) continue;
        if (t.kind !== "hak" && t.kind !== "su") continue;
        const text = aiNormText(t.text);
        if (!text) continue;
        let p = null, box = null;
        if (Array.isArray(t.bbox) && t.bbox.length >= 4 && t.bbox.every(v => Number.isFinite(Number(v)))) {
          const b = t.bbox.map(Number);
          box = [
            r.tile.x + Math.min(b[0], b[2]) / AI_COORD * r.tile.w,
            r.tile.y + Math.min(b[1], b[3]) / AI_COORD * r.tile.h,
            r.tile.x + Math.max(b[0], b[2]) / AI_COORD * r.tile.w,
            r.tile.y + Math.max(b[1], b[3]) / AI_COORD * r.tile.h,
          ];
          box = aiFitTextBox(box);
          p = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        } else if (Array.isArray(t.position) && t.position.length >= 2) {
          const px = Number(t.position[0]), py = Number(t.position[1]);
          if (Number.isFinite(px) && Number.isFinite(py)) {
            p = [
              r.tile.x + px / AI_COORD * r.tile.w,
              r.tile.y + py / AI_COORD * r.tile.h,
            ];
          }
        }
        if (!p) continue;
        let angle = Number(t.angle);
        if (!Number.isFinite(angle)) angle = 0;
        angle = Math.max(-90, Math.min(90, angle));
        if (Math.abs(angle) < 4) angle = 0;
        textEntries.push({
          text,
          kind: t.kind,
          p,
          box,
          angle,
          tw: r.tile.w,
          th: r.tile.h,
        });
      }
    }

    // 6. Timpa kandidat setelah semua hasil siap; Undo satu langkah.
    if (results.length) snapshot();
    cand = rebuilt.concat(purple);
    aiTexts = aiBuildTexts(textEntries);
    aiHintOverlay = [];

    const warn = aiTexts.filter(t => t.fmtWarn).length;
    const okTiles = results.length;
    const failTiles = errors.length;
    if (!okTiles) {
      baseMsg = failTiles
        ? "Perbaikan AI gagal: " + (errors[0].message || "coba lagi.")
        : "Perbaikan AI tidak menghasilkan potongan yang berhasil.";
      aiSay(baseMsg);
    } else {
      let msg =
        "Perbaikan AI: " + blueSegs + " biru, " + removedSegs + " dihapus, " +
        purple.length + " ungu (" + purple.filter(c => c.weak).length + " perlu dicek), " +
        unvaluedSegs + " belum dinilai, " + aiTexts.length + " teks (" + warn +
        " perlu dicek). Tile berhasil " + okTiles + "/" + tiles.length + ".";
      if (ragu) msg += " " + ragu + " potongan ragu dipertahankan.";
      if (aiCancel) msg += " Dibatalkan.";
      baseMsg = msg;
      aiSay(msg);
    }
    stat();
    draw();
  } catch (e) {
    if (!rateLimited) {
      const serverMsg = e && e.message ? e.message : "";
      baseMsg = serverMsg || "Perbaikan AI gagal: coba lagi.";
      if (e && e.status === 429) limitHit = true;
      aiSay(baseMsg);
    }
  } finally {
    // 4. finish: tutup proses di server (token dikembalikan bila tanpa hasil),
    //    termasuk saat dibatalkan atau gagal di tengah jalan.
    if (runId && sb) {
      try {
        const f = await aiInvoke("finish", { action: "finish", run_id: runId }, "Proses ditutup.");
        if (f && f.refunded) refundTokens = Number(f.tokens_charged) || 0;
      } catch (_) { /* finish gagal: saldo tetap disegarkan di bawah */ }
      if (typeof fetchUserTokens === "function") {
        try { await fetchUserTokens(); } catch (_) { /* abaikan */ }
      }
    }
    if (!results.length) {
      cand = prevCand;
      aiTexts = prevTexts;
      aiRaw = prevRaw;
      aiHintOverlay = [];
      if (prevCand.length && !limitHit && !rateLimited) {
        baseMsg = (baseMsg ? baseMsg + " " : "") + "Kandidat Deteksi Cepat dipertahankan.";
      }
      if (baseMsg) aiSay(baseMsg);
    }
    if (refundTokens > 0) {
      aiSay((baseMsg ? baseMsg + " " : "") + refundTokens + " token dikembalikan.");
    }
    aiBusy = false;
    aiUpdateCostUI();
    if (typeof syncCandClean === "function") syncCandClean();
    if (btnCancel) btnCancel.classList.add("hide");
    stat();
    draw();
  }
}

$("aiRefine").onclick = () => {
  runAiRefine();
};

$("aiCancel").onclick = () => {
  if (!aiBusy) return;
  aiCancel = true;
  aiSay("Membatalkan Perbaiki dengan AI...");
};

$("aiClear").onclick = () => {
  const has = lines.some(l => l.ai) || texts.some(t => t.ai);
  if (!has) { aiSay("Tidak ada hasil AI yang perlu ditandai."); return; }
  snapshot();
  lines.forEach(l => { delete l.ai; delete l.weak; });
  texts.forEach(t => { delete t.ai; delete t.fmtWarn; });
  aiHintOverlay = [];
  stat();
  draw();
  aiSay("Hasil AI sudah ditandai diperiksa.");
};
