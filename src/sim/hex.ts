/**
 * Hex grid geometry. Storage is a rectangular "odd-r" offset grid (pointy-top
 * hexes, odd rows shifted right); all distance and adjacency math is done in
 * axial coordinates (q, r).
 */

export interface Axial {
  q: number;
  r: number;
}

export const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function indexOf(col: number, row: number, width: number): number {
  return row * width + col;
}

/** Neighbour indices of every cell (only cells inside the rectangle). */
export function buildNeighbors(width: number, height: number): number[][] {
  const result: number[][] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const { q, r } = offsetToAxial(col, row);
      const list: number[] = [];
      for (const d of AXIAL_DIRECTIONS) {
        const o = axialToOffset(q + d.q, r + d.r);
        if (o.col >= 0 && o.col < width && o.row >= 0 && o.row < height) {
          list.push(indexOf(o.col, o.row, width));
        }
      }
      result.push(list);
    }
  }
  return result;
}

/** Pixel centre of a pointy-top hex of the given circumradius. */
export function hexCenter(col: number, row: number, size: number): { x: number; y: number } {
  const w = Math.sqrt(3) * size;
  return {
    x: w * (col + 0.5 * (row & 1)) + w / 2,
    y: size * 1.5 * row + size,
  };
}

export function hexCorners(cx: number, cy: number, size: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return pts;
}

/**
 * Index (0..5) of the corner pair shared with the neighbour in a given axial
 * direction; used to draw borders and rivers between two cells.
 */
export function sharedEdge(a: Axial, b: Axial): number {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  // Directions listed counter-clockwise starting East; corner i spans angle 60*i-30.
  if (dq === 1 && dr === 0) return 0; // E   -> corners 0,1
  if (dq === 0 && dr === 1) return 1; // SE  -> corners 1,2
  if (dq === -1 && dr === 1) return 2; // SW -> corners 2,3
  if (dq === -1 && dr === 0) return 3; // W  -> corners 3,4
  if (dq === 0 && dr === -1) return 4; // NW -> corners 4,5
  if (dq === 1 && dr === -1) return 5; // NE -> corners 5,0
  return -1;
}
