// Line diff (Myers O(ND)) without dependencies. Returns the lines that exist only on one side,
// each in its original order — enough to tell identical / superset / FORK apart.

export type LineDiff = { onlyA: string[]; onlyB: string[] };

export function diffLines(a: string[], b: string[]): LineDiff {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  trace.push(v.slice());

  // Backtrack to mark lines that are not part of the common subsequence.
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; keepA[x] = 1; keepB[y] = 1; }
    if (d === 0) break;
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) { x--; y--; keepA[x] = 1; keepB[y] = 1; }

  return {
    onlyA: a.filter((_, i) => !keepA[i]),
    onlyB: b.filter((_, i) => !keepB[i]),
  };
}
