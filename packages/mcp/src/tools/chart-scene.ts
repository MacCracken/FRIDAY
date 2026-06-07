/**
 * Chart Scene — SVG Chart Rendering Engine (Phase 125)
 *
 * Pure functions for generating SVG charts server-side.
 * No DOM, no external dependencies. Parallels excalidraw-scene.ts.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const DEFAULT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
];

// ─── Scale Helpers ──────────────────────────────────────────────────────────

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const fn = (value: number): number => {
    if (domain[1] === domain[0]) return (range[0] + range[1]) / 2;
    const t = (value - domain[0]) / (domain[1] - domain[0]);
    return range[0] + t * (range[1] - range[0]);
  };
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export interface BandScale {
  (label: string): number;
  bandwidth: number;
  labels: string[];
}

export function bandScale(labels: string[], range: [number, number], padding = 0.1): BandScale {
  const total = range[1] - range[0];
  const n = labels.length || 1;
  const step = total / n;
  const bw = step * (1 - padding);
  const offset = (step - bw) / 2;
  const map = new Map(labels.map((l, i) => [l, range[0] + i * step + offset]));
  const fn = (label: string): number => map.get(label) ?? range[0];
  fn.bandwidth = bw;
  fn.labels = labels;
  return fn;
}

/** Generate ~5-8 nice tick values spanning a domain. */
function niceTicks(lo: number, hi: number, count = 6): number[] {
  if (lo === hi) return [lo];
  const range = hi - lo;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10;
  const step = nice * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e10) / 1e10);
  return ticks;
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

// ─── Shared Config ──────────────────────────────────────────────────────────

export interface ChartConfig {
  width?: number;
  height?: number;
  title?: string;
  darkMode?: boolean;
  padding?: { top: number; right: number; bottom: number; left: number };
  colors?: string[];
  gridLines?: boolean;
  showLegend?: boolean;
}

const DEFAULT_PADDING = { top: 40, right: 20, bottom: 50, left: 60 };

function resolveConfig(cfg?: ChartConfig) {
  const w = cfg?.width ?? 800;
  const h = cfg?.height ?? 500;
  const pad = cfg?.padding ?? DEFAULT_PADDING;
  const dark = cfg?.darkMode ?? false;
  const colors = cfg?.colors ?? DEFAULT_COLORS;
  const fg = dark ? '#e5e7eb' : '#374151';
  const bg = dark ? '#1f2937' : '#ffffff';
  const grid = dark ? '#374151' : '#e5e7eb';
  return {
    w,
    h,
    pad,
    dark,
    colors,
    fg,
    bg,
    grid,
    showLegend: cfg?.showLegend ?? true,
    gridLines: cfg?.gridLines ?? true,
    title: cfg?.title,
  };
}

// ─── SVG Fragment Builders ──────────────────────────────────────────────────

function svgOpen(w: number, h: number, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="font-family:system-ui,-apple-system,sans-serif"><rect width="${w}" height="${h}" fill="${bg}"/>`;
}

function svgTitle(text: string | undefined, w: number, fg: string): string {
  if (!text) return '';
  return `<text x="${w / 2}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="${fg}">${escapeXml(text)}</text>`;
}

function svgYAxis(ticks: number[], scale: LinearScale, x: number, fg: string): string {
  return ticks
    .map((v) => {
      const y = scale(v);
      return `<text x="${x - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="${fg}">${formatTick(v)}</text>`;
    })
    .join('');
}

function svgGridH(
  ticks: number[],
  scale: LinearScale,
  x0: number,
  x1: number,
  gridColor: string
): string {
  return ticks
    .map(
      (v) =>
        `<line x1="${x0}" y1="${scale(v)}" x2="${x1}" y2="${scale(v)}" stroke="${gridColor}" stroke-dasharray="3 3" opacity="0.5"/>`
    )
    .join('');
}

function svgLegend(
  items: { name: string; color: string }[],
  x: number,
  y: number,
  fg: string
): string {
  if (items.length <= 1) return '';
  return items
    .map((it, i) => {
      const lx = x + i * 120;
      return `<rect x="${lx}" y="${y}" width="12" height="12" rx="2" fill="${it.color}"/><text x="${lx + 16}" y="${y + 10}" font-size="11" fill="${fg}">${escapeXml(it.name)}</text>`;
    })
    .join('');
}

// ─── OhlcvBar type ──────────────────────────────────────────────────────────

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Candlestick ────────────────────────────────────────────────────────────

export interface CandlestickConfig extends ChartConfig {
  movingAverages?: { period: number; color?: string }[];
  showVolume?: boolean;
}

function computeSMA(data: OhlcvBar[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j]!.close;
    result.push(sum / period);
  }
  return result;
}

export function renderCandlestick(data: OhlcvBar[], cfg?: CandlestickConfig): string {
  if (!data.length) return emptySvg(cfg);
  const { w, h, pad, dark: _dark, colors: _colors, fg, bg, grid, title } = resolveConfig(cfg);
  const showVol = cfg?.showVolume ?? false;

  const priceBot = showVol ? pad.bottom + (h - pad.top - pad.bottom) * 0.2 : pad.bottom;
  const plotTop = pad.top + (title ? 10 : 0);
  const plotBot = h - priceBot;
  const plotLeft = pad.left;
  const plotRight = w - pad.right;

  const allHigh = Math.max(...data.map((d) => d.high));
  const allLow = Math.min(...data.map((d) => d.low));
  const pricePad = (allHigh - allLow) * 0.05 || 1;
  const yScale = linearScale([allLow - pricePad, allHigh + pricePad], [plotBot, plotTop]);
  const xBand = bandScale(
    data.map((d) => d.date),
    [plotLeft, plotRight],
    0.2
  );
  const candleW = Math.max(1, xBand.bandwidth);

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];

  // Grid
  const ticks = niceTicks(allLow - pricePad, allHigh + pricePad);
  parts.push(svgGridH(ticks, yScale, plotLeft, plotRight, grid));
  parts.push(svgYAxis(ticks, yScale, plotLeft, fg));

  // Candles
  for (const bar of data) {
    const x = xBand(bar.date);
    const cx = x + candleW / 2;
    const isUp = bar.close >= bar.open;
    const color = isUp ? '#22c55e' : '#ef4444';
    const bodyTop = yScale(Math.max(bar.open, bar.close));
    const bodyBot = yScale(Math.min(bar.open, bar.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    // Wick
    parts.push(
      `<line x1="${cx}" y1="${yScale(bar.high)}" x2="${cx}" y2="${yScale(bar.low)}" stroke="${color}" stroke-width="1"/>`
    );
    // Body
    parts.push(
      `<rect x="${x}" y="${bodyTop}" width="${candleW}" height="${bodyH}" fill="${color}" rx="1"/>`
    );
  }

  // Moving averages
  if (cfg?.movingAverages) {
    const maColors = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];
    cfg.movingAverages.forEach((ma, mi) => {
      const sma = computeSMA(data, ma.period);
      const pts = sma
        .map((v, i) => (v !== null ? `${xBand(data[i]!.date) + candleW / 2},${yScale(v)}` : null))
        .filter(Boolean);
      if (pts.length > 1) {
        const col = ma.color ?? maColors[mi % maColors.length];
        parts.push(
          `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.5" opacity="0.8"/>`
        );
      }
    });
  }

  // Volume
  if (showVol) {
    const volTop = h - pad.bottom;
    const volBot = h - priceBot + 4;
    const maxVol = Math.max(...data.map((d) => d.volume ?? 0)) || 1;
    const vScale = linearScale([0, maxVol], [volTop, volBot]);
    for (const bar of data) {
      if (!bar.volume) continue;
      const x = xBand(bar.date);
      const vy = vScale(bar.volume);
      const vh = volTop - vy;
      const color = bar.close >= bar.open ? hexToRgba('#22c55e', 0.4) : hexToRgba('#ef4444', 0.4);
      parts.push(`<rect x="${x}" y="${vy}" width="${candleW}" height="${vh}" fill="${color}"/>`);
    }
  }

  // X-axis labels (show subset to avoid overlap)
  const labelStep = Math.max(1, Math.floor(data.length / 10));
  for (let i = 0; i < data.length; i += labelStep) {
    const bar = data[i]!;
    const x = xBand(bar.date) + candleW / 2;
    parts.push(
      `<text x="${x}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="9" fill="${fg}">${escapeXml(bar.date)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Line Chart ─────────────────────────────────────────────────────────────

export interface LineSeriesInput {
  name: string;
  data: { x: number | string; y: number }[];
  color?: string;
}

export function renderLineChart(series: LineSeriesInput[], cfg?: ChartConfig): string {
  if (!series.length || !series.some((s) => s.data.length)) return emptySvg(cfg);
  const {
    w,
    h,
    pad,
    dark: _dark,
    colors,
    fg,
    bg,
    grid,
    showLegend,
    gridLines,
    title,
  } = resolveConfig(cfg);
  const plotTop = pad.top + (title ? 10 : 0);
  const plotBot = h - pad.bottom;
  const plotLeft = pad.left;
  const plotRight = w - pad.right;

  // Determine if x is numeric or categorical
  const allX = series.flatMap((s) => s.data.map((d) => d.x));
  const isNumeric = allX.every((v) => typeof v === 'number');

  let xFn: (v: number | string) => number;
  let xLabels: string[];

  if (isNumeric) {
    const nums = allX;
    const xMin = Math.min(...nums);
    const xMax = Math.max(...nums);
    const xs = linearScale([xMin, xMax], [plotLeft, plotRight]);
    xFn = (v) => xs(v as number);
    xLabels = niceTicks(xMin, xMax).map((v) => formatTick(v));
  } else {
    const unique = [...new Set(allX.map(String))];
    const bs = bandScale(unique, [plotLeft, plotRight], 0);
    xFn = (v) => bs(String(v)) + bs.bandwidth / 2;
    xLabels = unique;
  }

  const allY = series.flatMap((s) => s.data.map((d) => d.y));
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const yPad = (yMax - yMin) * 0.05 || 1;
  const yScale = linearScale([yMin - yPad, yMax + yPad], [plotBot, plotTop]);
  const yTicks = niceTicks(yMin - yPad, yMax + yPad);

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];
  if (gridLines) parts.push(svgGridH(yTicks, yScale, plotLeft, plotRight, grid));
  parts.push(svgYAxis(yTicks, yScale, plotLeft, fg));

  // X labels
  const xStep = Math.max(1, Math.floor(xLabels.length / 10));
  if (isNumeric) {
    const numTicks = niceTicks(Math.min(...allX), Math.max(...allX));
    for (const t of numTicks) {
      const xPos = xFn(t);
      parts.push(
        `<text x="${xPos}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="10" fill="${fg}">${formatTick(t)}</text>`
      );
    }
  } else {
    const bs = bandScale(xLabels, [plotLeft, plotRight], 0);
    for (let i = 0; i < xLabels.length; i += xStep) {
      const label = xLabels[i]!;
      const xPos = bs(label) + bs.bandwidth / 2;
      parts.push(
        `<text x="${xPos}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="10" fill="${fg}">${escapeXml(label)}</text>`
      );
    }
  }

  // Series
  series.forEach((s, si) => {
    const color = s.color ?? colors[si % colors.length];
    const pts = s.data.map((d) => `${xFn(d.x)},${yScale(d.y)}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`);
    // Dots if few points
    if (s.data.length <= 30) {
      for (const d of s.data) {
        parts.push(`<circle cx="${xFn(d.x)}" cy="${yScale(d.y)}" r="3" fill="${color}"/>`);
      }
    }
  });

  if (showLegend && series.length > 1) {
    parts.push(
      svgLegend(
        series.map((s, i) => ({ name: s.name, color: s.color ?? colors[i % colors.length]! })),
        plotLeft,
        h - 16,
        fg
      )
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export interface BarDataInput {
  label: string;
  values: Record<string, number>;
}

export interface BarChartConfig extends ChartConfig {
  stacked?: boolean;
  horizontal?: boolean;
}

export function renderBarChart(data: BarDataInput[], cfg?: BarChartConfig): string {
  if (!data.length) return emptySvg(cfg);
  const {
    w,
    h,
    pad,
    dark: _dark,
    colors,
    fg,
    bg,
    grid,
    showLegend,
    gridLines,
    title,
  } = resolveConfig(cfg);
  const stacked = cfg?.stacked ?? false;
  const horizontal = cfg?.horizontal ?? false;
  const plotTop = pad.top + (title ? 10 : 0);
  const plotBot = h - pad.bottom;
  const plotLeft = pad.left;
  const plotRight = w - pad.right;

  const keys = [...new Set(data.flatMap((d) => Object.keys(d.values)))];

  let maxVal: number;
  if (stacked) {
    maxVal = Math.max(...data.map((d) => Object.values(d.values).reduce((a, b) => a + b, 0)));
  } else {
    maxVal = Math.max(...data.flatMap((d) => Object.values(d.values)));
  }
  maxVal = maxVal || 1;

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];

  if (!horizontal) {
    const xBs = bandScale(
      data.map((d) => d.label),
      [plotLeft, plotRight],
      0.2
    );
    const yScale = linearScale([0, maxVal * 1.1], [plotBot, plotTop]);
    const yTicks = niceTicks(0, maxVal * 1.1);
    if (gridLines) parts.push(svgGridH(yTicks, yScale, plotLeft, plotRight, grid));
    parts.push(svgYAxis(yTicks, yScale, plotLeft, fg));

    for (const item of data) {
      const x0 = xBs(item.label);
      if (stacked) {
        let cumY = 0;
        keys.forEach((k, ki) => {
          const v = item.values[k] ?? 0;
          const barTop = yScale(cumY + v);
          const barBot = yScale(cumY);
          parts.push(
            `<rect x="${x0}" y="${barTop}" width="${xBs.bandwidth}" height="${barBot - barTop}" fill="${colors[ki % colors.length]}" rx="2"/>`
          );
          cumY += v;
        });
      } else {
        const groupW = xBs.bandwidth / keys.length;
        keys.forEach((k, ki) => {
          const v = item.values[k] ?? 0;
          const bx = x0 + ki * groupW;
          const barTop = yScale(v);
          parts.push(
            `<rect x="${bx}" y="${barTop}" width="${groupW * 0.85}" height="${plotBot - barTop}" fill="${colors[ki % colors.length]}" rx="2"/>`
          );
        });
      }
      // Label
      parts.push(
        `<text x="${x0 + xBs.bandwidth / 2}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="10" fill="${fg}">${escapeXml(item.label)}</text>`
      );
    }
  } else {
    // Horizontal bars
    const yBs = bandScale(
      data.map((d) => d.label),
      [plotTop, plotBot],
      0.2
    );
    const xScale = linearScale([0, maxVal * 1.1], [plotLeft, plotRight]);

    for (const item of data) {
      const y0 = yBs(item.label);
      if (stacked) {
        let cumX = 0;
        keys.forEach((k, ki) => {
          const v = item.values[k] ?? 0;
          const barLeft = xScale(cumX);
          const barRight = xScale(cumX + v);
          parts.push(
            `<rect x="${barLeft}" y="${y0}" width="${barRight - barLeft}" height="${yBs.bandwidth}" fill="${colors[ki % colors.length]}" rx="2"/>`
          );
          cumX += v;
        });
      } else {
        const groupH = yBs.bandwidth / keys.length;
        keys.forEach((k, ki) => {
          const v = item.values[k] ?? 0;
          const by = y0 + ki * groupH;
          const barRight = xScale(v);
          parts.push(
            `<rect x="${plotLeft}" y="${by}" width="${barRight - plotLeft}" height="${groupH * 0.85}" fill="${colors[ki % colors.length]}" rx="2"/>`
          );
        });
      }
      // Label
      parts.push(
        `<text x="${plotLeft - 6}" y="${yBs(item.label) + yBs.bandwidth / 2 + 3}" text-anchor="end" font-size="10" fill="${fg}">${escapeXml(item.label)}</text>`
      );
    }
  }

  if (showLegend && keys.length > 1) {
    parts.push(
      svgLegend(
        keys.map((k, i) => ({ name: k, color: colors[i % colors.length]! })),
        plotLeft,
        h - 16,
        fg
      )
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Pie / Donut Chart ──────────────────────────────────────────────────────

export interface PieSliceInput {
  label: string;
  value: number;
  color?: string;
}

export interface PieChartConfig extends ChartConfig {
  donut?: boolean;
  donutWidth?: number;
}

export function renderPieChart(slices: PieSliceInput[], cfg?: PieChartConfig): string {
  if (!slices.length) return emptySvg(cfg);
  const { w, h, pad: _pad, dark: _dark, colors, fg, bg, title } = resolveConfig(cfg);
  const donut = cfg?.donut ?? false;
  const donutWidth = cfg?.donutWidth ?? 40;

  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const cx = w / 2;
  const cy = h / 2 + (title ? 10 : 0);
  const outerR = Math.min(w, h) / 2 - 60;
  const innerR = donut ? outerR - donutWidth : 0;

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];

  let angle = -Math.PI / 2;
  slices.forEach((slice, i) => {
    const sweep = (slice.value / total) * 2 * Math.PI;
    const endAngle = angle + sweep;
    const largeArc = sweep > Math.PI ? 1 : 0;

    const x1o = cx + outerR * Math.cos(angle);
    const y1o = cy + outerR * Math.sin(angle);
    const x2o = cx + outerR * Math.cos(endAngle);
    const y2o = cy + outerR * Math.sin(endAngle);
    const x1i = cx + innerR * Math.cos(endAngle);
    const y1i = cy + innerR * Math.sin(endAngle);
    const x2i = cx + innerR * Math.cos(angle);
    const y2i = cy + innerR * Math.sin(angle);

    let d: string;
    if (donut) {
      d = `M${x1o},${y1o} A${outerR},${outerR} 0 ${largeArc} 1 ${x2o},${y2o} L${x1i},${y1i} A${innerR},${innerR} 0 ${largeArc} 0 ${x2i},${y2i} Z`;
    } else {
      d = `M${cx},${cy} L${x1o},${y1o} A${outerR},${outerR} 0 ${largeArc} 1 ${x2o},${y2o} Z`;
    }

    const color = slice.color ?? colors[i % colors.length];
    parts.push(`<path d="${d}" fill="${color}" stroke="${bg}" stroke-width="2"/>`);

    // Label
    const midAngle = angle + sweep / 2;
    const labelR = donut ? outerR + 20 : outerR * 0.65;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    const pct = ((slice.value / total) * 100).toFixed(1);
    parts.push(
      `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="${fg}">${escapeXml(slice.label)} ${pct}%</text>`
    );

    angle = endAngle;
  });

  // Center label for donut
  if (donut) {
    parts.push(
      `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="14" font-weight="600" fill="${fg}">Total</text>`
    );
    parts.push(
      `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="12" fill="${fg}">${formatTick(total)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Scatter Plot ───────────────────────────────────────────────────────────

export interface ScatterPointInput {
  x: number;
  y: number;
  label?: string;
  size?: number;
  color?: string;
}

export interface ScatterConfig extends ChartConfig {
  xLabel?: string;
  yLabel?: string;
  showTrendLine?: boolean;
}

export function renderScatterPlot(points: ScatterPointInput[], cfg?: ScatterConfig): string {
  if (!points.length) return emptySvg(cfg);
  const { w, h, pad, dark: _dark, colors, fg, bg, grid, gridLines, title } = resolveConfig(cfg);
  const plotTop = pad.top + (title ? 10 : 0);
  const plotBot = h - pad.bottom;
  const plotLeft = pad.left;
  const plotRight = w - pad.right;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 1;
  const xScale = linearScale(
    [Math.min(...xs) - xPad, Math.max(...xs) + xPad],
    [plotLeft, plotRight]
  );
  const yScale = linearScale([Math.min(...ys) - yPad, Math.max(...ys) + yPad], [plotBot, plotTop]);

  const xTicks = niceTicks(xScale.domain[0], xScale.domain[1]);
  const yTicks = niceTicks(yScale.domain[0], yScale.domain[1]);

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];
  if (gridLines) parts.push(svgGridH(yTicks, yScale, plotLeft, plotRight, grid));
  parts.push(svgYAxis(yTicks, yScale, plotLeft, fg));
  for (const t of xTicks) {
    parts.push(
      `<text x="${xScale(t)}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="10" fill="${fg}">${formatTick(t)}</text>`
    );
  }

  // Axis labels
  if (cfg?.xLabel)
    parts.push(
      `<text x="${(plotLeft + plotRight) / 2}" y="${h - 6}" text-anchor="middle" font-size="12" fill="${fg}">${escapeXml(cfg.xLabel)}</text>`
    );
  if (cfg?.yLabel)
    parts.push(
      `<text x="14" y="${(plotTop + plotBot) / 2}" text-anchor="middle" font-size="12" fill="${fg}" transform="rotate(-90,14,${(plotTop + plotBot) / 2})">${escapeXml(cfg.yLabel)}</text>`
    );

  // Trend line (simple linear regression)
  if (cfg?.showTrendLine && points.length >= 2) {
    const n = points.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
    const sumX2 = xs.reduce((a, b) => a + b * b, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    parts.push(
      `<line x1="${xScale(x0)}" y1="${yScale(slope * x0 + intercept)}" x2="${xScale(x1)}" y2="${yScale(slope * x1 + intercept)}" stroke="${grid}" stroke-width="1.5" stroke-dasharray="5 3"/>`
    );
  }

  // Points
  for (const p of points) {
    const r = clamp(p.size ?? 5, 2, 20);
    const color = p.color ?? colors[0]!;
    parts.push(
      `<circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="${r}" fill="${hexToRgba(color, 0.7)}" stroke="${color}" stroke-width="1"/>`
    );
    if (p.label) {
      parts.push(
        `<text x="${xScale(p.x)}" y="${yScale(p.y) - r - 4}" text-anchor="middle" font-size="9" fill="${fg}">${escapeXml(p.label)}</text>`
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Waterfall Chart ────────────────────────────────────────────────────────

export interface WaterfallItem {
  label: string;
  value: number;
  isTotal?: boolean;
}

export function renderWaterfall(items: WaterfallItem[], cfg?: ChartConfig): string {
  if (!items.length) return emptySvg(cfg);
  const {
    w,
    h,
    pad,
    dark: _dark,
    colors: _colors,
    fg,
    bg,
    grid,
    gridLines,
    title,
  } = resolveConfig(cfg);
  const plotTop = pad.top + (title ? 10 : 0);
  const plotBot = h - pad.bottom;
  const plotLeft = pad.left;
  const plotRight = w - pad.right;

  // Compute running totals
  let running = 0;
  const resolved = items.map((it) => {
    if (it.isTotal) {
      const total = running;
      return { ...it, start: 0, end: total };
    }
    const start = running;
    running += it.value;
    return { ...it, start, end: running };
  });

  const allVals = resolved.flatMap((r) => [r.start, r.end]);
  const lo = Math.min(0, ...allVals);
  const hi = Math.max(0, ...allVals);
  const valPad = (hi - lo) * 0.1 || 1;
  const yScale = linearScale([lo - valPad, hi + valPad], [plotBot, plotTop]);
  const xBs = bandScale(
    items.map((i) => i.label),
    [plotLeft, plotRight],
    0.25
  );
  const yTicks = niceTicks(lo - valPad, hi + valPad);

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];
  if (gridLines) parts.push(svgGridH(yTicks, yScale, plotLeft, plotRight, grid));
  parts.push(svgYAxis(yTicks, yScale, plotLeft, fg));
  // Zero line
  parts.push(
    `<line x1="${plotLeft}" y1="${yScale(0)}" x2="${plotRight}" y2="${yScale(0)}" stroke="${fg}" stroke-width="0.5" opacity="0.4"/>`
  );

  for (const r of resolved) {
    const x = xBs(r.label);
    const top = yScale(Math.max(r.start, r.end));
    const bot = yScale(Math.min(r.start, r.end));
    const barH = Math.max(1, bot - top);
    let color: string;
    if (r.isTotal) color = '#6366f1';
    else if (r.value >= 0) color = '#22c55e';
    else color = '#ef4444';
    parts.push(
      `<rect x="${x}" y="${top}" width="${xBs.bandwidth}" height="${barH}" fill="${color}" rx="2"/>`
    );
    // Value label
    const labelY = r.value >= 0 || r.isTotal ? top - 4 : bot + 12;
    parts.push(
      `<text x="${x + xBs.bandwidth / 2}" y="${labelY}" text-anchor="middle" font-size="9" fill="${fg}">${formatTick(r.end - r.start)}</text>`
    );
    // X label
    parts.push(
      `<text x="${x + xBs.bandwidth / 2}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="10" fill="${fg}">${escapeXml(r.label)}</text>`
    );
  }

  // Connector lines between bars
  for (let i = 0; i < resolved.length - 1; i++) {
    const cur = resolved[i]!;
    const nxt = resolved[i + 1]!;
    if (nxt.isTotal) continue;
    const x1 = xBs(cur.label) + xBs.bandwidth;
    const x2 = xBs(nxt.label);
    const y = yScale(cur.end);
    parts.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${fg}" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.4"/>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Heatmap ────────────────────────────────────────────────────────────────

export interface HeatmapInput {
  labels: string[];
  values: number[][];
}

export interface HeatmapConfig extends ChartConfig {
  colorLow?: string;
  colorHigh?: string;
  showValues?: boolean;
}

function heatColor(v: number, lo: number, hi: number, cLow: string, cHigh: string): string {
  const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
  const lR = parseInt(cLow.slice(1, 3), 16);
  const lG = parseInt(cLow.slice(3, 5), 16);
  const lB = parseInt(cLow.slice(5, 7), 16);
  const hR = parseInt(cHigh.slice(1, 3), 16);
  const hG = parseInt(cHigh.slice(3, 5), 16);
  const hB = parseInt(cHigh.slice(5, 7), 16);
  const r = Math.round(lerp(lR, hR, t));
  const g = Math.round(lerp(lG, hG, t));
  const b = Math.round(lerp(lB, hB, t));
  return `rgb(${r},${g},${b})`;
}

export function renderHeatmap(matrix: HeatmapInput, cfg?: HeatmapConfig): string {
  const { labels, values } = matrix;
  if (!labels.length || !values.length) return emptySvg(cfg);
  const { w, h, pad, dark: _dark, colors: _colors, fg, bg, title } = resolveConfig(cfg);
  const colorLow = cfg?.colorLow ?? '#dbeafe';
  const colorHigh = cfg?.colorHigh ?? '#1d4ed8';
  const showVals = cfg?.showValues ?? true;

  const n = labels.length;
  const plotLeft = pad.left + 60; // extra space for row labels
  const plotTop = pad.top + (title ? 10 : 0) + 30; // extra for col labels
  const plotRight = w - pad.right;
  const plotBot = h - pad.bottom;
  const cellW = (plotRight - plotLeft) / n;
  const cellH = (plotBot - plotTop) / n;

  const allVals = values.flat();
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);

  const parts: string[] = [svgOpen(w, h, bg), svgTitle(title, w, fg)];

  // Column headers
  for (let c = 0; c < n; c++) {
    const x = plotLeft + c * cellW + cellW / 2;
    parts.push(
      `<text x="${x}" y="${plotTop - 8}" text-anchor="middle" font-size="9" fill="${fg}" transform="rotate(-45,${x},${plotTop - 8})">${escapeXml(labels[c]!)}</text>`
    );
  }

  // Cells
  for (let r = 0; r < n; r++) {
    // Row label
    parts.push(
      `<text x="${plotLeft - 6}" y="${plotTop + r * cellH + cellH / 2 + 3}" text-anchor="end" font-size="9" fill="${fg}">${escapeXml(labels[r]!)}</text>`
    );
    for (let c = 0; c < n; c++) {
      const v = values[r]?.[c] ?? 0;
      const x = plotLeft + c * cellW;
      const y = plotTop + r * cellH;
      const color = heatColor(v, lo, hi, colorLow, colorHigh);
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellW - 1}" height="${cellH - 1}" fill="${color}" rx="2"/>`
      );
      if (showVals) {
        // Pick text color based on brightness
        const brightness = clamp((v - lo) / (hi - lo || 1), 0, 1);
        const textColor = brightness > 0.5 ? '#ffffff' : '#1f2937';
        parts.push(
          `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-size="9" fill="${textColor}">${v.toFixed(2)}</text>`
        );
      }
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

export interface SparklineConfig {
  width?: number;
  height?: number;
  color?: string;
  fillArea?: boolean;
}

export function renderSparkline(values: number[], cfg?: SparklineConfig): string {
  if (!values.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"/>`;
  const w = cfg?.width ?? 120;
  const h = cfg?.height ?? 30;
  const color = cfg?.color ?? '#3b82f6';
  const fill = cfg?.fillArea ?? false;
  const pad = 2;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const xScale = linearScale([0, values.length - 1], [pad, w - pad]);
  const yScale = linearScale([lo, hi], [h - pad, pad]);

  const pts = values.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ');
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
  ];

  if (fill) {
    const fillPts = `${xScale(0)},${h - pad} ${pts} ${xScale(values.length - 1)},${h - pad}`;
    parts.push(`<polygon points="${fillPts}" fill="${hexToRgba(color, 0.15)}"/>`);
  }
  parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
  // Endpoint dot
  const last = values.length - 1;
  parts.push(`<circle cx="${xScale(last)}" cy="${yScale(values[last]!)}" r="2" fill="${color}"/>`);

  parts.push('</svg>');
  return parts.join('');
}

// ─── Empty SVG fallback ─────────────────────────────────────────────────────

function emptySvg(cfg?: ChartConfig): string {
  const w = cfg?.width ?? 400;
  const h = cfg?.height ?? 200;
  const dark = cfg?.darkMode ?? false;
  const fg = dark ? '#e5e7eb' : '#6b7280';
  const bg = dark ? '#1f2937' : '#ffffff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="14" fill="${fg}">No data</text></svg>`;
}
