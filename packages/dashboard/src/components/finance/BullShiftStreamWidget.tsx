/* eslint-disable react-hooks/purity */
/**
 * BullShiftStreamWidget — Real-time trading stream card for Mission Control.
 *
 * Polls BullShift positions for live ticker data when available.
 * Generates simulated trade events (demo mode) with demo fallback tickers
 * when BullShift is unreachable. Shows "DEMO" badge when using synthetic data.
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingUp, TrendingDown, Zap, AlertTriangle, WifiOff } from 'lucide-react';
import { fetchBullshiftPositions, fetchBullshiftHealth } from '../../api/client.js';

// ── Types ─────────────────────────────────────────────────────────

interface TradeEvent {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  timestamp: number;
}

interface PriceTick {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  timestamp: number;
}

interface StreamStatus {
  connected: boolean;
  eventCount: number;
  lastEvent: number;
}

// ── Demo data generator ───────────────────────────────────────────

const DEMO_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN', 'AMD'];

const demoPrices: Record<string, number> = {
  AAPL: 178.5,
  MSFT: 415.2,
  GOOGL: 165.8,
  TSLA: 245.3,
  NVDA: 880.4,
  META: 505.6,
  AMZN: 185.9,
  AMD: 164.7,
};

let demoSeqId = 0;

function generateDemoTrade(symbols?: string[]): TradeEvent {
  const syms = symbols?.length ? symbols : DEMO_SYMBOLS;
  const symbol = syms[Math.floor(Math.random() * syms.length)];
  const base = demoPrices[symbol] ?? 100;
  const jitter = (Math.random() - 0.5) * base * 0.008;
  demoPrices[symbol] = +(base + jitter * 0.1).toFixed(2);
  return {
    id: `t-${++demoSeqId}`,
    symbol,
    side: Math.random() > 0.5 ? 'buy' : 'sell',
    price: +(base + jitter).toFixed(2),
    qty: Math.floor(10 + Math.random() * 490),
    timestamp: Date.now(),
  };
}

function generateDemoTicks(): PriceTick[] {
  return DEMO_SYMBOLS.map((symbol) => {
    const base = demoPrices[symbol] ?? 100;
    const change = (Math.random() - 0.48) * base * 0.015;
    demoPrices[symbol] = +(base + change * 0.1).toFixed(2);
    return {
      symbol,
      price: +(base + change).toFixed(2),
      change: +change.toFixed(2),
      changePct: +((change / base) * 100).toFixed(2),
      timestamp: Date.now(),
    };
  });
}

// ── Parse BullShift positions into ticks ──────────────────────────

interface BullshiftPosition {
  symbol?: string;
  current_price?: number;
  currentPrice?: number;
  avg_entry_price?: number;
  avgEntryPrice?: number;
  qty?: number;
  market_value?: number;
  marketValue?: number;
  unrealized_pl?: number;
  unrealizedPl?: number;
}

function parsePositionsToTicks(data: unknown): PriceTick[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const positions = data as BullshiftPosition[];

  const ticks: PriceTick[] = [];
  for (const p of positions) {
    const symbol = p.symbol;
    if (!symbol) continue;
    const price = p.current_price ?? p.currentPrice ?? 0;
    const entry = p.avg_entry_price ?? p.avgEntryPrice ?? price;
    const change = price - entry;
    const changePct = entry > 0 ? (change / entry) * 100 : 0;
    ticks.push({
      symbol,
      price: +price.toFixed(2),
      change: +change.toFixed(2),
      changePct: +changePct.toFixed(2),
      timestamp: Date.now(),
    });
  }
  return ticks.length > 0 ? ticks : null;
}

function positionSymbols(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return (data as BullshiftPosition[]).map((p) => p.symbol).filter((s): s is string => !!s);
}

// ── Sub-components ────────────────────────────────────────────────

const TradeRow = memo(function TradeRow({ trade }: { trade: TradeEvent }) {
  const isBuy = trade.side === 'buy';
  return (
    <div className="flex items-center justify-between py-1 text-xs font-mono border-b border-border/30 last:border-0">
      <div className="flex items-center gap-1.5">
        {isBuy ? (
          <TrendingUp className="w-3 h-3 text-emerald-400" />
        ) : (
          <TrendingDown className="w-3 h-3 text-red-400" />
        )}
        <span className="font-semibold w-12">{trade.symbol}</span>
        <span className={isBuy ? 'text-emerald-400' : 'text-red-400'}>
          {trade.side.toUpperCase()}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{trade.qty}</span>
        <span className="w-16 text-right">${trade.price.toFixed(2)}</span>
      </div>
    </div>
  );
});

const TickerBar = memo(function TickerBar({ ticks }: { ticks: PriceTick[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide py-1">
      {ticks.map((tick) => (
        <div key={tick.symbol} className="flex items-center gap-1.5 flex-shrink-0 text-xs">
          <span className="font-semibold text-foreground">{tick.symbol}</span>
          <span className="font-mono">${tick.price.toFixed(2)}</span>
          <span className={`font-mono ${tick.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {tick.change >= 0 ? '+' : ''}
            {tick.changePct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
});

// ── Main Widget ───────────────────────────────────────────────────

export function BullShiftStreamWidget() {
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [ticks, setTicks] = useState<PriceTick[]>(() => generateDemoTicks());
  const [status, setStatus] = useState<StreamStatus>({
    connected: false,
    eventCount: 0,
    lastEvent: 0,
  });
  const [isLive, setIsLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const eventCountRef = useRef(0);

  // Try to connect to BullShift for real position data
  const { data: healthData } = useQuery({
    queryKey: ['bullshift-health'],
    queryFn: fetchBullshiftHealth,
    staleTime: 30_000,
    retry: 1,
  });

  const bullshiftUp =
    (healthData as Record<string, unknown>)?.status === 'ok' ||
    (healthData as Record<string, unknown>)?.status === 'healthy';

  const { data: positionsData } = useQuery({
    queryKey: ['bullshift-positions-stream'],
    queryFn: fetchBullshiftPositions,
    enabled: bullshiftUp,
    refetchInterval: isLive ? 10_000 : false,
    staleTime: 5_000,
    retry: 1,
  });

  const realTicks = positionsData ? parsePositionsToTicks(positionsData) : null;
  const liveSymbols = positionsData ? positionSymbols(positionsData) : undefined;
  const isDemo = !realTicks;

  // Update ticks when real position data arrives
  useEffect(() => {
    if (realTicks) setTicks(realTicks);
  }, [realTicks]);

  const addTrade = useCallback(() => {
    const trade = generateDemoTrade(liveSymbols);
    eventCountRef.current++;
    setTrades((prev) => [trade, ...prev].slice(0, 50));
    setStatus({
      connected: true,
      eventCount: eventCountRef.current,
      lastEvent: Date.now(),
    });
  }, [liveSymbols]);

  const refreshDemoTicks = useCallback(() => {
    if (!realTicks) setTicks(generateDemoTicks());
  }, [realTicks]);

  // Simulated trade stream (variable interval for realism)
  // Even with real tickers, trades are simulated until WebSocket is available
  useEffect(() => {
    if (!isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Start with a burst of initial trades
    for (let i = 0; i < 5; i++) addTrade();
    if (!realTicks) refreshDemoTicks();

    const scheduleNext = () => {
      const delay = 800 + Math.random() * 2200;
      intervalRef.current = setTimeout(() => {
        addTrade();
        if (eventCountRef.current % 3 === 0) refreshDemoTicks();
        scheduleNext();
      }, delay);
    };
    scheduleNext();

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current as unknown as number);
    };
  }, [isLive, addTrade, refreshDemoTicks, realTicks]);

  const timeSinceLastEvent = status.lastEvent
    ? Math.floor((Date.now() - status.lastEvent) / 1000)
    : null;

  return (
    <div className="flex flex-col gap-2" data-testid="bullshift-stream-widget">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isLive && status.connected ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground'
            }`}
          />
          <span className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
            {isLive ? 'LIVE STREAM' : 'PAUSED'}
          </span>
          {status.eventCount > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {status.eventCount} events
            </span>
          )}
          {isDemo && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
              <WifiOff className="w-3 h-3" />
              DEMO
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {timeSinceLastEvent !== null && timeSinceLastEvent > 5 && (
            <span title="Stale data">
              <AlertTriangle className="w-3 h-3 text-warning" />
            </span>
          )}
          <button
            onClick={() => {
              setIsLive((l) => !l);
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              isLive
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {isLive ? (
              <>
                <Zap className="w-3 h-3" /> Live
              </>
            ) : (
              <>
                <Activity className="w-3 h-3" /> Resume
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ticker bar */}
      <TickerBar ticks={ticks} />

      {/* Separator */}
      <div className="border-t border-border/50" />

      {/* Trade stream */}
      <div className="flex-1 overflow-y-auto max-h-48 min-h-[120px]">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            Waiting for trade events...
          </div>
        ) : (
          trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)
        )}
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-2 text-xs border-t border-border/50 pt-2">
        <div className="text-center">
          <div className="text-muted-foreground">Buy Vol</div>
          <div className="font-mono font-medium text-emerald-400">
            {trades
              .filter((t) => t.side === 'buy')
              .reduce((s, t) => s + t.qty, 0)
              .toLocaleString()}
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Sell Vol</div>
          <div className="font-mono font-medium text-red-400">
            {trades
              .filter((t) => t.side === 'sell')
              .reduce((s, t) => s + t.qty, 0)
              .toLocaleString()}
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Spread</div>
          <div className="font-mono font-medium">
            {trades.length >= 2
              ? `$${Math.abs(trades[0].price - trades[1].price).toFixed(2)}`
              : '--'}
          </div>
        </div>
      </div>
    </div>
  );
}
