/**
 * Resource Monitor Component
 *
 * Displays real-time resource usage with charts
 */

import { useRef, useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Cpu, HardDrive, Zap, DollarSign } from 'lucide-react';
import type { MetricsSnapshot } from '../types';

interface ResourceMonitorProps {
  metrics?: MetricsSnapshot;
}

interface HistoryPoint {
  time: string;
  value: number;
}

const MAX_HISTORY_POINTS = 30;

export function ResourceMonitor({ metrics }: ResourceMonitorProps) {
  const historyRef = useRef<HistoryPoint[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<HistoryPoint[]>([]);

  // Accumulate real memory data points
  useEffect(() => {
    if (metrics?.resources?.memoryUsedMb == null) return;

    const point: HistoryPoint = {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: metrics.resources.memoryUsedMb,
    };

    historyRef.current = [...historyRef.current, point].slice(-MAX_HISTORY_POINTS);
    setMemoryHistory([...historyRef.current]);
  }, [metrics?.resources?.memoryUsedMb]);

  const tokenData = [
    { name: 'Used', value: metrics?.resources?.tokensUsedToday ?? 0, color: '#0ea5e9' },
    { name: 'Cached', value: metrics?.resources?.tokensCachedToday ?? 0, color: '#22c55e' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Memory Usage Chart */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="font-medium">Memory Usage</h3>
        </div>
        <div className="h-[200px]">
          {memoryHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={memoryHistory}>
                <defs>
                  <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.1} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value.toFixed(0)} MB`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)} MB`, 'Memory']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#0ea5e9"
                  fill="url(#memoryGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Collecting memory data...
            </div>
          )}
        </div>
      </div>

      {/* Resource Stats */}
      <div className="space-y-4">
        {/* CPU */}
        <ResourceBar
          icon={<Cpu className="w-4 h-4" />}
          label="CPU Usage"
          value={metrics?.resources?.cpuPercent ?? 0}
          max={100}
          unit="%"
          color="bg-primary"
        />

        {/* Memory */}
        <ResourceBar
          icon={<HardDrive className="w-4 h-4" />}
          label="Memory"
          value={metrics?.resources?.memoryUsedMb ?? 0}
          max={metrics?.resources?.memoryLimitMb || 1024}
          unit="MB"
          color="bg-success"
        />

        {/* Token Usage */}
        <div className="p-4 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-medium">Token Usage Today</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">
                {(metrics?.resources?.tokensUsedToday ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {metrics?.resources?.tokensCachedToday ?? 0} cached
              </p>
            </div>
            <div className="w-20 h-20">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tokenData}
                    innerRadius={25}
                    outerRadius={35}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {tokenData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Cost */}
        <div className="p-4 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-success" />
            <span className="font-medium">Estimated Cost</span>
          </div>
          <div className="flex items-baseline gap-4">
            <div>
              <p className="text-lg font-bold">${(metrics?.resources?.costUsdToday ?? 0).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Today</p>
            </div>
            <div>
              <p className="text-lg font-bold">${(metrics?.resources?.costUsdMonth ?? 0).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">This Month</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResourceBarProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
}

function ResourceBar({ icon, label, value, max, unit, color }: ResourceBarProps) {
  const percent = Math.min((value / max) * 100, 100);
  const isWarning = percent > 80;
  const isCritical = percent > 95;

  return (
    <div className="p-4 rounded-lg bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{label}</span>
        </div>
        <span className={`text-sm font-mono ${isCritical ? 'text-destructive' : isWarning ? 'text-warning' : ''}`}>
          {value.toFixed(1)}{unit} / {max}{unit}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            isCritical ? 'bg-destructive' : isWarning ? 'bg-warning' : color
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
