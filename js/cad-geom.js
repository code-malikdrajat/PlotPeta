/*!
 * Portions derived from Puter CAD (src/core/geom/trim.js). MIT License,
 * Copyright (c) 2026 Puter Technologies Inc. See THIRD-PARTY-LICENSES.md.
 *
 * Geometri Trim/Extend untuk rantai polyline PlotPeta (tanpa DOM).
 * Posisi parameter polyline = indeks segmen + pecahan (0..jumlah segmen).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PlotPetaCadGeom = api;
    root.cadParamModel = api.cadParamModel;
    root.cadCutParams = api.cadCutParams;
    root.cadTrim = api.cadTrim;
    root.cadTrimRange = api.cadTrimRange;
    root.cadRayHit = api.cadRayHit;
    root.cadRayRayHit = api.cadRayRayHit;
    root.cadExtendRay = api.cadExtendRay;
    root.cadExtend = api.cadExtend;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-9;
  var PARAM_EPS = 1e-7;

  function pt(p) {
    if (!p) return null;
    if (Array.isArray(p)) return [+p[0], +p[1]];
    if (typeof p.x === 'number' && typeof p.y === 'number') return [+p.x, +p.y];
    return null;
  }

  function samePt(a, b, eps) {
    var e = eps == null ? EPS : eps;
    return !!a && !!b && Math.abs(a[0] - b[0]) <= e && Math.abs(a[1] - b[1]) <= e;
  }

  function dist(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
  }

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }

  function mul(a, k) {
    return [a[0] * k, a[1] * k];
  }

  function cross(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function cleanPts(pts) {
    var out = [];
    if (!Array.isArray(pts)) return out;
    for (var i = 0; i < pts.length; i++) {
      var q = pt(pts[i]);
      if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
      if (out.length && samePt(out[out.length - 1], q)) continue;
      out.push(q);
    }
    return out;
  }

  /** Semua ruas dari rantai atau daftar rantai/ruas. */
  function segmentsOf(input) {
    var out = [];
    if (!input) return out;

    function pushSeg(a, b, chain, segIndex) {
      if (!a || !b) return;
      var l = dist(a, b);
      if (!(l > EPS)) return;
      out.push({ a: a, b: b, chain: chain || null, segIndex: segIndex == null ? -1 : segIndex });
    }

    function addChain(chain) {
      var pts = cleanPts(chain.pts || chain);
      if (pts.length < 2) return;
      var n = pts.length - 1;
      for (var i = 0; i < n; i++) pushSeg(pts[i], pts[i + 1], chain, i);
      if (chain.closed && pts.length > 2) pushSeg(pts[pts.length - 1], pts[0], chain, n);
    }

    if (Array.isArray(input)) {
      if (input.length === 2 && Array.isArray(input[0]) && Array.isArray(input[1])) {
        var a = pt(input[0]), b = pt(input[1]);
        if (a && b) pushSeg(a, b, null, 0);
        return out;
      }
      if (input.length === 4 && input.every(function (v) { return typeof v === 'number'; })) {
        pushSeg([+input[0], +input[1]], [+input[2], +input[3]], null, 0);
        return out;
      }
      for (var i = 0; i < input.length; i++) {
        var item = input[i];
        if (!item) continue;
        if (item.pts) addChain(item);
        else if (Array.isArray(item)) {
          var q = segmentsOf(item);
          for (var j = 0; j < q.length; j++) out.push(q[j]);
        } else if (item.a && item.b) pushSeg(pt(item.a), pt(item.b), null, i);
      }
      return out;
    }

    if (input.pts) addChain(input);
    return out;
  }

  function chainsOf(input) {
    var out = [];
    if (!input) return out;
    if (input.pts) return [input];
    if (Array.isArray(input)) {
      for (var i = 0; i < input.length; i++) {
        var item = input[i];
        if (item && item.pts) out.push(item);
      }
    }
    return out;
  }

  /** Titik terdekat pada satu ruas; t adalah pecahan 0..1. */
  function nearestOnSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy;
    var t = l2 > EPS ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    var q = [a[0] + t * dx, a[1] + t * dy];
    return { t: t, pt: q, d: dist(p, q) };
  }

  /**
   * Model parameter polyline. Parameter u = indeks segmen + pecahan.
   * piece() selalu mengembalikan rantai terbuka; pada rantai tertutup u1
   * boleh melewati ujung (mis. 7..12) dan akan berputar ke awal.
   */
  function cadParamModel(pts, closed) {
    var P = cleanPts(pts);
    if (P.length < 2) return null;
    var isClosed = !!closed;
    var n = isClosed ? P.length : P.length - 1;
    if (n < 1) return null;
    var segLen = [], cum = [0], total = 0, i;
    for (i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % P.length];
      var l = dist(a, b);
      segLen.push(l);
      total += l;
      cum.push(total);
    }
    if (!(total > EPS)) return null;

    function point(u) {
      if (!isFinite(u)) return null;
      if (isClosed) {
        u = ((u % n) + n) % n;
      } else {
        u = clamp(u, 0, n);
      }
      var si = Math.floor(u);
      var t = u - si;
      if (si >= n) {
        si = n - 1;
        t = 1;
      }
      var a = P[si], b = P[(si + 1) % P.length];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }

    function vertex(k) {
      if (isClosed) return P[((k % n) + n) % n].slice();
      if (k <= 0) return P[0].slice();
      if (k >= n) return P[n].slice();
      return P[k].slice();
    }

    function piece(u0, u1) {
      if (!isFinite(u0) || !isFinite(u1)) return null;
      if (!isClosed) {
        u0 = clamp(u0, 0, n);
        u1 = clamp(u1, 0, n);
      }
      if (!(u1 - u0 > PARAM_EPS)) return null;
      var out = [point(u0)];
      var k0 = Math.floor(u0 + PARAM_EPS);
      var k1 = Math.ceil(u1 - PARAM_EPS);
      for (var k = k0 + 1; k < k1; k++) {
        if (k > u0 + PARAM_EPS && k < u1 - PARAM_EPS) out.push(vertex(k));
      }
      out.push(point(u1));
      var clean = [];
      for (var j = 0; j < out.length; j++) {
        if (!out[j]) continue;
        if (clean.length && samePt(clean[clean.length - 1], out[j], 1e-7)) continue;
        clean.push(out[j]);
      }
      if (clean.length < 2) return null;
      return { pts: clean, closed: false };
    }

    function lengthAt(u) {
      if (isClosed) u = ((u % n) + n) % n;
      else u = clamp(u, 0, n);
      var si = Math.floor(u);
      if (si >= n) return total;
      var t = u - si;
      return cum[si] + (cum[si + 1] - cum[si]) * t;
    }

    function paramAtPoint(px, py) {
      var p = [px, py], best = null, bd = Infinity;
      for (var si = 0; si < n; si++) {
        var q = nearestOnSeg(p, P[si], P[(si + 1) % P.length]);
        if (q.d < bd - 1e-12) {
          bd = q.d;
          best = { u: si + q.t, t: q.t, si: si, pt: q.pt, d: q.d };
        }
      }
      return best;
    }

    return {
      pts: P,
      closed: isClosed,
      segCount: n,
      length: total,
      cum: cum,
      eps: PARAM_EPS,
      point: point,
      piece: piece,
      lengthAt: lengthAt,
      paramAtPoint: paramAtPoint
    };
  }

  /**
   * Parameter semua persilangan pemotong dengan rantai, ditambah ujung
   * pemotong terbuka yang menyentuh rantai dalam tol (T-junction).
   */
  function cadCutParams(model, cutters, tol) {
    if (!model) return [];
    var t = tol == null ? 1e-6 : Math.max(0, +tol || 0);
    var out = [];
    var m = model, n = m.segCount, i, j;

    function addParam(u) {
      if (!isFinite(u)) return;
      if (m.closed) {
        u = ((u % n) + n) % n;
        if (n - u <= PARAM_EPS) u = 0;
      }
      out.push(u);
    }

    var csegs = segmentsOf(cutters);
    for (i = 0; i < n; i++) {
      var a = m.pts[i], b = m.pts[(i + 1) % m.pts.length];
      for (j = 0; j < csegs.length; j++) {
        var s = csegs[j];
        var den = cross(b[0] - a[0], b[1] - a[1], s.b[0] - s.a[0], s.b[1] - s.a[1]);
        if (Math.abs(den) < 1e-12) continue;
        var t1 = cross(s.a[0] - a[0], s.a[1] - a[1], s.b[0] - s.a[0], s.b[1] - s.a[1]) / den;
        var t2 = cross(s.a[0] - a[0], s.a[1] - a[1], b[0] - a[0], b[1] - a[1]) / den;
        if (t1 < -1e-9 || t1 > 1 + 1e-9 || t2 < -1e-9 || t2 > 1 + 1e-9) continue;
        addParam(i + clamp(t1, 0, 1));
      }
    }

    // Ujung bebas pemotong yang berhenti sedikit di depan rantai (T-junction).
    var chains = chainsOf(cutters);
    for (j = 0; j < chains.length; j++) {
      var c = chains[j];
      if (c.closed || !c.pts || c.pts.length < 2) continue;
      var ends = [pt(c.pts[0]), pt(c.pts[c.pts.length - 1])];
      for (var e = 0; e < ends.length; e++) {
        var p = ends[e];
        if (!p) continue;
        var best = null, bd = Infinity;
        for (i = 0; i < n; i++) {
          var q = nearestOnSeg(p, m.pts[i], m.pts[(i + 1) % m.pts.length]);
          if (q.d <= t + 1e-9 && q.d < bd) {
            bd = q.d;
            best = i + q.t;
          }
        }
        if (best !== null) addParam(best);
      }
    }

    out.sort(function (a, b) { return a - b; });
    var res = [];
    for (i = 0; i < out.length; i++) {
      if (!res.length || Math.abs(out[i] - res[res.length - 1]) > PARAM_EPS) res.push(out[i]);
    }
    if (m.closed && res.length > 1) {
      if (res[0] + n - res[res.length - 1] <= PARAM_EPS) res.pop();
    }
    return res;
  }

  /**
   * Rentang yang dibuang Trim, dalam parameter naik. Untuk rantai tertutup
   * rentang dapat melewati n (mis. 7..12). null bila tidak ada perpotongan.
   */
  function cadTrimRange(chain, cutters, px, py, tol) {
    if (!chain || !chain.pts) return null;
    var model = cadParamModel(chain.pts, !!chain.closed);
    if (!model) return null;
    var pick = model.paramAtPoint(px, py);
    if (!pick) return null;
    var cuts = cadCutParams(model, cutters, tol);
    if (!cuts.length) return null;
    var u = pick.u, lo = 0, hi = model.segCount, from, to;

    if (model.closed) {
      if (cuts.length < 2) return null;
      var below = -Infinity, above = Infinity;
      for (var i = 0; i < cuts.length; i++) {
        if (cuts[i] <= u + PARAM_EPS && cuts[i] > below) below = cuts[i];
        if (cuts[i] > u + PARAM_EPS && cuts[i] < above) above = cuts[i];
      }
      if (below === -Infinity) below = cuts[cuts.length - 1] - hi;
      if (above === Infinity) above = cuts[0] + hi;
      from = below;
      to = above;
    } else {
      var inside = cuts.filter(function (c) { return c > lo + PARAM_EPS && c < hi - PARAM_EPS; });
      if (!inside.length) return null;
      from = lo;
      to = hi;
      for (var k = 0; k < inside.length; k++) {
        if (inside[k] <= u + PARAM_EPS && inside[k] > from) from = inside[k];
        if (inside[k] > u + PARAM_EPS && inside[k] < to) to = inside[k];
      }
      if (from === lo && to === hi) return null;
    }
    return { model: model, u: u, from: from, to: to, cuts: cuts };
  }

  /**
   * Trim rantai pada titik klik. Mengembalikan bagian yang tersisa, atau null
   * bila tidak ada perpotongan (UI memperlakukan null sebagai hapus seluruh
   * rantai, mengikuti mode Quick AutoCAD).
   */
  function cadTrim(chain, cutters, px, py, tol) {
    var r = cadTrimRange(chain, cutters, px, py, tol);
    if (!r) return null;
    var model = r.model, add = [], p;
    if (model.closed) {
      p = model.piece(r.to, r.from + model.segCount);
      if (p) add.push(p);
    } else {
      if (r.from > PARAM_EPS) {
        p = model.piece(0, r.from);
        if (p) add.push(p);
      }
      if (r.to < model.segCount - PARAM_EPS) {
        p = model.piece(r.to, model.segCount);
        if (p) add.push(p);
      }
    }
    return { remove: true, add: add };
  }

  /**
   * Sinar origin + t*dir mencari ruas batas terdekat di depan origin.
   * Hasil pt berupa [x,y], t jarak, segIndex indeks ruas pada input.
   */
  function cadRayHit(origin, dir, segs, tol, maxExt) {
    var O = pt(origin), D0 = pt(dir);
    if (!O || !D0) return null;
    var dl = Math.hypot(D0[0], D0[1]);
    if (!(dl > EPS)) return null;
    var D = [D0[0] / dl, D0[1] / dl];
    var t = tol == null ? 1e-6 : Math.max(0, +tol || 0);
    var limit = maxExt == null ? Infinity : +maxExt;
    if (!isFinite(limit)) limit = Infinity;
    var S = segmentsOf(segs), best = null;
    for (var i = 0; i < S.length; i++) {
      var A = S[i].a, B = S[i].b;
      // Saring kotak batas: ruas yang seluruhnya di belakang sinar dilewati.
      if (D[0] > EPS && Math.max(A[0], B[0]) < O[0] - t) continue;
      if (D[0] < -EPS && Math.min(A[0], B[0]) > O[0] + t) continue;
      if (D[1] > EPS && Math.max(A[1], B[1]) < O[1] - t) continue;
      if (D[1] < -EPS && Math.min(A[1], B[1]) > O[1] + t) continue;

      var sx = B[0] - A[0], sy = B[1] - A[1];
      var den = cross(D[0], D[1], sx, sy);
      if (Math.abs(den) < 1e-12) {
        // Ruas sejajar: ujung yang berada di depan sinar dan dalam tol tetap
        // dianggap temu. Ini yang membuat sambungan lurus pada celah kecil
        // (dua ruas kolinear berhadapan) bisa ditutup tanpa mengubah arah.
        var ends = [A, B];
        for (var e = 0; e < 2; e++) {
          var ep = ends[e];
          var et = (ep[0] - O[0]) * D[0] + (ep[1] - O[1]) * D[1];
          if (et < 0 || et > limit) continue;
          var px = O[0] + D[0] * et, py = O[1] + D[1] * et;
          if (Math.hypot(ep[0] - px, ep[1] - py) > t + 1e-9) continue;
          if (!best || et < best.t) best = { pt: ep.slice(), t: et, segIndex: i };
        }
        continue;
      }
      var qx = A[0] - O[0], qy = A[1] - O[1];
      var tt = cross(qx, qy, sx, sy) / den;
      var uu = cross(qx, qy, D[0], D[1]) / den;
      if (tt < 0 || tt > limit) continue;
      var segLen = Math.hypot(sx, sy);
      var pad = segLen > EPS ? t / segLen : 0;
      if (uu < -pad || uu > 1 + pad) continue;
      var hit = [A[0] + sx * clamp(uu, 0, 1), A[1] + sy * clamp(uu, 0, 1)];
      // Ujung ruas yang disentuh dalam toleransi menghasilkan titik endpoint;
      // jarak t harus mengikuti titik final, bukan perpotongan garis maya.
      var dt = (hit[0] - O[0]) * D[0] + (hit[1] - O[1]) * D[1];
      if (dt < 0 || dt > limit) continue;
      if (!best || dt < best.t) best = { pt: hit, t: dt, segIndex: i };
    }
    return best;
  }

  /** Titik temu dua sinar ke depan, atau null bila sejajar/tidak bertemu. */
  function cadRayRayHit(o1, d1, o2, d2, tol) {
    var O1 = pt(o1), D1 = pt(d1), O2 = pt(o2), D2 = pt(d2);
    if (!O1 || !D1 || !O2 || !D2) return null;
    var l1 = Math.hypot(D1[0], D1[1]), l2 = Math.hypot(D2[0], D2[1]);
    if (!(l1 > EPS) || !(l2 > EPS)) return null;
    var A = [D1[0] / l1, D1[1] / l1], B = [D2[0] / l2, D2[1] / l2];
    var den = cross(A[0], A[1], B[0], B[1]);
    var e = tol == null ? 1e-6 : Math.max(0, +tol || 0);
    if (Math.abs(den) < 1e-12) return null;
    var qx = O2[0] - O1[0], qy = O2[1] - O1[1];
    var t1 = cross(qx, qy, B[0], B[1]) / den;
    var t2 = cross(qx, qy, A[0], A[1]) / den;
    if (t1 < -e || t2 < -e) return null;
    var tt1 = Math.max(0, t1), tt2 = Math.max(0, t2);
    var hit = [O1[0] + A[0] * tt1, O1[1] + A[1] * tt1];
    var check = [O2[0] + B[0] * tt2, O2[1] + B[1] * tt2];
    if (Math.hypot(hit[0] - check[0], hit[1] - check[1]) > e + 1e-9) return null;
    return { pt: hit, t1: tt1, t2: tt2 };
  }

  function angleBetween(a, b) {
    var la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    if (!(la > EPS) || !(lb > EPS)) return 0;
    return Math.acos(clamp((a[0] * b[0] + a[1] * b[1]) / (la * lb), -1, 1)) * 180 / Math.PI;
  }

  /** Arah ujung dari titik-titik sepanjang ~dirLen, bukan hanya segmen terakhir. */
  function cadExtendRay(chain, px, py, opts) {
    if (!chain || !chain.pts || chain.closed) return null;
    var model = cadParamModel(chain.pts, false);
    if (!model) return null;
    var pick = model.paramAtPoint(px, py);
    if (!pick) return null;
    var atEnd = model.lengthAt(pick.u) >= model.length / 2;
    var P = model.pts;
    var dirLen = opts && +opts.dirLen > 0 ? +opts.dirLen : 25;
    var end = atEnd ? P[P.length - 1] : P[0];
    var back = end, rem = dirLen, i;
    if (atEnd) {
      for (i = P.length - 2; i >= 0; i--) {
        var l = dist(P[i], P[i + 1]);
        if (rem <= l && l > EPS) {
          back = [P[i + 1][0] + (P[i][0] - P[i + 1][0]) * (rem / l), P[i + 1][1] + (P[i][1] - P[i + 1][1]) * (rem / l)];
          break;
        }
        rem -= l;
        back = P[i];
      }
    } else {
      for (i = 1; i < P.length; i++) {
        var l2 = dist(P[i - 1], P[i]);
        if (rem <= l2 && l2 > EPS) {
          back = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * (rem / l2), P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (rem / l2)];
          break;
        }
        rem -= l2;
        back = P[i];
      }
    }
    var dir = sub(end, back);
    if (!(Math.hypot(dir[0], dir[1]) > EPS)) {
      dir = atEnd ? sub(P[P.length - 1], P[P.length - 2]) : sub(P[0], P[1]);
    }
    var lastDir = atEnd ? sub(P[P.length - 1], P[P.length - 2]) : sub(P[0], P[1]);
    return {
      end: end.slice(),
      dir: dir,
      lastDir: lastDir,
      atEnd: atEnd,
      endIdx: atEnd ? P.length - 1 : 0,
      model: model,
      pick: pick
    };
  }

  /**
   * Perpanjang ujung terdekat ke batas. Arah dari ~dirLen px; selisih <3°
   * menggeser vertex ujung, selain itu menambah vertex di titik temu.
   */
  function cadExtend(chain, boundaries, px, py, opts) {
    if (!chain || !chain.pts || !boundaries) return null;
    var tol = opts && opts.tol != null ? Math.max(0, +opts.tol || 0) : 1e-6;
    var ray = cadExtendRay(chain, px, py, opts);
    if (!ray) return null;
    var hit = cadRayHit(ray.end, ray.dir, boundaries, tol, Infinity);
    if (!hit) return null;
    var mode = angleBetween(ray.dir, ray.lastDir) < 3 ? 'geser' : 'tambah';
    var out = chain.pts.map(function (p) { return [+p[0], +p[1]]; });
    if (mode === 'geser') {
      out[ray.endIdx] = hit.pt.slice();
    } else if (ray.atEnd) {
      out.push(hit.pt.slice());
    } else {
      out.unshift(hit.pt.slice());
    }
    return {
      pts: out,
      endIdx: ray.atEnd ? out.length - 1 : 0,
      mode: mode,
      hit: hit
    };
  }

  return {
    cadParamModel: cadParamModel,
    cadCutParams: cadCutParams,
    cadTrimRange: cadTrimRange,
    cadTrim: cadTrim,
    cadRayHit: cadRayHit,
    cadRayRayHit: cadRayRayHit,
    cadExtendRay: cadExtendRay,
    cadExtend: cadExtend,
    _internal: {
      segmentsOf: segmentsOf,
      chainsOf: chainsOf,
      nearestOnSeg: nearestOnSeg,
      angleBetween: angleBetween
    }
  };
});
