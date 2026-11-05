import { useId, useState } from 'react';
import type { Point } from './actions';

const W = 340;
const H = 170;
const PAD = { top: 14, right: 12, bottom: 24, left: 34 };

function dayNum(d: string) {
  return new Date(`${d}T00:00:00Z`).getTime() / 86_400_000;
}

/** Gráfico de línea liviano en SVG (sin librerías, funciona sin conexión). */
export function LineChart({ points, unit, target, label }: { points: Point[]; unit: string; target?: number | null; label: string }) {
  const gid = useId();
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return null;

  const xs = points.map((p) => dayNum(p.date));
  const ys = points.map((p) => p.value);
  const yVals = target ? [...ys, target] : ys;
  let yMin = Math.min(...yVals);
  let yMax = Math.max(...yVals);
  const pad = Math.max(0.5, (yMax - yMin) * 0.15);
  yMin -= pad;
  yMax += pad;
  const xMin = xs[0]!;
  const xMax = Math.max(xs[xs.length - 1]!, xMin + 1);
  const x = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(xs[i]!).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(xs[xs.length - 1]!).toFixed(1)},${H - PAD.bottom} L${x(xs[0]!).toFixed(1)},${H - PAD.bottom} Z`;
  const ticks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  const fmt = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const shortDate = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  const sel = active !== null ? points[active] : points[points.length - 1];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${label}: ${points.length} registros, de ${fmt(ys[0]!)} a ${fmt(ys[ys.length - 1]!)} ${unit}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          xs.forEach((v, i) => {
            if (Math.abs(x(v) - px) < Math.abs(x(xs[best]!) - px)) best = i;
          });
          setActive(best);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--c-accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--c-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--c-line)" strokeDasharray="2 4" />
            <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--c-faint)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {target && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--c-ok)" strokeDasharray="5 4" />
            <text x={W - PAD.right} y={y(target) - 4} textAnchor="end" fontSize="10" fill="var(--c-ok)">
              objetivo {fmt(target)}
            </text>
          </g>
        )}
        {points.length > 1 && <path d={area} fill={`url(#${gid})`} />}
        {points.length > 1 && <path d={path} fill="none" stroke="var(--c-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <circle key={p.date} cx={x(xs[i]!)} cy={y(p.value)} r={active === i ? 5 : points.length > 30 ? 0 : 3} fill="var(--c-accent)" stroke="var(--c-bg)" strokeWidth="1.5" />
        ))}
        <text x={PAD.left} y={H - 6} fontSize="10" fill="var(--c-faint)">
          {shortDate(points[0]!.date)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="10" fill="var(--c-faint)">
          {shortDate(points[points.length - 1]!.date)}
        </text>
      </svg>
      {sel && (
        <figcaption className="num mt-1 text-center text-[13px] text-muted">
          {shortDate(sel.date)}: <span className="font-semibold text-ink">{fmt(sel.value)} {unit}</span>
        </figcaption>
      )}
    </figure>
  );
}
