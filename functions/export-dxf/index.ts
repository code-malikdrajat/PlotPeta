import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://plotpeta.vercel.app";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function num(s: unknown): number {
  let t = String(s ?? "").trim();
  t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  return parseFloat(t);
}

function solve3(A: number[][], b: number[]): number[] | null {
  const n = 3, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k;
    [M[i], M[m]] = [M[m], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = [0, 0, 0];
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function clean(s: unknown, max = 120): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

const okPt = (p: any) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 1e9 && Math.abs(p[1]) <= 1e9;

function buildDxf(o: any): string {
  if (!o || typeof o !== "object") throw new Error("Data proyek tidak valid");
  const lines: any[] = Array.isArray(o.lines) ? o.lines : [];
  const texts: any[] = Array.isArray(o.texts) ? o.texts : [];
  const polys: any[] = Array.isArray(o.polys) ? o.polys : [];
  if (lines.length > 20000 || texts.length > 20000 || polys.length > 20000) throw new Error("Data proyek terlalu besar");
  if (!lines.length && !texts.length && !polys.length) throw new Error("Belum ada yang digambar");

  const coordinateMode = o.coordinateMode === "map" ? "map" : "local";
  const size: number[] = Array.isArray(o.size) ? o.size : [];
  const imageHeight = Number(size[1]);
  const cal: any[] = Array.isArray(o.cal) ? o.cal : [];
  let toReal: (p: number[]) => number[];
  if (coordinateMode === "local") {
    if (!Number.isFinite(imageHeight) || imageHeight <= 0) throw new Error("Ukuran gambar tidak tersedia untuk koordinat lokal. Muat ulang peta lalu ekspor lagi.");
    toReal = (p) => [p[0], imageHeight - p[1]];
  } else {
    if (cal.length !== 4) throw new Error("Kalibrasi 4 titik belum lengkap");
    const P = cal.map((c) => c?.p);
    const vals = cal.map((c) => [num(c?.x), num(c?.y)]);
    if (!P.every(okPt) || vals.flat().some((v) => !Number.isFinite(v))) throw new Error("Titik atau koordinat kalibrasi tidak valid");
    if (new Set(vals.map((v) => `${v[0]},${v[1]}`)).size < 3) throw new Error("Koordinat kalibrasi berulang/berimpit. Isi koordinat sebenarnya untuk setiap titik.");
    const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
    P.forEach((p, i) => {
      const a = [p[0], p[1], 1];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) N[r][c] += a[r] * a[c];
        rx[r] += a[r] * vals[i][0];
        ry[r] += a[r] * vals[i][1];
      }
    });
    const cx = solve3(N, rx), cy = solve3(N, ry);
    if (!cx || !cy) throw new Error("Titik kalibrasi terlalu sejajar atau berimpit");
    const M = [...cx, ...cy];
    toReal = (p) => [M[0] * p[0] + M[1] * p[1] + M[2], M[3] * p[0] + M[4] * p[1] + M[5]];
  }

  let total = 0;
  for (const l of lines) {
    if (!l || !Array.isArray(l.pts) || !l.pts.every(okPt)) throw new Error("Data garis tidak valid");
    total += l.pts.length;
  }
  for (const pg of polys) {
    if (!Array.isArray(pg) || !pg.every(okPt)) throw new Error("Data poligon tidak valid");
    total += pg.length;
  }
  for (const t of texts) if (!t || !okPt(t.p)) throw new Error("Data teks tidak valid");
  if (total > 500000) throw new Error("Data proyek terlalu besar");

  const ly: any[] = Array.isArray(o.ly) ? o.ly : [];
  const lP = clean(ly[0]) || "020100", lD = clean(ly[1]) || "020300";
  const lS = clean(ly[2]) || "080202", lM = clean(ly[3]) || "080203", lPo = clean(ly[4]) || "BIDANG K4 ER";
  const h0 = num(o.th);
  const h = Number.isFinite(h0) && h0 > 0 && h0 < 1e6 ? h0 : 5;

  const L: (string | number)[] = [], g = (c: number, v: string | number) => L.push(c, v), n = (x: number) => x.toFixed(6);

  const boundsPts: number[][] = [];
  for (const l of lines) for (const p of l.pts) boundsPts.push(toReal(p));
  for (const pg of polys) for (const p of pg) boundsPts.push(toReal(p));
  for (const t of texts) boundsPts.push(toReal(t.p));
  if (!boundsPts.length) throw new Error("Tidak ada titik koordinat valid untuk DXF");

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of boundsPts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("Koordinat hasil ekspor tidak valid");
  const pad = Math.max(maxX - minX, maxY - minY, h, 1) * 0.02;

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1015");
  g(9, "$INSUNITS"); g(70, 0);
  g(9, "$MEASUREMENT"); g(70, 1);
  g(9, "$EXTMIN"); g(10, n(minX - pad)); g(20, n(minY - pad)); g(30, 0);
  g(9, "$EXTMAX"); g(10, n(maxX + pad)); g(20, n(maxY + pad)); g(30, 0);
  const viewW = Math.max(maxX - minX, 1) * 1.08;
  const viewH = Math.max(maxY - minY, 1) * 1.08;
  g(9, "$VIEWCTR"); g(10, n((minX + maxX) / 2)); g(20, n((minY + maxY) / 2));
  g(9, "$VIEWSIZE"); g(40, n(viewH));
  g(9, "$LIMMIN"); g(10, n(minX - pad)); g(20, n(minY - pad));
  g(9, "$LIMMAX"); g(10, n(maxX + pad)); g(20, n(maxY + pad));
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");

  g(0, "TABLE"); g(2, "VPORT"); g(70, 1);
  g(0, "VPORT"); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbViewportTableRecord");
  g(2, "*Active"); g(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1);
  g(12, n((minX + maxX) / 2)); g(22, n((minY + maxY) / 2));
  g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10);
  g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0);
  g(40, n(viewH)); g(41, n(viewW / viewH)); g(42, 50); g(43, 0); g(44, 0);
  g(50, 0); g(51, 0); g(71, 0); g(72, 1000); g(73, 1); g(74, 3);
  g(75, 0); g(76, 0); g(77, 0); g(78, 0); g(0, "ENDTAB");

  g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
  g(0, "LTYPE"); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbLinetypeTableRecord"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "LTYPE"); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbLinetypeTableRecord"); g(2, "DASHED"); g(70, 0); g(3, "Dashed"); g(72, 65); g(73, 2); g(40, 9); g(49, 6); g(49, -3);
  g(0, "ENDTAB");

  const CL: Record<string, number> = {
    "020100": 7,
    "020300": 7,
    "080202": 7,
    "080203": 7,
    "BIDANG K4 ER": 2,
  };

  const clampColor = (v: unknown): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 7;
    const c = Math.round(n);
    if (c < 0 || c > 255) return 7;
    return c;
  };

  const ls = [[lP, "CONTINUOUS"], [lD, "DASHED"], [lS, "CONTINUOUS"], [lM, "CONTINUOUS"], [lPo, "CONTINUOUS"]]
    .filter((a, i, A) => A.findIndex((b) => b[0] === a[0]) === i);

  g(0, "TABLE"); g(2, "LAYER"); g(70, ls.length);
  ls.forEach(([a, t]) => {
    g(0, "LAYER"); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbLayerTableRecord");
    g(2, a); g(70, 0); g(62, clampColor(CL[a])); g(6, t);
  });
  g(0, "ENDTAB"); g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "BLOCKS");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");

  const distinctPoints = (pts: number[][]) => pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-7);
  let exportedGeometry = 0;

  const emitPolyline = (layer: string, pts: number[][], closed: boolean) => {
    if (!pts || pts.length < 2) return;
    const realPts = pts.map((p) => toReal(p));

    g(0, "POLYLINE");
    g(100, "AcDbEntity");
    g(8, layer);
    g(62, clampColor(CL[layer] ?? 7));
    g(100, "AcDbPolyline");
    g(66, 1);
    g(70, closed ? 1 : 0);

    for (const r of realPts) {
      g(0, "VERTEX");
      g(100, "AcDbEntity");
      g(8, layer);
      g(62, clampColor(CL[layer] ?? 7));
      g(100, "AcDbVertex");
      g(10, n(r[0]));
      g(20, n(r[1]));
      g(30, 0);
    }

    g(0, "SEQEND");
    g(100, "AcDbEntity");
    exportedGeometry++;
  };

  lines.forEach((l) => {
    const pts = distinctPoints(l.pts);
    if (pts.length < 2) return;
    const layer = l.k === "D" ? lD : lP;
    emitPolyline(layer, pts, false);
  });

  polys.forEach((pg) => {
    const pts = distinctPoints(pg);
    if (pts.length < 3) return;
    emitPolyline(lPo, pts, true);
  });

  const tx = (ly3: string, s: string, x: number, y: number) => {
    g(0, "TEXT");
    g(100, "AcDbEntity");
    g(8, ly3);
    g(62, clampColor(CL[ly3] ?? 7));
    g(100, "AcDbText");
    g(10, n(x));
    g(20, n(y));
    g(30, 0);
    g(40, h);
    g(1, s);
    g(72, 1);
    g(73, 2);
    g(11, n(x));
    g(21, n(y));
    g(31, 0);
  };

  texts.forEach((t) => {
    const r = toReal(t.p), no = clean(t.no, 200), su = clean(t.su, 200);
    if (no) tx(lM, no, r[0], r[1]);
    if (su) tx(lS, su, r[0], r[1] - h * 1.6);
  });

  if (exportedGeometry === 0 && texts.every((t) => !clean(t.no, 200) && !clean(t.su, 200))) {
    throw new Error("Tidak ada garis atau teks valid untuk diekspor. Periksa digitasi dan mode koordinat.");
  }

  g(0, "ENDSEC"); g(0, "EOF");
  return L.join("\r\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ ok: false, message: "Metode tidak diizinkan" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, message: "Silakan masuk terlebih dahulu" }, 401);
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u?.user) return json({ ok: false, message: "Sesi tidak valid, silakan masuk ulang" }, 401);
  const userId = u.user.id;

  const raw = await req.text();
  if (raw.length > 6 * 1024 * 1024) return json({ ok: false, message: "Data proyek terlalu besar" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, message: "Data tidak valid" }, 400); }

  let dxf: string;
  try { dxf = buildDxf(body); } catch (e) { return json({ ok: false, message: (e as Error).message }, 400); }

  const { data: c, error: ce } = await admin.rpc("server_consume_token", { p_user_id: userId });
  if (ce) return json({ ok: false, message: "Gagal memeriksa token, coba lagi" }, 500);
  if (!c?.success) return json({ ok: false, message: c?.message ?? "Token habis atau kedaluwarsa" }, 402);

  try {
    return json({ ok: true, dxf, remaining: c.remaining_balance });
  } catch (_e) {
    await admin.rpc("server_refund_token", { p_ledger_id: c.ledger_id });
    return json({ ok: false, message: "Gagal mengirim DXF, token dikembalikan" }, 500);
  }
});
