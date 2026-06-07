/**
 * RiskTrendChart -- LineChart showing overall risk score trend over time for one
 * or more departments. Supports time-range selection (30d/90d/180d/365d) and
 * multi-department comparison (up to 5).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';
import { fetchRiskTrend } from '../../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompareDepartment {
  id: string;
  name: string;
}

interface RiskTrendChartProps {
  departmentId: string;
  compareDepartments?: CompareDepartment[];
}

interface TrendPoint {
  date: string;
  overallScore: number;
  openRisks: number;
  overdueRisks: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '365d', days: 365 },
] as const;

const LINE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#f97316'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTick(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return dateStr;
  }
}

function mergeTrendData(
  primary: TrendPoint[],
  primaryLabel: string,
  comparisons: { label: string; data: TrendPoint[] }[]
): Record<string, unknown>[] {
  // Build a map of date -> merged row
  const dateMap = new Map<string, Record<string, unknown>>();

  for (const pt of primary) {
    dateMap.set(pt.date, { date: pt.date, [primaryLabel]: pt.overallScore });
  }

  for (const comp of comparisons) {
    for (const pt of comp.data) {
      const existing = dateMap.get(pt.date) ?? { date: pt.date };
      existing[comp.label] = pt.overallScore;
      dateMap.set(pt.date, existing);
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RiskTrendChart({ departmentId, compareDepartments = [] }: RiskTrendChartProps) {
  const [days, setDays] = useState(30);
  const capped = compareDepartments.slice(0, 5);

  // Primary department trend
  const primaryQuery = useQuery({
    queryKey: ['risk-trend', departmentId, days],
    queryFn: () => fetchRiskTrend(departmentId, days),
    enabled: !!departmentId,
  });

  // Comparison department trends
  const compQueries = capped.map((dept) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['risk-trend', dept.id, days],
      queryFn: () => fetchRiskTrend(dept.id, days),
      enabled: !!dept.id,
    })
  );

  const isLoading = primaryQuery.isLoading || compQueries.some((q) => q.isLoading);

  // Build merged chart data
  const { chartData, lineKeys } = useMemo(() => {
    const primaryData: TrendPoint[] = primaryQuery.data?.points ?? [];
    const primaryLabel = 'Primary';

    const comparisons = capped
      .map((dept, i) => ({
        label: dept.name,
        data: compQueries[i]?.data?.points ?? [],
      }))
      .filter((c) => c.data.length > 0);

    const merged =
      comparisons.length > 0
        ? mergeTrendData(primaryData, primaryLabel, comparisons)
        : primaryData.map((pt) => ({ date: pt.date, [primaryLabel]: pt.overallScore }));

    const keys = [primaryLabel, ...comparisons.map((c) => c.label)];
    return { chartData: merged, lineKeys: keys };
  }, [primaryQuery.data, capped, compQueries]);

  return (
    <div className="space-y-4" data-testid="risk-trend-chart">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Risk Score Trend</h4>
        </div>

        {/* Time range selector */}
        <div className="flex gap-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                days === range.days
                  ? 'bg-primary text-primary-content font-medium'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              onClick={() => {
                setDays(range.days);
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      {isLoading && (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading trend data...
        </div>
      )}

      {!isLoading && chartData.length === 0 && (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          No trend data available for this time range.
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
            />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              labelFormatter={(label: string) => {
                try {
                  return new Date(label).toLocaleDateString();
                } catch {
                  return label;
                }
              }}
            />
            {lineKeys.length > 1 && <Legend wrapperStyle={{ fontSize: '12px' }} />}
            {lineKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Error */}
      {primaryQuery.isError && (
        <div className="text-sm text-red-600">
          Failed to load trend data. {primaryQuery.error?.message}
        </div>
      )}
    </div>
  );
}
