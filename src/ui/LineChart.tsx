import { useMemo, useRef, useState } from 'react';

export interface Series {
  id: string;
  name: string;
  color: string;
  values: Array<number | null>;
}

interface Props {
  title: string;
  x: number[];
  series: Series[];
  format?: (v: number) => string;
  height?: number;
  yMax?: number;
}

const W = 380;
const BASE_PAD = { l: 40, r: 14, t: 8, b: 20 };

/**
 * Small SVG line chart: 2px lines, hairline grid, one shared y-axis, a
 * crosshair that snaps to the nearest turn with a tooltip listing every
 * series, a legend for ≥2 series, end labels for ≤4 and a table view.
 */
export function LineChart({ title, x, series, format = (v) => fmt(v), height = 150, yMax }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const H = height;
  const direct = series.length >= 2 && series.length <= 4;
  const PAD = { ...BASE_PAD, r: direct ? 78 : BASE_PAD.r };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const { xMin, xMax, top } = useMemo(() => {
    let m = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > m) m = v;
    const top = yMax ?? niceCeil(m || 1);
    return { xMin: x[0] ?? 0, xMax: x[x.length - 1] ?? 1, top };
  }, [x, series, yMax]);

  const sx = (t: number) => PAD.l + (xMax > xMin ? ((t - xMin) / (xMax - xMin)) * innerW : 0);
  const sy = (v: number) => PAD.t + innerH - (v / top) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * top);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (!x.length) return;
    const t = xMin + ((px - PAD.l) / innerW) * (xMax - xMin);
    let best = 0;
    for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - t) < Math.abs(x[best] - t)) best = i;
    setHover(best);
  };

  const ends = direct ? endLabels(series, sy, PAD.t, PAD.t + innerH) : [];

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <button className="link" onClick={() => setTable((v) => !v)}>{table ? 'график' : 'таблица'}</button>
      </figcaption>
      {table ? (
        <ChartTable x={x} series={series} format={format} />
      ) : (
        <div className="chart-plot">
          <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title}>
            {ticks.map((v, i) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'axis' : 'grid'} />
                {i % 2 === 0 && <text x={PAD.l - 5} y={sy(v) + 3} textAnchor="end" className="tick">{format(v)}</text>}
              </g>
            ))}
            {[xMin, Math.round((xMin + xMax) / 2), xMax].map((t, i) => (
              <text key={i} x={sx(t)} y={H - 5} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="tick">{t}</text>
            ))}
            {series.map((s) => (
              <path key={s.id} d={linePath(x, s.values, sx, sy)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {ends.map((e) => (
              <g key={e.id}>
                <circle cx={W - PAD.r + 6} cy={e.y} r={3} fill={e.color} />
                <text x={W - PAD.r + 12} y={e.y + 3} className="end-label">{e.name}</text>
              </g>
            ))}
            {hover !== null && (
              <g>
                <line x1={sx(x[hover])} x2={sx(x[hover])} y1={PAD.t} y2={PAD.t + innerH} className="crosshair" />
                {series.map((s) => {
                  const v = s.values[hover];
                  return v === null || v === undefined ? null : (
                    <circle key={s.id} cx={sx(x[hover])} cy={sy(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  );
                })}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${(sx(x[hover]) / W) * 100}%` }}>
              <div className="tip-title">Ход {x[hover]}</div>
              {series
                .map((s) => ({ s, v: s.values[hover] }))
                .filter((r) => r.v !== null && r.v !== undefined)
                .sort((a, b) => (b.v as number) - (a.v as number))
                .slice(0, 10)
                .map(({ s, v }) => (
                  <div key={s.id} className="tip-row">
                    <i style={{ background: s.color }} />
                    <span>{s.name}</span>
                    <b>{format(v as number)}</b>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.id}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

function ChartTable({ x, series, format }: { x: number[]; series: Series[]; format: (v: number) => string }) {
  const step = Math.max(1, Math.ceil(x.length / 12));
  const rows = x.map((t, i) => ({ t, i })).filter(({ i }) => i % step === 0 || i === x.length - 1);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Ход</th>
            {series.map((s) => <th key={s.id}>{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, i }) => (
            <tr key={t}>
              <td>{t}</td>
              {series.map((s) => <td key={s.id}>{s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i] as number)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function linePath(x: number[], values: Array<number | null>, sx: (t: number) => number, sy: (v: number) => number): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < x.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** End labels at each series' last value, pushed apart so they never overlap. */
function endLabels(series: Series[], sy: (v: number) => number, top: number, bottom: number) {
  const labels = series
    .map((s) => {
      const last = [...s.values].reverse().find((v) => v !== null && v !== undefined);
      return last === undefined || last === null ? null : { id: s.id, name: s.name.length > 11 ? s.name.slice(0, 10) + '…' : s.name, color: s.color, y: sy(last) };
    })
    .filter((v): v is { id: string; name: string; color: string; y: number } => v !== null)
    .sort((a, b) => a.y - b.y);
  const gap = 11;
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
  const overflow = labels.length ? labels[labels.length - 1].y - bottom : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;
  for (const l of labels) l.y = Math.max(top + 3, l.y);
  return labels;
}

function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const n = steps.find((s) => m <= s) ?? 10;
  return n * p;
}

export function fmt(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 10 || v === 0) return v.toFixed(0);
  return v.toFixed(2);
}
