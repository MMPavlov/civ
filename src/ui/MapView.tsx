import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hexCenter, hexCorners, sharedEdge } from '../sim/hex';
import { cellTotal, cultureDiversity } from '../sim/pop';
import { NEUTRAL, SHARED, type GameMap, type SimState } from '../sim/types';
import { cloudColor, cultureColor } from './colors';
import { cellFill, isKnown, isVisibleNow, type Lens, type MapMode } from './mapModes';

const SIZE = 10;

interface Geometry {
  width: number;
  height: number;
  centers: Array<{ x: number; y: number }>;
  corners: Array<Array<{ x: number; y: number }>>;
  points: string[];
}

const geometryCache = new WeakMap<GameMap, Geometry>();

function geometry(map: GameMap): Geometry {
  let g = geometryCache.get(map);
  if (g) return g;
  const centers = map.hexes.map((h) => hexCenter(h.col, h.row, SIZE));
  const corners = centers.map((c) => hexCorners(c.x, c.y, SIZE));
  const points = corners.map((cs) => cs.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
  g = {
    width: Math.sqrt(3) * SIZE * (map.width + 0.5),
    height: SIZE * 1.5 * (map.height - 1) + SIZE * 2,
    centers,
    corners,
    points,
  };
  geometryCache.set(map, g);
  return g;
}

interface Props {
  state: SimState;
  version: number;
  mode: MapMode;
  lens: Lens;
  selectedHex: number;
  selectedCloud: number;
  onHover: (idx: number, x: number, y: number) => void;
  onSelect: (idx: number) => void;
}

export function MapView({ state, version, mode, lens, selectedHex, selectedCloud, onHover, onSelect }: Props) {
  const geo = geometry(state.map);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: geo.width, h: geo.height });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => setView({ x: 0, y: 0, w: geo.width, h: geo.height }), [geo]);

  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      const scale = Math.max(view.w / r.width, view.h / r.height);
      const offX = (r.width * scale - view.w) / 2;
      const offY = (r.height * scale - view.h) / 2;
      return { x: view.x - offX + (clientX - r.left) * scale, y: view.y - offY + (clientY - r.top) * scale, scale };
    },
    [view],
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toMap(e.clientX, e.clientY);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const w = Math.min(geo.width * 1.5, Math.max(geo.width / 8, v.w * k));
        const h = (w / v.w) * v.h;
        return { x: p.x - ((p.x - v.x) * w) / v.w, y: p.y - ((p.y - v.y) * h) / v.h, w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toMap, geo]);

  const cellAt = (target: EventTarget | null): number => {
    const el = target as Element | null;
    const v = el?.getAttribute?.('data-idx');
    return v === null || v === undefined ? -1 : Number(v);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && (e.buttons & 1) === 1) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        const { scale } = toMap(e.clientX, e.clientY);
        setView((v) => ({ ...v, x: d.vx - dx * scale, y: d.vy - dy * scale }));
        return;
      }
    }
    const idx = cellAt(document.elementFromPoint(e.clientX, e.clientY));
    onHover(idx, e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const idx = cellAt(document.elementFromPoint(e.clientX, e.clientY));
      if (idx >= 0) onSelect(idx);
    }
  };

  const zoomBy = (k: number) =>
    setView((v) => {
      const w = Math.min(geo.width * 1.5, Math.max(geo.width / 8, v.w * k));
      const h = (w / v.w) * v.h;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => onHover(-1, 0, 0)}
        role="img"
        aria-label="Гексагональная карта симуляции"
      >
        <defs>
          <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="#e34948" strokeWidth="1.4" />
          </pattern>
          <pattern id="stripe" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="#52514e" strokeWidth="1" opacity="0.55" />
          </pattern>
        </defs>
        <HexLayer state={state} version={version} mode={mode} lens={lens} geo={geo} />
        <Rivers state={state} geo={geo} lens={lens} />
        <Overlays state={state} version={version} mode={mode} lens={lens} geo={geo} selectedCloud={selectedCloud} />
        {selectedHex >= 0 && (
          <polygon points={geo.points[selectedHex]} fill="none" stroke="#0b0b0b" strokeWidth={1.8} pointerEvents="none" />
        )}
      </svg>
      <div className="map-zoom">
        <button onClick={() => zoomBy(1 / 1.3)} aria-label="Приблизить">+</button>
        <button onClick={() => zoomBy(1.3)} aria-label="Отдалить">−</button>
        <button onClick={() => setView({ x: 0, y: 0, w: geo.width, h: geo.height })} aria-label="Вся карта">⤢</button>
      </div>
    </div>
  );
}

const HexLayer = memo(function HexLayer({ state, mode, lens, geo }: { state: SimState; version: number; mode: MapMode; lens: Lens; geo: Geometry }) {
  return (
    <g>
      {state.map.hexes.map((h) => (
        <polygon key={h.idx} data-idx={h.idx} points={geo.points[h.idx]} fill={cellFill(state, mode, h.idx, lens)} stroke="rgba(0,0,0,0.08)" strokeWidth={0.4} />
      ))}
    </g>
  );
});

const Rivers = memo(function Rivers({ state, geo, lens }: { state: SimState; geo: Geometry; lens: Lens }) {
  const lines = useMemo(
    () =>
      state.map.hexes
        .filter((h) => h.river > 0 && h.riverTo >= 0)
        .map((h) => ({ from: h.idx, to: h.riverTo, w: Math.min(3, 0.8 + Math.log1p(h.river) * 0.5) })),
    [state.map],
  );
  return (
    <g pointerEvents="none">
      {lines
        .filter((l) => isKnown(lens, l.from))
        .map((l) => (
          <line key={l.from} x1={geo.centers[l.from].x} y1={geo.centers[l.from].y} x2={geo.centers[l.to].x} y2={geo.centers[l.to].y}
            stroke="#3f7fbf" strokeWidth={l.w} strokeLinecap="round" opacity={0.85} />
        ))}
    </g>
  );
});

const Overlays = memo(function Overlays({ state, mode, lens, geo, selectedCloud }: { state: SimState; version: number; mode: MapMode; lens: Lens; geo: Geometry; selectedCloud: number }) {
  const items: React.ReactNode[] = [];
  const n = state.map.hexes.length;

  // Mixed-cell indicator (clouds mode) and composition pies (mixed mode).
  if (mode === 'clouds' || mode === 'mixed') {
    for (let i = 0; i < n; i++) {
      if (!isVisibleNow(lens, i)) continue;
      const cell = state.cells[i];
      if (cell.groups.length < 2) continue;
      const d = cultureDiversity(cell);
      if (d < 0.35) continue;
      const c = geo.centers[i];
      if (mode === 'clouds') {
        items.push(<circle key={`m${i}`} cx={c.x} cy={c.y} r={1 + d * 2.2} fill="#fcfcfb" stroke="#0b0b0b" strokeWidth={0.5} opacity={0.9} />);
      } else {
        const total = cellTotal(cell);
        let a0 = -Math.PI / 2;
        cell.groups.forEach((g, k) => {
          const frac = (g.rural + g.urban) / total;
          const a1 = a0 + frac * Math.PI * 2;
          const r = 5.5;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const path = frac > 0.999
            ? `M ${c.x - r} ${c.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
            : `M ${c.x} ${c.y} L ${c.x + r * Math.cos(a0)} ${c.y + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${c.x + r * Math.cos(a1)} ${c.y + r * Math.sin(a1)} Z`;
          items.push(<path key={`p${i}-${k}`} d={path} fill={cultureColor(state, g.culture)} stroke="#fcfcfb" strokeWidth={0.6} />);
          a0 = a1;
        });
      }
    }
  }

  // Disputed cells.
  if (mode === 'claims') {
    for (let i = 0; i < n; i++) {
      if (state.politics.disputed[i] && isVisibleNow(lens, i)) items.push(<polygon key={`d${i}`} points={geo.points[i]} fill="url(#hatch)" />);
    }
  }

  // Recognised borders and special regimes.
  if (mode === 'borders' || mode === 'claims') {
    const rec = state.politics.recognized;
    for (let i = 0; i < n; i++) {
      if (rec[i] === SHARED && mode === 'borders') items.push(<polygon key={`s${i}`} points={geo.points[i]} fill="url(#stripe)" />);
    }
    if (mode === 'borders') {
      const h = state.map.hexes;
      for (let i = 0; i < n; i++) {
        if (!isKnown(lens, i)) continue;
        const ri = rec[i];
        for (const j of neighborsOf(state, i)) {
          if (j < i) continue;
          const rj = rec[j];
          if (ri === rj) continue;
          if (ri === -1 && rj === -1) continue;
          const e = sharedEdge(h[i], h[j]);
          if (e < 0) continue;
          const a = geo.corners[i][e];
          const b = geo.corners[i][(e + 1) % 6];
          const between = ri >= 0 && rj >= 0;
          items.push(<line key={`b${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={between ? '#0b0b0b' : '#52514e'}
            strokeWidth={between ? 1.8 : 1} strokeDasharray={ri === NEUTRAL || rj === NEUTRAL ? '2 1.5' : undefined} strokeLinecap="round" />);
        }
      }
    }
  }

  // Cells of the selected cloud.
  if (selectedCloud >= 0 && state.clouds[selectedCloud]?.alive) {
    for (let i = 0; i < n; i++) {
      if (!isVisibleNow(lens, i)) continue;
      if (state.cells[i].groups.some((g) => g.cloud === selectedCloud && g.rural + g.urban >= 1)) {
        items.push(<polygon key={`c${i}`} points={geo.points[i]} fill="none" stroke={cloudColor(state, selectedCloud)} strokeWidth={1.3} />);
      }
    }
  }

  // Settlements.
  const showLabels = mode === 'settlements' || mode === 'borders' || mode === 'claims';
  for (const s of state.settlements) {
    if (!s.alive || !isKnown(lens, s.hex)) continue;
    const c = geo.centers[s.hex];
    const col = cloudColor(state, s.cloud);
    const isCapital = state.polities.some((p) => p.alive && p.capital === s.id);
    if (s.level === 1) items.push(<circle key={`v${s.id}`} cx={c.x} cy={c.y} r={2.1} fill={col} stroke="#fcfcfb" strokeWidth={0.8} />);
    else if (s.level === 2) items.push(<rect key={`t${s.id}`} x={c.x - 3} y={c.y - 3} width={6} height={6} rx={1} fill={col} stroke="#fcfcfb" strokeWidth={0.9} />);
    else items.push(<path key={`c${s.id}`} d={starPath(c.x, c.y, 5.2, 2.3)} fill={col} stroke="#fcfcfb" strokeWidth={0.9} />);
    if (isCapital) items.push(<circle key={`k${s.id}`} cx={c.x} cy={c.y} r={7} fill="none" stroke="#0b0b0b" strokeWidth={0.8} />);
    if (s.level === 3 || (showLabels && s.level === 2)) {
      items.push(
        <text key={`l${s.id}`} x={c.x} y={c.y - 6.5} textAnchor="middle" className="map-label">{s.name}</text>,
      );
    }
  }
  return <g pointerEvents="none">{items}</g>;
});

function neighborsOf(state: SimState, i: number): number[] {
  const h = state.map.hexes[i];
  const W = state.map.width;
  const H = state.map.height;
  const out: number[] = [];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const [dq, dr] of dirs) {
    const q = h.q + dq;
    const r = h.r + dr;
    const col = q + (r - (r & 1)) / 2;
    if (col >= 0 && col < W && r >= 0 && r < H) out.push(r * W + col);
  }
  return out;
}

function starPath(cx: number, cy: number, R: number, r: number): string {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    d += `${k === 0 ? 'M' : 'L'} ${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)} `;
  }
  return d + 'Z';
}
