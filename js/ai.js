// PlotPeta: Deteksi AI (BETA)
// Memotong area peta menjadi tile, meminta Edge Function detect-ai (VLM) menggambar
// garis batas + membaca teks, lalu menyelaraskan ("snap") hasilnya ke tinta gambar.
// Hasil masuk sebagai kandidat (cand / aiTexts) yang harus diperiksa pengguna.

const AI_TILE = 1024, AI_OVERLAP = 0.12, AI_CONC = 3, AI_SNAP_R = 6, AI_COORD = 1000, AI_MAX_TILES = 60;

var aiTexts = [];
var aiRaw = [];
let aiBusy = false, aiCancel = false, aiConfirmed = false;

const AI_RE_NO = /^(M|HM|HGB|HGU|HP|HPL|C)\.?\s?\d+[A-Z0-9\/\-]*$/i;
const AI_RE_SU = /^(SU|GS)\.?\s?\d+\/\d{2,4}$/i;

function aiSay(msg) {
  const a = $("dMsg");
  if (a) a.textContent = msg;
  const b = $("aiMsg");
  if (b) b.textContent = msg;
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

async function aiCallTile(tile) {
  const cv = document.createElement("canvas");
  cv.width = tile.w;
  cv.height = tile.h;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, tile.w, tile.h);
  cx.drawImage(img, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
  const image = cv.toDataURL("image/png");
  const { data, error } = await sb.functions.invoke("detect-ai", {
    body: { image, width: tile.w, height: tile.h },
  });
  if (error) {
    let msg = "";
    let status = 0;
    const ctx = error.context;
    if (ctx) {
      status = ctx.status || 0;
      if (typeof ctx.json === "function") {
        try {
          const j = await ctx.json();
          if (j && j.message) msg = j.message;
        } catch (_) { /* abaikan */ }
      }
    }
    const e = new Error(msg || "Layanan AI gagal memproses potongan peta.");
    e.status = status;
    throw e;
  }
  if (!data || data.ok !== true) {
    const e = new Error((data && data.message) || "Layanan AI gagal memproses potongan peta.");
    e.status = 0;
    throw e;
  }
  return data;
}

async function runAiDetect(R) {
  if (!img) return;
  if (!currentUser) { openAuthModal("login"); return; }
  if (aiBusy) return;
  if (!R || !(R.w > 0) || !(R.h > 0)) return;

  const tiles = aiMakeTiles(R);
  if (tiles.length > AI_MAX_TILES) {
    aiSay(
      "Area terlalu besar: " + tiles.length + " potongan (maksimal " + AI_MAX_TILES +
      "). Tarik kotak yang lebih kecil, lalu ulangi."
    );
    return;
  }
  if (!aiConfirmed) {
    const ok = confirm(
      "Potongan peta akan dikirim ke penyedia AI pihak ketiga untuk dianalisis (fitur beta). Lanjutkan?\n\n" +
      "Area ini akan dipecah menjadi " + tiles.length + " potongan."
    );
    if (!ok) return;
    aiConfirmed = true;
  }

  aiBusy = true;
  aiCancel = false;
  aiSel = -1;
  cand = [];
  aiTexts = [];
  aiRaw = [];

  const btnCancel = $("aiCancel");
  if (btnCancel) btnCancel.classList.remove("hide");
  aiSay("Menganalisis " + tiles.length + " potongan peta dengan AI...");

  const results = [];
  const errors = [];
  let rateLimited = null;

  try {
    await aiConcurrent(tiles, AI_CONC, async (tile) => {
      if (aiCancel) return;
      try {
        const data = await aiCallTile(tile);
        results.push({ tile, lines: data.lines || [], texts: data.texts || [] });
      } catch (e) {
        if (e && e.status === 429) {
          rateLimited = e.message || "Batas harian Deteksi AI tercapai. Coba lagi nanti.";
          aiCancel = true;
          return;
        }
        errors.push({ tile, message: e && e.message ? e.message : "Gagal" });
      }
    });

    if (rateLimited) {
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

    const weak = weakChains.length;
    const warn = aiTexts.filter(t => t.fmtWarn).length;
    const okTiles = results.length;
    const failTiles = errors.length;
    if (!okTiles && failTiles) {
      aiSay("Deteksi AI gagal: " + (errors[0].message || "coba lagi."));
    } else {
      let msg =
        "AI: " + cand.length + " jalur (" + weak + " tanpa dukungan tinta), " +
        aiTexts.length + " teks (" + warn + " perlu dicek). Periksa sebelum diterima. " +
        "Tile berhasil " + okTiles + "/" + tiles.length +
        (failTiles ? ", gagal " + failTiles : "") + ".";
      if (aiCancel && !rateLimited) msg += " Dibatalkan.";
      aiSay(msg);
    }
    stat();
    draw();
  } catch (e) {
    if (!rateLimited) {
      aiSay("Deteksi AI gagal: " + (e && e.message ? e.message : "coba lagi."));
    }
  } finally {
    aiBusy = false;
    if (btnCancel) btnCancel.classList.add("hide");
    draw();
  }
}

$("aiAll").onclick = () => {
  if (!img) { aiSay("Buka peta dulu."); return; }
  runAiDetect({ x: 0, y: 0, w: iw, h: ih });
};

$("aiCancel").onclick = () => {
  if (!aiBusy) return;
  aiCancel = true;
  aiSay("Membatalkan Deteksi AI...");
};

$("aiClear").onclick = () => {
  const has = lines.some(l => l.ai) || texts.some(t => t.ai);
  if (!has) { aiSay("Tidak ada hasil AI yang perlu ditandai."); return; }
  snapshot();
  lines.forEach(l => { delete l.ai; delete l.weak; });
  texts.forEach(t => { delete t.ai; delete t.fmtWarn; });
  stat();
  draw();
  aiSay("Hasil AI sudah ditandai diperiksa.");
};
