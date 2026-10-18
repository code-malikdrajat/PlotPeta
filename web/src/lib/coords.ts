export function num(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(",", ".");
  return Number.parseFloat(normalized);
}

export function solve3(A: number[][], b: number[]): number[] | null {
  const n = 3;
  const M = A.map((r, i) => [...r, b[i]]);

  for (let i = 0; i < n; i++) {
    let m = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k;
    }
    [M[i], M[m]] = [M[m], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;

    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        M[k][j] -= f * M[i][j];
      }
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

export function clean(value: unknown, max = 120): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

export function toLocalImageCoordinates(p: number[], imageHeight: number): number[] {
  return [p[0], imageHeight - p[1]];
}
