// PlotPeta: Baca Teks (AI) — hanya membaca teks hak/su pada area peta.
// Tidak ada modifikasi geometri: `lines` dan `cand` tidak pernah diubah.
// Pipeline tile/token/run/refund tetap dipakai (Supabase Edge Function detect-ai).
//
// Biaya token dihitung dari jumlah tile area (deteksi_ai x tile_per_blok) dan
// dipotong di server saat aksi `start`, dikembalikan saat `finish` bila kosong.
const AI_TILE = 1024, AI_OVERLAP = 0.12, AI_CONC = 3, AI_COORD = 1000, AI_MAX_TILES = 300;
const AI_MIN_INK = 0.004, AI_TILE_EDGE = 0.015, AI_DEDUP_PX = 40;

var aiTexts = [];
let aiBusy = false, aiCancel = false;
const AI_RE_NO = /^(M|HM|HGB|HGU|HP|HPL|C)\.?\s?\d+[A-Z0-9\/\-]*$/i;
const AI_RE_SU = /^(SU|S\.?U)\.?\s?\d+([\/\-]\d+)*$/i;

function aiSay(msg) {
  const a = $("dMsg");
  if (a) a.textContent = msg;
  const b = $("aiTextMsg");
  if (b) b.textContent = msg;
  if (typeof setStatus === "function") {
    const m = String(msg == null ? "" : msg);
    const kind = /gagal|error|tidak|bocor|ditolak/i.test(m) ? "error"
      : /memproses|membaca|mengunggah|menunggu/i.test(m) ? "busy" : "info";
    setStatus(kind, m);
  }
}

// Biaya untuk membaca teks AI (settings admin: deteksi_ai x tile_per_blok).
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

// Area baca = kotak Deteksi Cepat terakhir bila ada, bila tidak seluruh gambar.
function aiRefineArea() {
  return aiClampArea(typeof lastDetR !== "undefined" && lastDetR ? lastDetR : null);
}

function aiSetBalance(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return;
  try { currentTokenBalance = v; } catch (_) { /* abaikan di luar aplikasi */ }
  const el = typeof $ === "function" ? $("tokenCount") : null;
  if (el) el.textContent = String(v);
  if (typeof aiUpdateCostUI === "function") aiUpdateCostUI();
}

// Perbarui kotak Baca Teks (AI) di panel Teks Bidang: area, tile, biaya, saldo.
function aiUpdateCostUI() {
  const box = $("aiTextBox"), btn = $("aiTextRun"), cost = $("aiTextCost");
  if (box) box.classList.toggle("hide", !img);
  if (!img) {
    if (cost) cost.textContent = "";
    if (btn) { btn.disabled = true; btn.textContent = "Baca Teks (AI)"; }
    aiUpdateTextUI();
    return;
  }
  const area = aiRefineArea();
  let tiles = [];
  try { tiles = aiMakeTiles(area).filter(t => aiInkRatio(t) >= AI_MIN_INK); } catch (_) { tiles = []; }
  const costN = aiBiayaUntuk(tiles.length);
  const perBlok = (typeof tokenBiaya === "object" && tokenBiaya && Number(tokenBiaya.tile_per_blok) >= 1)
    ? Number(tokenBiaya.tile_per_blok) : 20;
  const where = (typeof lastDetR !== "undefined" && lastDetR) ? "kotak Deteksi Cepat terakhir" : "seluruh gambar";
  const saldo = typeof currentTokenBalance === "number" ? currentTokenBalance : "?";
  if (cost) {
    cost.textContent = "Area: " + where + ". " + tiles.length + " tile berisi tinta. Biaya: " +
      costN + " token per " + perBlok + " tile. Saldo: " + saldo + " token.";
  }
  if (btn) {
    btn.disabled = aiBusy || !tiles.length;
    btn.textContent = "Baca Teks (AI) (" + costN + " token)";
  }
  aiUpdateTextUI();
}

function aiUpdateTextUI() {
  const box = $("aiTextBox"), btn = $("aiTextRun"), cancel = $("aiTextCancel");
  if (box) box.classList.toggle("hide", !img);
  if (btn) btn.classList.toggle("hide", aiBusy);
  if (cancel) cancel.classList.toggle("hide", !aiBusy);
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

async function aiInvoke(action, body, fallbackMsg, retries = 2) {
  // `start` memotong token dan tidak punya dedup di server, jadi retry bisa
  // membuat token terpotong dobel. Aksi lain (tile/finish) aman diulang.
  if (action === "start") retries = 0;
  const payload = Object.assign({ action }, body || {});
  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await sb.functions.invoke("detect-ai", { body: payload });
    if (!error && data && data.ok === true) {
      if (attempt > 1) console.info("[AI] detect-ai recovered on attempt " + attempt);
      return data;
    }

    let status = 0;
    let retryable = false;
    if (error) {
      const ctx = error.context;
      status = (ctx && ctx.status) || 0;
      const msg = String(error.message || "").toLowerCase();
      const isNetwork = !status && (
        error.name === "FunctionsFetchError" ||
        /failed to fetch|failed to send a request|network|timeout|load failed/.test(msg)
      );
      // Hanya 5xx gateway sementara + kegagalan jaringan yang layak diulang.
      retryable = status === 502 || status === 503 || status === 504 || isNetwork;
    }

    if (!retryable) {
      if (error) throw await aiErrorFromInvoke(error, fallbackMsg);
      const e = new Error((data && data.message) || fallbackMsg);
      e.status = 0;
      throw e;
    }

    const label = status || "network";
    if (attempt >= maxAttempts) {
      console.warn("[AI] detect-ai " + label + " attempt " + attempt + "/" + maxAttempts + " — giving up");
      throw await aiErrorFromInvoke(error, fallbackMsg);
    }
    const delay = 1000 * Math.pow(2, attempt - 1);
    console.warn("[AI] detect-ai " + label + " attempt " + attempt + "/" + maxAttempts + " — retry in " + delay + "ms");
    await new Promise(resolve => setTimeout(resolve, delay));
  }
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

// Potong tile menjadi data URL PNG untuk dikirim ke server.
function aiTileImage(tile) {
  const w = Math.max(1, Math.round(tile.w)), h = Math.max(1, Math.round(tile.h));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(img, tile.x, tile.y, w, h, 0, 0, w, h);
  return { image: cv.toDataURL("image/png"), w, h };
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

// ===================== pasangan hak/su per bidang (murni) =====================

function aiPointInRing(x, y, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i], b = ring[j];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const xi = Number(a[0]), yi = Number(a[1]), xj = Number(b[0]), yj = Number(b[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function aiPointSegDist(p, a, b) {
  const ax = Number(a[0]), ay = Number(a[1]), bx = Number(b[0]), by = Number(b[1]);
  if (![ax, ay, bx, by].every(Number.isFinite)) return Infinity;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(p[0] - ax, p[1] - ay);
  let t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t));
}

function aiBoxOf(e) {
  if (!e) return null;
  const b = e.box;
  if (Array.isArray(b) && b.length >= 4) {
    const n = b.slice(0, 4).map(Number);
    if (n.every(Number.isFinite)) {
      return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
    }
  }
  const p = aiCenterOf(e);
  return p ? [p[0], p[1], p[0], p[1]] : null;
}

function aiCenterOf(e) {
  if (!e) return null;
  if (Array.isArray(e.p) && e.p.length >= 2) {
    const x = Number(e.p[0]), y = Number(e.p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  }
  const b = e.box;
  if (Array.isArray(b) && b.length >= 4) {
    const n = b.slice(0, 4).map(Number);
    if (n.every(Number.isFinite)) {
      return [(Math.min(n[0], n[2]) + Math.max(n[0], n[2])) / 2, (Math.min(n[1], n[3]) + Math.max(n[1], n[3])) / 2];
    }
  }
  return null;
}

function aiBoxW(e) {
  const b = aiBoxOf(e);
  return b ? Math.max(1, b[2] - b[0]) : 1;
}
function aiBoxH(e) {
  const b = aiBoxOf(e);
  return b ? Math.max(1, b[3] - b[1]) : 1;
}

function aiSamplePoints(box) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  return [
    [(x0 + x1) / 2, (y0 + y1) / 2],
    [x0 + w * 0.25, y0 + h * 0.25],
    [x1 - w * 0.25, y0 + h * 0.25],
    [x0 + w * 0.25, y1 - h * 0.25],
    [x1 - w * 0.25, y1 - h * 0.25],
  ];
}

// Pemilik = cincin yang memuat titik uji terbanyak; bila nol, cincin terdekat
// (jarak ke sisi) diterima bila <= 2x tinggi box (luarBidang).
function aiOwnerOf(e, rings) {
  const box = aiBoxOf(e);
  if (!box) return null;
  const samples = aiSamplePoints(box);
  let best = -1, bestN = 0;
  rings.forEach((ring, ri) => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    let n = 0;
    for (const s of samples) if (aiPointInRing(s[0], s[1], ring)) n++;
    if (n > bestN) { bestN = n; best = ri; }
  });
  if (best >= 0 && bestN > 0) return { ring: best, luar: false };
  const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  let nr = -1, nd = Infinity;
  rings.forEach((ring, ri) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      d = Math.min(d, aiPointSegDist(c, a, b));
    }
    if (d < nd) { nd = d; nr = ri; }
  });
  if (nr >= 0) {
    const h = Math.max(1, box[3] - box[1]);
    if (nd <= 2 * h) return { ring: nr, luar: true };
  }
  return null;
}

function aiAngleOf(e) {
  const a = Number(e && e.angle);
  if (!Number.isFinite(a)) return 0;
  return Math.abs(a) < 4 ? 0 : a;
}

function aiSingleItem(e, luar) {
  const box = aiBoxOf(e), p = aiCenterOf(e);
  const item = { p: p ? p.slice() : [0, 0], ai: true };
  if (e.kind === "hak") item.no = e.text; else item.su = e.text;
  if (box) item.box = box.slice();
  item.angle = aiAngleOf(e);
  if (luar) item.luarBidang = true;
  if (e.kind === "hak") {
    if (!AI_RE_NO.test(e.text)) item.fmtWarn = true;
  } else if (!AI_RE_SU.test(e.text)) {
    item.fmtWarn = true;
  }
  return item;
}

function aiPairItem(hak, su, luar, banyakHak) {
  const hb = aiBoxOf(hak), sb = su ? aiBoxOf(su) : null;
  const box = hb && sb ? aiUnionBox(hb, sb) : (hb || sb || null);
  const p = box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : aiCenterOf(hak);
  const item = { p: p ? p.slice() : [0, 0], no: hak.text, ai: true };
  if (su) item.su = su.text;
  if (box) item.box = box.slice();
  item.angle = aiAngleOf(hak);
  if (luar) item.luarBidang = true;
  if (banyakHak) item.banyakHak = true;
  if (!AI_RE_NO.test(item.no)) item.fmtWarn = true;
  if (item.su && !AI_RE_SU.test(item.su)) item.fmtWarn = true;
  return item;
}

// Pasangan berbasis jarak (dipakai bila tidak ada cincin bidang sama sekali).
function aiBuildTexts(entries) {
  const uniq = [];
  for (const e of entries) {
    const c = aiCenterOf(e);
    if (!c) continue;
    const dup = uniq.some(o => {
      const oc = aiCenterOf(o);
      return oc && o.text === e.text && Math.hypot(oc[0] - c[0], oc[1] - c[1]) < AI_DEDUP_PX;
    });
    if (!dup) uniq.push(e);
  }
  const used = new Set(), out = [];
  uniq.forEach((e, i) => {
    if (e.kind !== "hak" || used.has(i)) return;
    const ec = aiCenterOf(e);
    let best = -1, bd = Infinity;
    uniq.forEach((o, j) => {
      if (o.kind !== "su" || used.has(j)) return;
      const oc = aiCenterOf(o);
      if (!oc || !ec) return;
      const d = Math.hypot(oc[0] - ec[0], oc[1] - ec[1]);
      const limit = Math.max(AI_DEDUP_PX, 1.5 * Math.max(aiBoxW(e), aiBoxH(e), aiBoxW(o), aiBoxH(o)));
      if (d <= limit && d < bd) { bd = d; best = j; }
    });
    if (best >= 0) { used.add(best); out.push(aiPairItem(e, uniq[best], false, false)); }
    else out.push(aiSingleItem(e, false));
    used.add(i);
  });
  uniq.forEach((e, i) => {
    if (e.kind === "su" && !used.has(i)) out.push(aiSingleItem(e, false));
  });
  return out;
}

// Fungsi murni: kelompokkan teks per bidang lalu bentuk pasangan hak/su.
// Mengembalikan { items, stats } dengan stats:
// {texts, pairs, fields, noNumber, multiHak, outside}.
function aiAssignTexts(textEntries, rings) {
  const entries = (Array.isArray(textEntries) ? textEntries : [])
    .filter(e => e && typeof e.text === "string" && e.text.trim() && (e.kind === "hak" || e.kind === "su"));
  const rs = (Array.isArray(rings) ? rings : []).filter(r => Array.isArray(r) && r.length >= 3);

  if (!rs.length) {
    const items = aiBuildTexts(entries);
    const stats = {
      texts: entries.length,
      pairs: items.filter(it => it.no && it.su).length,
      fields: 0,
      noNumber: items.filter(it => !it.no && it.su).length,
      multiHak: 0,
      outside: 0,
    };
    return { items, stats };
  }

  const owners = entries.map(e => aiOwnerOf(e, rs));
  const groups = new Map();
  entries.forEach((e, i) => {
    const o = owners[i];
    if (!o) return;
    if (!groups.has(o.ring)) groups.set(o.ring, { hak: [], su: [] });
    groups.get(o.ring)[e.kind].push({ e, luar: o.luar });
  });

  const items = [];
  let pairs = 0, multiHak = 0, noNumber = 0, fields = 0;
  groups.forEach(g => {
    fields++;
    const haks = g.hak.slice();
    const sus = g.su.slice();
    if (!haks.length) {
      for (const s of sus) { items.push(aiSingleItem(s.e, s.luar)); noNumber++; }
      return;
    }
    if (haks.length > 1) multiHak++;
    const hakItems = haks.map(h => ({ h, su: null }));
    for (const s of sus) {
      let bi = -1, bd = Infinity;
      const sc = aiCenterOf(s.e);
      hakItems.forEach((h, idx) => {
        if (h.su || !sc) return;
        const hc = aiCenterOf(h.h.e);
        if (!hc) return;
        const d = Math.hypot(hc[0] - sc[0], hc[1] - sc[1]);
        if (d < bd) { bd = d; bi = idx; }
      });
      if (bi >= 0) hakItems[bi].su = s;
      else { items.push(aiSingleItem(s.e, s.luar)); noNumber++; }
    }
    for (const h of hakItems) {
      items.push(aiPairItem(h.h.e, h.su ? h.su.e : null, h.h.luar || !!(h.su && h.su.luar), haks.length > 1));
      if (h.su) pairs++;
    }
  });

  entries.forEach((e, i) => {
    if (owners[i]) return;
    items.push(aiSingleItem(e, false));
    if (e.kind === "su") noNumber++;
  });

  const outside = owners.filter(o => o && o.luar).length;
  return { items, stats: { texts: entries.length, pairs, fields, noNumber, multiHak, outside } };
}

// ============================ pipeline tile ============================

// Ubah satu entri teks tile (koordinat 0-1000 relatif tile) menjadi koordinat
// gambar; buang bbox yang menyentuh tepi tile kecuali tepi area baca/gambar.
function aiTextFromTile(tile, rec, area) {
  if (!rec || typeof rec !== "object") return null;
  const text = typeof rec.text === "string" ? rec.text.trim() : "";
  if (!text) return null;
  const kind = rec.kind === "hak" ? "hak" : rec.kind === "su" ? "su" : "other";
  let box = null;
  if (Array.isArray(rec.bbox) && rec.bbox.length >= 4) {
    const b = rec.bbox.slice(0, 4).map(Number);
    if (b.every(Number.isFinite)) {
      const x0 = tile.x + Math.min(b[0], b[2]) / AI_COORD * tile.w;
      const x1 = tile.x + Math.max(b[0], b[2]) / AI_COORD * tile.w;
      const y0 = tile.y + Math.min(b[1], b[3]) / AI_COORD * tile.h;
      const y1 = tile.y + Math.max(b[1], b[3]) / AI_COORD * tile.h;
      const near = (a, c) => Math.abs(a - c) <= 0.5;
      const mx = tile.w * AI_TILE_EDGE, my = tile.h * AI_TILE_EDGE;
      const okL = near(tile.x, area.x) || tile.x <= 0.5;
      const okRt = near(tile.x + tile.w, area.x + area.w) || tile.x + tile.w >= iw - 0.5;
      const okT = near(tile.y, area.y) || tile.y <= 0.5;
      const okB = near(tile.y + tile.h, area.y + area.h) || tile.y + tile.h >= ih - 0.5;
      if ((x0 - tile.x < mx && !okL) || (tile.x + tile.w - x1 < mx && !okRt) ||
          (y0 - tile.y < my && !okT) || (tile.y + tile.h - y1 < my && !okB)) {
        return null;
      }
      if (x1 - x0 >= 1 && y1 - y0 >= 1) box = [x0, y0, x1, y1];
    }
  }
  let p = null;
  if (Array.isArray(rec.position) && rec.position.length >= 2) {
    const px = Number(rec.position[0]), py = Number(rec.position[1]);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      p = [tile.x + px / AI_COORD * tile.w, tile.y + py / AI_COORD * tile.h];
    }
  }
  if (box) {
    box = aiFitTextBox(box);
    p = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  }
  if (!p) return null;
  let angle = 0;
  const rawAngle = Number(rec.angle);
  if (Number.isFinite(rawAngle)) angle = Math.abs(rawAngle) < 4 ? 0 : rawAngle;
  const confidence = Number(rec.confidence);
  return {
    text, kind, p, box, angle, confidence: Number.isFinite(confidence) ? confidence : undefined,
  };
}

function aiDedupTexts(list) {
  const out = [];
  for (const e of list) {
    const dup = out.some(o => o.text === e.text && Math.hypot(o.p[0] - e.p[0], o.p[1] - e.p[1]) < AI_DEDUP_PX);
    if (!dup) out.push(e);
  }
  return out;
}

function aiRingsForAssign() {
  try {
    if (typeof polys !== "undefined" && Array.isArray(polys) && polys.length) return polys;
    if (typeof polygonize === "function" && typeof lines !== "undefined") {
      const src = lines.concat(typeof cand !== "undefined" && Array.isArray(cand) ? cand : []);
      const r = polygonize(src);
      return (r && Array.isArray(r.polys)) ? r.polys : [];
    }
  } catch (_) { /* abaikan */ }
  return [];
}

// Gabungkan hasil sebelumnya (prev) dan hasil proses terbaru; duplikat (teks
// sama, jarak < AI_DEDUP_PX) dibuang dengan prioritas prev. Fungsi murni tanpa
// DOM supaya bisa diuji dari Node.
function aiMergeTexts(prev, got) {
  return aiDedupTexts((Array.isArray(prev) ? prev : []).concat(Array.isArray(got) ? got : []));
}

// Baca teks pada area (kotak Deteksi Cepat terakhir atau seluruh gambar).
// Hasil masuk `aiTexts` sebagai review ungu; `lines`/`cand` tidak diubah.
async function runAiText() {
  if (!img) { aiSay("Buka peta dulu."); return; }
  if (aiBusy) return;
  if (typeof sb === "undefined" || !sb || typeof currentUser === "undefined" || !currentUser) {
    aiSay("Masuk dulu untuk memakai Baca Teks (AI).");
    return;
  }
  const area = aiRefineArea();
  const allTiles = aiMakeTiles(area);
  const tiles = allTiles.filter(t => aiInkRatio(t) >= AI_MIN_INK);
  if (!tiles.length) { aiSay("Tidak ada tulisan atau tinta pada area baca."); return; }
  if (tiles.length > AI_MAX_TILES) {
    aiSay("Area terlalu luas: " + tiles.length + " tile (maks " + AI_MAX_TILES + "). Perkecil area Deteksi Cepat.");
    return;
  }
  const cost = aiBiayaUntuk(tiles.length);
  const where = (typeof lastDetR !== "undefined" && lastDetR) ? "kotak Deteksi Cepat terakhir" : "seluruh gambar";
  const confirmMsg =
    "Baca Teks (AI)\nArea: " + where + " (" + Math.round(area.w) + " × " + Math.round(area.h) + " px)\n" +
    "Tile: " + tiles.length + " dari " + allTiles.length + "\nBiaya: " + cost + " token\n\n" +
    "Bila dibatalkan di tengah proses, token untuk potongan yang belum diproses tidak dikembalikan.\n\nLanjutkan?";
  const ok = await new Promise(res => {
    if (typeof showConfirm === "function") showConfirm({
      title: "Baca Teks (AI)",
      body: confirmMsg,
      confirmText: "Lanjutkan",
      cancelText: "Batal",
      onConfirm: () => res(true),
      onCancel: () => res(false),
    });
    else res(confirm(confirmMsg));
  });
  if (!ok) return;
  if (typeof currentTokenBalance === "number" && currentTokenBalance < cost) {
    aiSay("Saldo token tidak cukup (" + currentTokenBalance + " < " + cost + ").");
    return;
  }

  const prev = aiTexts.map(t => JSON.parse(JSON.stringify(t)));
  aiBusy = true;
  aiCancel = false;
  aiUpdateTextUI();

  let runId = null, finished = false, okTiles = 0, refunded = false;
  let gotTexts = [];
  let finErr = null;   // kegagalan finish tercatat terpisah; tidak membuang hasil tile
  try {
    const st = await aiInvoke("start", { tiles: tiles.length }, "Gagal memulai Baca Teks (AI).");
    runId = st.run_id;
    if (typeof st.remaining === "number") aiSetBalance(st.remaining);
    aiSay("Baca Teks (AI): memproses 0/" + tiles.length + " tile…");

    let done = 0;
    await aiConcurrent(tiles, AI_CONC, async tile => {
      if (aiCancel) return;
      const pic = aiTileImage(tile);
      try {
        const data = await aiInvoke("tile", {
          run_id: runId,
          image: pic.image,
          width: pic.w,
          height: pic.h,
          mode: "text",
        }, "Tile gagal diproses.");
        okTiles++;
        if (Array.isArray(data.texts)) {
          for (const rec of data.texts) {
            const ent = aiTextFromTile(tile, rec, area);
            if (ent) gotTexts.push(ent);
          }
        }
      } catch (_) {
        // tile gagal: biarkan tile lain selesai
      }
      done++;
      if (!aiCancel) aiSay("Baca Teks (AI): memproses " + done + "/" + tiles.length + " tile…");
    });

    gotTexts = aiDedupTexts(gotTexts);
    // Penutupan proses dibungkus try/catch sendiri: kegagalan finish (mis. jaringan
    // terputus) hanya dilaporkan; teks dari tile yang sudah berhasil TIDAK
    // dibuang karena token terpotong sejak proses dimulai.
    finErr = null;
    try {
      const fin = await aiInvoke("finish", { run_id: runId }, "Gagal menutup proses Baca Teks (AI).");
      finished = true;
      refunded = !!fin.refunded;
      if (typeof fin.remaining === "number") aiSetBalance(fin.remaining);
    } catch (e2) {
      finErr = e2;
    }
  } catch (e) {
    if (runId && !finished) {
      try {
        const fin = await aiInvoke("finish", { run_id: runId }, "Gagal menutup proses Baca Teks (AI).");
        refunded = !!fin.refunded;
        if (typeof fin.remaining === "number") aiSetBalance(fin.remaining);
      } catch (_) { /* tetap laporkan kegagalan utama */ }
    }
    if (!okTiles) aiTexts = prev;
    aiSay("Baca Teks (AI) gagal: " + (e && e.message ? e.message : "coba lagi"));
    aiBusy = false;
    aiUpdateTextUI();
    if (typeof stat === "function") stat();
    if (typeof draw === "function") draw();
    return;
  }

  // Gabungkan hasil proses sebelumnya dengan hasil proses ini (proses kedua
  // tidak menimpa yang pertama), lalu pasangkan ulang agar hak/su tetap benar.
  const merged = aiMergeTexts(prev, gotTexts);
  const res = aiAssignTexts(merged, aiRingsForAssign());
  const finNote = finErr ? " (Penutupan proses di server gagal; cek riwayat token untuk kepastian refund.)" : "";
  if (!okTiles) {
    aiTexts = prev;
    aiSay("Baca Teks (AI) gagal: tidak ada tile yang berhasil. Token dikembalikan." + finNote);
  } else if (refunded || !res.items.length) {
    // Proses tanpa teks: pulihkan teks AI yang sudah ada, jangan dikosongkan.
    aiTexts = prev;
    aiSay("Baca Teks (AI): tidak ada teks baru ditemukan. Token dikembalikan." + finNote);
  } else {
    if (typeof snapshot === "function") snapshot();
    aiTexts = res.items;
    try { aiSel = -1; selT = -1; } catch (_) { /* abaikan */ }
    if (typeof stat === "function") stat();
    if (typeof draw === "function") draw();
    const s = res.stats;
    aiSay(
      "Baca Teks (AI): " + s.texts + " teks (" + s.pairs + " pasangan), " + s.fields + " bidang, " +
      s.noNumber + " tanpa nomor, " + s.multiHak + " hak ganda, " + s.outside +
      " teks di luar bidang. Tile berhasil " + okTiles + "/" + tiles.length + "."
    );
  }
  aiBusy = false;
  aiUpdateTextUI();
  if (typeof draw === "function") draw();
  if (typeof updateSidebarForTool === "function") updateSidebarForTool();
  if (typeof updateOverview === "function") updateOverview();
  if (refunded && typeof fetchUserTokens === "function") fetchUserTokens();
}

// ============================ pemasangan tombol ============================
if (typeof document !== "undefined" && typeof $ === "function") {
  const runBtn = $("aiTextRun");
  if (runBtn) runBtn.onclick = () => runAiText();
  const cancelBtn = $("aiTextCancel");
  if (cancelBtn) cancelBtn.onclick = () => {
    if (!aiBusy) return;
    aiCancel = true;
    aiSay("Membatalkan Baca Teks (AI)…");
  };
  const clearBtn = $("aiTextClear");
  if (clearBtn) clearBtn.onclick = () => {
    if (!aiTexts.length) { aiSay("Tidak ada teks AI yang perlu ditandai."); return; }
    if (typeof snapshot === "function") snapshot();
    for (const t of aiTexts) {
      delete t.ai;
      delete t.fmtWarn;
      delete t.luarBidang;
      delete t.banyakHak;
      texts.push(t);
    }
    aiTexts = [];
    try { aiSel = -1; selT = -1; } catch (_) { /* abaikan */ }
    if (typeof stat === "function") stat();
    if (typeof draw === "function") draw();
    aiSay("Hasil Baca Teks (AI) sudah ditandai diperiksa.");
  };
}

// Ekspor untuk tes Node murni (aiAssignTexts tidak memakai DOM).
if (typeof module === "object" && module.exports) {
  module.exports = { aiAssignTexts, aiBuildTexts, aiFitTextBox, aiMergeTexts, aiTextFromTile };
}
