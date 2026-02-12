// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceMonitor } from './ResourceMonitor';
import { createMetricsSnapshot } from '../test/mocks';

// ── Mock recharts ────────────────────────────────────────────────
// Recharts uses SVG heavily and needs ResizeObserver in jsdom.
// We mock the chart components to keep tests focused on data display.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
}));

// ── Tests ────────────────────────────────────────────────────────

describe('ResourceMonitor', () => {
  it('renders Memory Usage heading', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
  });

  it('renders CPU usage bar with correct values', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    // 34.5% / 100%
    expect(screen.getByText('34.5% / 100%')).toBeInTheDocument();
  });

  it('renders Memory bar with correct values', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    // 256.0MB / 1024MB
    expect(screen.getByText('256.0MB / 1024MB')).toBeInTheDocument();
  });

  it('renders Token Usage Today section with formatted count', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('Token Usage Today')).toBeInTheDocument();
    expect(screen.getByText('48,500')).toBeInTheDocument();
  });

  it('renders cached tokens count', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('12300 cached')).toBeInTheDocument();
  });

  it('renders Estimated Cost section', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('Estimated Cost')).toBeInTheDocument();
    expect(screen.getByText('$1.23')).toBeInTheDocument();
    expect(screen.getByText('$28.45')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
  });

  it('shows "Collecting memory data..." when no history points exist', () => {
    render(<ResourceMonitor metrics={createMetricsSnapshot()} />);
    expect(screen.getByText('Collecting memory data...')).toBeInTheDocument();
  });

  it('handles undefined metrics gracefully', () => {
    render(<ResourceMonitor metrics={undefined} />);
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('0.0% / 100%')).toBeInTheDocument();
    expect(screen.getByText('0.0MB / 1024MB')).toBeInTheDocument();
    // Cost shows $0.00 for both today and month
    const zeroCosts = screen.getAllByText('$0.00');
    expect(zeroCosts.length).toBe(2);
  });

  it('applies warning styling when CPU is above 80%', () => {
    const metrics = createMetricsSnapshot({
      resources: {
        ...createMetricsSnapshot().resources,
        cpuPercent: 85,
      },
    });
    render(<ResourceMonitor metrics={metrics} />);
    // The value display should have warning class
    expect(screen.getByText('85.0% / 100%')).toBeInTheDocument();
  });

  it('applies critical styling when CPU is above 95%', () => {
    const metrics = createMetricsSnapshot({
      resources: {
        ...createMetricsSnapshot().resources,
        cpuPercent: 97,
      },
    });
    render(<ResourceMonitor metrics={metrics} />);
    expect(screen.getByText('97.0% / 100%')).toBeInTheDocument();
  });
});
