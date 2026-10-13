import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import uPlot, { type AlignedData, type Options } from 'uplot';
import { useTheme } from '../app/theme';

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface LineSeries {
  label: string;
  values: Array<number | null>;
  /** Variable CSS de color (p. ej. --data-hr). */
  colorVar: string;
  fill?: boolean;
  format: (v: number) => string;
  /** Invertir eje (ritmo: menor es mejor). */
  invert?: boolean;
}

/**
 * Gráfico de líneas sobre uPlot (canvas): fluido con miles de puntos.
 * `syncKey` sincroniza el cursor entre gráficos; `onCursor` informa del índice bajo el puntero.
 */
export function LineChart({ x, series: seriesProp, height = 160, xFormat, syncKey, onCursor, title, right }: {
  x: number[];
  series: LineSeries | LineSeries[];
  height?: number;
  xFormat: (v: number) => string;
  syncKey?: string;
  onCursor?: (idx: number | null) => void;
  title: string;
  right?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const { theme } = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  const cb = useRef(onCursor);
  cb.current = onCursor;

  const list = useMemo(() => (Array.isArray(seriesProp) ? seriesProp : [seriesProp]), [seriesProp]);
  const series = list[0]!;
  const data = useMemo<AlignedData>(() => [x, ...list.map((s) => s.values.map((v) => (v == null ? null : s.invert ? -v : v)))] as AlignedData, [x, list]);

  useEffect(() => {
    if (!el.current) return;
    const color = cssVar(series.colorVar, '#0c9c85');
    const grid = cssVar('--border', '#e2e5ea');
    const axis = cssVar('--text-3', '#7c8591');
    const opts: Options = {
      width: el.current.clientWidth,
      height,
      padding: [8, 4, 0, 0],
      legend: { show: false },
      cursor: {
        sync: syncKey ? { key: syncKey } : undefined,
        points: { size: 8, fill: color, stroke: cssVar('--surface', '#fff') },
        drag: { x: false, y: false },
      },
      scales: { x: { time: false } },
      axes: [
        { stroke: axis, grid: { show: false }, ticks: { show: false }, values: (_u, vals) => vals.map((v) => xFormat(v)), font: '11px Inter Variable, sans-serif', size: 28 },
        {
          stroke: axis,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          values: (_u, vals) => vals.map((v) => series.format(series.invert ? -v : v)),
          font: '11px Inter Variable, sans-serif',
          size: 56,
        },
      ],
      series: [
        {},
        ...list.map((s) => {
          const c = cssVar(s.colorVar, '#0c9c85');
          return { stroke: c, width: 2, fill: s.fill ? `${c}22` : undefined, spanGaps: false, points: { show: false } };
        }),
      ],
      hooks: {
        setCursor: [(u) => {
          const i = u.cursor.idx ?? null;
          setHover(i);
          cb.current?.(i);
        }],
      },
    };
    const p = new uPlot(opts, data, el.current);
    plot.current = p;
    const ro = new ResizeObserver(() => p.setSize({ width: el.current!.clientWidth, height }));
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      p.destroy();
      plot.current = null;
    };
  }, [data, theme, height, syncKey, list, series, xFormat]);

  const hovered = hover != null ? list.map((s) => (s.values[hover] != null ? `${list.length > 1 ? `${s.label} ` : ''}${s.format(s.values[hover]!)}` : null)).filter(Boolean) : [];
  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="chart__title">{title}</span>
        <span className="chart__value num">{hovered.length ? `${hovered.join(' · ')} · ${xFormat(x[hover!]!)}` : right}</span>
      </figcaption>
      <div ref={el} className="chart__plot" role="img" aria-label={`Gráfico de ${title.toLowerCase()}`} />
    </figure>
  );
}

/** Barras simples (SVG) para resúmenes por periodo. Accesibles y nítidas en ambos temas. */
export function BarChart({ data, format, height = 160, highlightLast = true, label }: {
  data: Array<{ key: string; label: string; short?: string; value: number }>;
  format: (v: number) => string;
  height?: number;
  highlightLast?: boolean;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? (highlightLast ? data.length - 1 : null);
  return (
    <figure className="bars" aria-label={label}>
      <div className="bars__value num">
        {shown != null && data[shown] ? <><strong>{format(data[shown]!.value)}</strong> <span className="subtle">{data[shown]!.label}</span></> : null}
      </div>
      <div className="bars__plot" style={{ height }}>
        {data.map((d, i) => (
          <button
            type="button"
            key={d.key}
            className={['bars__bar', i === shown && 'is-active'].filter(Boolean).join(' ')}
            style={{ ['--h' as string]: `${Math.max(2, (d.value / max) * 100)}%` }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            aria-label={`${d.label}: ${format(d.value)}`}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="bars__axis">
        {data.map((d, i) => (
          <span key={d.key} className="xs subtle">{data.length <= 12 || i % Math.ceil(data.length / 8) === 0 ? (d.short ?? d.label) : ''}</span>
        ))}
      </div>
    </figure>
  );
}
