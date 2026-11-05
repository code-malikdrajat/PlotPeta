// PlotPeta: Perbaiki dengan AI (refine)
// Kandidat Deteksi Cepat dikirim sebagai petunjuk per tile. Edge Function detect-ai
// meminta VLM menyambung/memperbaiki garis, membuang noise, dan membaca teks hak/su.
// Hasil AI menimpa kandidat Cepat; snap ke tinta dan pembentukan poligon tetap di client.
// Biaya token: dipotong SEKALI di awal (aksi "start"); bila tidak ada hasil sama
// sekali, token otomatis dikembalikan saat aksi "finish" (lihat sql/5).

const AI_TILE = 1024, AI_OVERLAP = 0.12, AI_CONC = 3, AI_SNAP_R = 6, AI_COORD = 1000, AI_MAX_TILES = 300;
const AI_MIN_INK = 0.004, AI_HINT_MAX = 240;

var aiTexts = [];
var aiRaw = [];
// Kandidat Deteksi Cepat asli sebagai lapisan referensi setelah AI mengoreksi.
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

// Polyline kandidat Cepat yang memotong tile -> koordinat 0-1000 (x kanan, y bawah).
function aiHintsForTile(tile, source) {
  const out = [];
  if (!Array.isArray(source)) return out;
  const r = { x0: tile.x, y0: tile.y, x1: tile.x + tile.w, y1: tile.y + tile.h };
  for (const c of source) {
    const pts = c && c.pts;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    if (c.closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
    for (const pair of segs) {
      const a = pair[0], b = pair[1];
      if (!a || !b) continue;
      const seg = aiClipSeg(a[0], a[1], b[0], b[1], r);
      if (!seg) continue;
      const p = seg[0], q = seg[1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5) continue;
      const norm = pnt => [
        Math.round(((pnt[0] - r.x0) / tile.w) * AI_COORD * 10) / 10,
        Math.round(((pnt[1] - r.y0) / tile.h) * AI_COORD * 10) / 10,
      ];
      out.push([norm(p), norm(q)]);
      if (out.length >= AI_HINT_MAX) return out;
    }
  }
  return out;
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
  const keep = ppDP(out, 1.2);
  const sPts = keep.map(i => out[i]);
  const sFlags = keep.map(i => flags[i]);
  const groups = [];
  let start = 0;
  for (let i = 1; i <= sPts.length; i++) {
    if (i === sPts.length || sFlags[i] !== sFlags[start]) {
      if (i - start >= 2) groups.push({ sup: sFlags[start], pts: sPts.slice(start, i) });
      start = i;
    }
  }
  return groups;
}

function aiNormText(value) {
  return String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, " ");
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
    if (best >= 0) {
      const su = uniq[best];
      used.add(best);
      item.p = [(e.p[0] + su.p[0]) / 2, (e.p[1] + su.p[1]) / 2];
      item.su = su.text;
    }
    if (!AI_RE_NO.test(item.no)) item.fmtWarn = true;
    if (item.su && !AI_RE_SU.test(item.su)) item.fmtWarn = true;
    out.push(item);
    used.add(i);
  });
  uniq.forEach((e, i) => {
    if (e.kind !== "su" || used.has(i)) return;
    const item = { p: e.p.slice(), su: e.text, ai: true };
    if (!AI_RE_SU.test(item.su)) item.fmtWarn = true;
    out.push(item);
  });
  return out;
}

async function aiCallTile(tile, runId, hintSource) {
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
    mode: "refine",
    lines_hint: aiHintsForTile(tile, hintSource),
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
    "). Kandidat Deteksi Cepat dikirim sebagai petunjuk. Hasil AI menimpa kandidat. Lanjutkan?\n\n" +
    "Area Deteksi Cepat dipecah menjadi " + tiles.length + " potongan" +
    (skipped ? " (" + skipped + " potongan kosong dilewati)" : "") + "."
  );
  if (!ok) return;

  // Simpan kandidat Cepat agar tidak hilang bila proses gagal total.
  const prevCand = cand.slice();
  const prevTexts = aiTexts.slice();
  const prevRaw = aiRaw.slice();

  // Jangan kosongkan kandidat di awal: garis oranye tetap tampil selama AI
  // bekerja, lalu ditimpa hasil baru setelah semua tile selesai.
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
  let aiProduced = false;

  const results = [];
  const errors = [];
  let rateLimited = null;
  let limitHit = false;

  try {
    // 1. start: potong token sekali untuk seluruh proses, dapatkan run_id.
    const started = await aiInvoke("start", { action: "start", tiles: tiles.length },
      "Gagal memulai proses Perbaiki dengan AI.");
    runId = started.run_id;

    aiSay(
      "Memperbaiki " + tiles.length + " potongan area dengan AI... (" + cost + " token)" +
      (skipped ? " " + skipped + " potongan kosong dilewati." : "")
    );

    await aiConcurrent(tiles, AI_CONC, async (tile) => {
      if (aiCancel) return;
      try {
        const data = await aiCallTile(tile, runId, prevCand);
        results.push({ tile, lines: data.lines || [], texts: data.texts || [] });
      } catch (e) {
        if (e && e.status === 429) {
          rateLimited = e.message || "Batas harian Perbaiki dengan AI tercapai. Coba lagi nanti.";
          aiCancel = true;
          return;
        }
        errors.push({ tile, message: e && e.message ? e.message : "Gagal" });
      }
    });

    if (rateLimited) {
      baseMsg = rateLimited;
      aiSay(rateLimited);
      return;
    }

    const supSegs = [];
    const weakChains = [];
    const textEntries = [];

    for (const r of results) {
      const sk = aiSkeleton(r.tile);
      for (const line of r.lines) {
        if (!line || !Array.isArray(line.points) || line.points.length < 2) continue;
        const pts = [];
        for (const q of line.points) {
          if (!Array.isArray(q) || q.length < 2) continue;
          const x = Number(q[0]), y = Number(q[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push([
            r.tile.x + x / AI_COORD * r.tile.w,
            r.tile.y + y / AI_COORD * r.tile.h,
          ]);
        }
        if (pts.length < 2) continue;
        if (window.__aiDebug === true) aiRaw.push(pts);

        const groups = aiSnapPolyline(pts, r.tile, sk);
        for (const g of groups) {
          if (g.sup) {
            for (let i = 0; i < g.pts.length - 1; i++) {
              supSegs.push([g.pts[i][0], g.pts[i][1], g.pts[i + 1][0], g.pts[i + 1][1]]);
            }
          } else {
            weakChains.push({ k: "P", pts: g.pts, ai: true, weak: true });
          }
        }
      }

      for (const t of r.texts) {
        if (!t || t.text == null) continue;
        if (t.kind !== "hak" && t.kind !== "su") continue;
        const text = aiNormText(t.text);
        if (!text) continue;
        const pos = Array.isArray(t.position) ? t.position : [0, 0];
        textEntries.push({
          text,
          kind: t.kind,
          p: [
            r.tile.x + (Number(pos[0]) || 0) / AI_COORD * r.tile.w,
            r.tile.y + (Number(pos[1]) || 0) / AI_COORD * r.tile.h,
          ],
          tw: r.tile.w,
          th: r.tile.h,
        });
      }
    }

    let chains = [];
    if (supSegs.length) {
      let flat = removeDuplicates(supSegs);
      flat = splitAtIntersections(flat);
      chains = plotPetaBuildChains(
        flat.map(q => [[q[0], q[1]], [q[2], q[3]]]),
        1.5,
        8
      );
      try {
        chains = cleanTopologyChains(chains, { mode: "all", tol: 16 }).chains;
      } catch (_) { /* biarkan rantai apa adanya */ }
      plotPetaNumberEnds(chains);
      chains.forEach(c => { c.ai = true; });
    }

    cand = chains.concat(weakChains);
    aiTexts = aiBuildTexts(textEntries);
    // Simpan garis Cepat asli sebagai referensi oranye; hasil AI tetap jadi kandidat aktif.
    if (results.length) aiHintOverlay = prevCand.slice();

    const weak = weakChains.length;
    const warn = aiTexts.filter(t => t.fmtWarn).length;
    const okTiles = results.length;
    const failTiles = errors.length;
    aiProduced = okTiles > 0;
    if (!okTiles) {
      baseMsg = failTiles
        ? "Perbaikan AI gagal: " + (errors[0].message || "coba lagi.")
        : "Perbaikan AI tidak menghasilkan potongan yang berhasil.";
      aiSay(baseMsg);
    } else {
      let msg =
        "Perbaikan AI: " + cand.length + " jalur final (" + weak + " tanpa dukungan tinta), " +
        aiTexts.length + " teks (" + warn + " perlu dicek). Poligon tetap dibentuk di perangkat. " +
        "Tile berhasil " + okTiles + "/" + tiles.length +
        (failTiles ? ", gagal " + failTiles : "") +
        (skipped ? ", " + skipped + " kosong dilewati" : "") + ".";
      if (aiCancel && !rateLimited) msg += " Dibatalkan.";
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
    if (!aiProduced) {
      cand = prevCand;
      aiTexts = prevTexts;
      aiRaw = prevRaw;
      aiHintOverlay = [];
      if (prevCand.length && !limitHit && !rateLimited) baseMsg = (baseMsg ? baseMsg + " " : "") + "Kandidat Deteksi Cepat dipertahankan.";
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

// ==================== Perbaiki AI: validasi visual & sambung garis ====================
// Mengirim segmen Deteksi Cepat + gambar peta asli ke Edge Function detect-ai
// (action "refine_lines_with_image"). Server memakai Vision AI untuk menilai
// apakah garis benar-benar mengikuti alur pada peta, lalu menyambung celah yang
// memang punya jejak samar. Bila vision tidak tersedia, server memakai geometri.
// Hasil digambar ulang lewat PlotPetaDrawer (biru = valid, ungu = sambungan).
const REFINE_TIMEOUT_MS = 90000;
const REFINE_MAX_LINES = 300;
const REFINE_MAX_POINTS = 60;
const REFINE_IMAGE_MAX = 1200000;
const REFINE_IMAGE_SIDE = 1600;
var refineBusy = false;

function refinePointsOf(line) {
  const raw = line && (line.points || line.pts);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([x, y]);
    if (out.length >= REFINE_MAX_POINTS) break;
  }
  return out.length >= 2 ? out : [];
}

// Ambil gambar peta ASLI (tanpa overlay garis/teks) sebagai PNG base64.
// Gambar diperkecil maksimal 1600 px agar payload hemat; koordinat garis tetap
// memakai piksel gambar asli, jadi info skala ikut dikirim untuk server.
function refineCaptureImage(canvasElement) {
  const out = { image: "", info: null };
  try {
    if (typeof document === "undefined") return out;
    const source = typeof img !== "undefined" && img && img.naturalWidth ? img : null;
    const fallback = canvasElement || (typeof plotCanvas !== "undefined" ? plotCanvas : null);
    if (!source && !(fallback && typeof fallback.toDataURL === "function")) return out;
    const naturalW = source ? source.naturalWidth : fallback.width;
    const naturalH = source ? source.naturalHeight : fallback.height;
    if (!naturalW || !naturalH) return out;
    const shrink = Math.min(1, REFINE_IMAGE_SIDE / Math.max(naturalW, naturalH));
    let w = Math.max(1, Math.round(naturalW * shrink));
    let h = Math.max(1, Math.round(naturalH * shrink));
    const render = (cw, ch) => {
      const cv = document.createElement("canvas");
      cv.width = cw;
      cv.height = ch;
      const c = cv.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, cw, ch);
      c.imageSmoothingQuality = "high";
      c.drawImage(source || fallback, 0, 0, cw, ch);
      return cv;
    };
    let cv = render(w, h);
    let data = cv.toDataURL("image/png");
    // PNG peta hasil pindai bisa besar; kecilkan bertahap sampai di bawah batas.
    for (let i = 0; i < 4 && data.length > REFINE_IMAGE_MAX && w > 320; i++) {
      w = Math.max(1, Math.round(w * 0.7));
      h = Math.max(1, Math.round(h * 0.7));
      cv = render(w, h);
      data = cv.toDataURL("image/png");
    }
    if (data.length > REFINE_IMAGE_MAX) return out;
    out.image = data;
    out.info = { width: w, height: h, natural_width: naturalW, natural_height: naturalH };
    return out;
  } catch (_) {
    return out;
  }
}

function refineSetBusy(on, message) {
  refineBusy = !!on;
  const cv = typeof plotCanvas !== "undefined" ? plotCanvas : null;
  if (cv && cv.setAttribute) {
    if (on) cv.setAttribute("aria-busy", "true");
    else cv.removeAttribute("aria-busy");
  }
  if (on && message) aiSay(message);
}

// Cadangan bila js/drawer.js tidak termuat: tulis lapisan ke kandidat aktif.
function refineApplyLayers(layers) {
  const src = layers || {};
  if (typeof cand === "undefined") return;
  if (typeof snapshot === "function") snapshot();
  const entry = (line, flags) => Object.assign({
    k: line.k || "P", pts: line.points, ai: true, refine: true,
  }, line.id != null ? { id: line.id } : {}, flags);
  cand = (src.orangeLines || []).map(l => entry(l, { aiOrange: true }))
    .concat((src.blueLines || []).map(l => entry(l, { aiBlue: true })))
    .concat((src.purpleLines || []).map(l => entry(l, { purple: true })));
  if (typeof syncCandClean === "function") syncCandClean();
  if (typeof candMsg === "function") candMsg();
}

async function jalankanPerbaikanAI(garisOranyeDeteksiCepat, canvasElement) {
  if (refineBusy) { aiSay("Perbaikan garis masih berjalan..."); return null; }
  if (!sb || typeof sb.functions === "undefined") {
    aiSay("Layanan tidak tersedia. Muat ulang halaman lalu coba lagi.");
    return null;
  }
  if (typeof currentUser !== "undefined" && !currentUser) {
    aiSay("Silakan masuk terlebih dahulu untuk memakai Perbaiki AI.");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return null;
  }

  const source = Array.isArray(garisOranyeDeteksiCepat) && garisOranyeDeteksiCepat.length
    ? garisOranyeDeteksiCepat
    : (typeof cand !== "undefined" && cand.length ? cand : []);
  const usedIds = new Set();
  const byId = new Map();
  const lines = [];
  for (const raw of source.slice(0, REFINE_MAX_LINES)) {
    const points = refinePointsOf(raw);
    if (!points.length) continue;
    const base = raw && raw.id != null && String(raw.id).trim()
      ? String(raw.id).trim().slice(0, 64)
      : "line_" + (lines.length + 1);
    let id = base, n = 2;
    while (usedIds.has(id)) id = base + "_" + (n++);
    usedIds.add(id);
    lines.push({ id, points });
    byId.set(id, raw);
  }
  if (!lines.length) {
    aiSay("Tidak ada segmen garis valid untuk diperbaiki.");
    return null;
  }

  // Validasi lokal selesai (NaN/titik kosong/segmen < 2 titik sudah dibuang).
  // Sekarang ambil gambar peta asli untuk analisis piksel oleh Vision AI.
  const captured = refineCaptureImage(canvasElement);

  refineSetBusy(true, "Menganalisis gambar peta: memvalidasi garis dan menyambung celah...");
  let timer = 0;
  try {
    const body = { action: "refine_lines_with_image", lines };
    if (captured.image) {
      body.image_base64 = captured.image;
      body.image_info = captured.info;
    }
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error("Perbaikan garis melewati batas waktu. Coba lagi.");
        err.status = 408;
        reject(err);
      }, REFINE_TIMEOUT_MS);
    });
    const { data, error } = await Promise.race([
      sb.functions.invoke("detect-ai", { body }),
      timeout,
    ]);
    if (error) throw await aiErrorFromInvoke(error, "Layanan perbaikan garis gagal.");
    const payload = data && data.data ? data.data : data;
    const hasRefineData = payload && typeof payload === "object" && (
      Array.isArray(payload.removed_line_ids) ||
      Array.isArray(payload.ai_connections) ||
      Array.isArray(payload.valid_lines)
    );
    if (!hasRefineData) {
      throw new Error((data && data.message) || "Jawaban perbaikan garis tidak valid.");
    }

    // Garis oranye yang tidak ada di removed_line_ids = tervalidasi AI -> biru.
    const removedIds = new Set(
      (Array.isArray(payload.removed_line_ids) ? payload.removed_line_ids : []).map(String),
    );
    const kept = lines.filter(l => !removedIds.has(l.id));
    const blueLines = kept.map(l => Object.assign({}, byId.get(l.id) || {}, {
      id: l.id,
      points: l.points,
      color: "#1E90FF",
    }));
    const purpleLines = [];
    for (const c of (Array.isArray(payload.ai_connections) ? payload.ai_connections : [])) {
      const points = refinePointsOf(c);
      if (!points.length) continue;
      purpleLines.push({
        id: c && c.id != null ? String(c.id) : "purple_conn_" + (purpleLines.length + 1),
        from: c && c.from != null ? String(c.from) : "",
        to: c && c.to != null ? String(c.to) : "",
        points,
        color: (c && c.color) || "#8A2BE2",
      });
    }

    const layers = { orangeLines: [], blueLines, purpleLines };
    const drawer = window.PlotPetaDrawer;
    if (drawer && typeof drawer.renderMultiLayer === "function") drawer.renderMultiLayer(layers);
    else if (drawer && typeof drawer.clearAndRedraw === "function") drawer.clearAndRedraw(layers);
    else refineApplyLayers(layers);

    if (typeof syncCandClean === "function") syncCandClean();
    if (typeof stat === "function") stat();
    if (typeof draw === "function") draw();
    const mode = payload && typeof payload.mode === "string" ? payload.mode : "vision";
    aiSay(
      "Perbaikan AI selesai: " + blueLines.length + " garis biru tervalidasi, " +
      purpleLines.length + " sambungan ungu dibuat, " + (lines.length - kept.length) + " noise dibuang." +
      (mode === "geometry" ? " (vision tidak tersedia, memakai geometri)" : "")
    );
    return { ok: true, mode, orangeLines: [], blueLines, purpleLines, removedLineIds: [...removedIds] };
  } catch (e) {
    const msg = e && e.message ? e.message : "coba lagi.";
    aiSay("Perbaikan garis gagal: " + msg);
    return { ok: false, message: msg };
  } finally {
    if (timer) clearTimeout(timer);
    refineSetBusy(false);
  }
}

function perbaikiHasilDeteksi(garisOranyeDeteksiCepat, canvasElement) {
  return jalankanPerbaikanAI(garisOranyeDeteksiCepat, canvasElement);
}

window.jalankanPerbaikanAI = jalankanPerbaikanAI;
window.perbaikiHasilDeteksi = perbaikiHasilDeteksi;
