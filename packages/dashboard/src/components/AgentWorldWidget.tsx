/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/purity */
/**
 * AgentWorldWidget — React port of the ASCII animated agent world.
 *
 * Renders each active personality as an ASCII character at their workstation
 * with a 4-frame state machine driven by live server data:
 *
 *   idle     (o.o) — resting, slow blink
 *   thinking (>.<) — task just started (< 2 s)
 *   typing   (^_^) — task actively running, keyboard flicker
 *   meeting  (o_o) — personality has active sub-agent delegations
 *   offline  (x_x) — personality inactive, floating Zs
 *
 * Two view modes (toggle persisted to localStorage):
 *   Grid — card-per-agent layout (original)
 *   Map  — zone-based layout (Workspace / Meeting / Break Room)
 *
 * Inspired by pixel-agents (github.com/pablodelucca/pixel-agents), adapted
 * as a pure React/Tailwind component without canvas or a real TTY.
 *
 * Used in: MissionControlTab (MetricsPage), AdvancedEditorPage (collapsible panel)
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPersonalities, fetchTasks, fetchActiveDelegations } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ActiveDelegationInfo } from '../api/client';
import type { Personality, Task } from '../types';

// ── State machine ──────────────────────────────────────────────────────────────

type AgentState = 'idle' | 'thinking' | 'typing' | 'meeting' | 'offline';

interface AnimFrame {
  face: string; // 3-char content rendered between ║…║
  extra: string; // bottom decoration line — empty string = blank row
}

const FRAMES: Record<AgentState, AnimFrame[]> = {
  idle: [
    { face: 'o.o', extra: '' },
    { face: 'o.o', extra: '' },
    { face: '-.-', extra: '' }, // blink frame
    { face: 'o.o', extra: '' },
  ],
  thinking: [
    { face: '>.<', extra: '·..' },
    { face: '>.<', extra: '.·.' },
    { face: '>.<', extra: '..·' },
    { face: '>.<', extra: '···' },
  ],
  typing: [
    { face: '^_^', extra: '≡≡≡≡' },
    { face: '^_^', extra: '════' },
    { face: '^v^', extra: '≡≡≡≡' },
    { face: '^_^', extra: '════' },
  ],
  meeting: [
    { face: 'o_o', extra: '«·»' },
    { face: 'o.o', extra: '«··' },
    { face: 'o_o', extra: '·»·' },
    { face: 'o.o', extra: '··»' },
  ],
  offline: [
    { face: 'x_x', extra: 'zz' },
    { face: 'x_x', extra: 'Zz' },
    { face: 'x_x', extra: 'ZZ' },
    { face: 'x_x', extra: 'zZ' },
  ],
};

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'idle',
  thinking: 'thinking',
  typing: 'writing',
  meeting: 'meeting',
  offline: 'offline',
};

const STATE_FACE_CLS: Record<AgentState, string> = {
  idle: 'text-muted-foreground',
  thinking: 'text-yellow-400',
  typing: 'text-cyan-400',
  meeting: 'text-amber-400',
  offline: 'text-muted-foreground/40',
};

const STATE_LABEL_CLS: Record<AgentState, string> = {
  idle: 'text-muted-foreground/70',
  thinking: 'text-yellow-400/90',
  typing: 'text-cyan-400/90',
  meeting: 'text-amber-400/90',
  offline: 'text-muted-foreground/40',
};

const STATE_BORDER_CLS: Record<AgentState, string> = {
  idle: 'border-border',
  thinking: 'border-yellow-400/50',
  typing: 'border-cyan-400/50',
  meeting: 'border-amber-400/50',
  offline: 'border-border/40',
};

// ── Pure helpers ───────────────────────────────────────────────────────────────

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Exported for unit tests. */
export function deriveAgentState(
  p: Personality,
  tasks: Task[],
  now: number,
  delegations: ActiveDelegationInfo[] = []
): { state: AgentState; taskLabel: string } {
  if (!p.isActive) return { state: 'offline', taskLabel: 'inactive' };

  // Personality is in meeting if it has active delegations it spawned
  if (delegations.some((d) => d.initiatedByPersonalityId === p.id)) {
    return { state: 'meeting', taskLabel: '' };
  }

  const running = tasks.find(
    (t) => t.securityContext?.personalityId === p.id && t.status === 'running'
  );

  if (running) {
    const age = now - (running.startedAt ?? running.createdAt);
    return {
      state: age < 2_000 ? 'thinking' : 'typing',
      taskLabel: running.name,
    };
  }

  return { state: 'idle', taskLabel: '' };
}

/**
 * Compute which zone an agent should occupy in map view.
 * Exported for unit tests.
 */
export function computeZoneForAgent(
  p: Personality,
  tasks: Task[],
  meetingPersonalityIds: Set<string>,
  idleSinceMs: number | undefined,
  now: number
): 'workspace' | 'meeting' | 'break-room' {
  if (!p.isActive) return 'workspace';
  if (meetingPersonalityIds.has(p.id)) return 'meeting';

  const running = tasks.find(
    (t) => t.securityContext?.personalityId === p.id && t.status === 'running'
  );
  if (running) return 'workspace';

  // Idle for > 60 s → break room
  if (idleSinceMs !== undefined && now - idleSinceMs > 60_000) return 'break-room';

  return 'workspace';
}

/** Compute meeting pairs from running tasks (correlationId or A2A type). */
function computeReactMeetingPairs(tasks: Task[]): Set<string> {
  const pairs = new Set<string>();
  const running = tasks.filter((t) => t.status === 'running');

  // Group by correlationId
  const byCorr = new Map<string, string[]>();
  for (const t of running) {
    const pid = t.securityContext?.personalityId;
    const cid = (t as any).correlationId as string | undefined;
    if (cid && pid) {
      const group = byCorr.get(cid) ?? [];
      group.push(pid);
      byCorr.set(cid, group);
    }
  }
  for (const [, pids] of byCorr) {
    const unique = [...new Set(pids)];
    if (unique.length >= 2) {
      for (const pid of unique) pairs.add(pid);
    }
  }

  // A2A tasks
  for (const t of running) {
    const pid = t.securityContext?.personalityId;
    if ((t as any).type?.includes?.('a2a') && pid) {
      pairs.add(pid);
    }
  }

  return pairs;
}

// ── AgentCard ──────────────────────────────────────────────────────────────────

interface AgentCardProps {
  personality: Personality;
  state: AgentState;
  taskLabel: string;
  frame: number;
  onClick?: () => void;
}

function AgentCard({ personality, state, taskLabel, frame, onClick }: AgentCardProps) {
  const f = FRAMES[state][frame % 4];
  const name = trunc(personality.name, 10);

  return (
    <div
      className={`font-mono text-[1em] leading-snug p-2 rounded border select-none w-[88px] flex-shrink-0 ${STATE_BORDER_CLS[state]} bg-card/50 ${state === 'offline' ? 'opacity-50' : ''} ${onClick ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
      title={`${personality.name} — ${STATE_LABEL[state]}${taskLabel ? `: ${taskLabel}` : ''}`}
      onClick={onClick}
    >
      {/* Name */}
      <div className="font-bold text-center text-foreground truncate mb-0.5">{name}</div>
      {/* Head */}
      <div className="text-muted-foreground/50 text-center">╔═══╗</div>
      <div className="text-center">
        <span className="text-muted-foreground/50">║</span>
        <span className={STATE_FACE_CLS[state]}>{f.face}</span>
        <span className="text-muted-foreground/50">║</span>
      </div>
      <div className="text-muted-foreground/50 text-center">╚═══╝</div>
      {/* Body */}
      <div className="text-muted-foreground/50 text-center">/||{'\\' /* backslash */}</div>
      {/* Extra (keyboard / dots / Zs) */}
      <div className="text-muted-foreground/40 text-center h-[1.3em]">
        {f.extra ? `[${f.extra}]` : ''}
      </div>
      {/* State label */}
      <div className={`text-center font-semibold ${STATE_LABEL_CLS[state]}`}>
        {STATE_LABEL[state]}
      </div>
      {/* Task label */}
      <div className="text-muted-foreground/50 text-center truncate h-[1.3em] text-[0.9em]">
        {taskLabel}
      </div>
    </div>
  );
}

// ── Sub-agent (spawned delegation) rendering ──────────────────────────────────

const FRAMES_SPAWNED: AnimFrame[] = [
  { face: '>_>', extra: '→→→' },
  { face: '>_>', extra: '.→.' },
  { face: '>_>', extra: '→.→' },
  { face: '>_>', extra: '→→.' },
];

interface SubAgentCardProps {
  delegation: ActiveDelegationInfo;
  frame: number;
}

function SubAgentCard({ delegation, frame }: SubAgentCardProps) {
  const f = FRAMES_SPAWNED[frame % 4];
  const name = trunc(delegation.profileName, 10);
  return (
    <div
      className="font-mono text-[1em] leading-snug p-2 rounded border select-none w-[88px] flex-shrink-0 border-purple-400/50 bg-card/50"
      title={`[sub-agent] ${delegation.profileName}: ${delegation.task}`}
    >
      <div className="font-bold text-center text-foreground truncate mb-0.5">{name}</div>
      <div className="text-muted-foreground/50 text-center">╔═══╗</div>
      <div className="text-center">
        <span className="text-muted-foreground/50">║</span>
        <span className="text-purple-400">{f.face}</span>
        <span className="text-muted-foreground/50">║</span>
      </div>
      <div className="text-muted-foreground/50 text-center">╚═══╝</div>
      <div className="text-muted-foreground/50 text-center">/||{'\\' /* backslash */}</div>
      <div className="text-muted-foreground/40 text-center h-[1.3em]">
        {f.extra ? `[${f.extra}]` : ''}
      </div>
      <div className="text-center font-semibold text-purple-400/90">delegating</div>
      <div className="text-muted-foreground/50 text-center truncate h-[1.3em] text-[0.9em]">
        {trunc(delegation.task, 12)}
      </div>
    </div>
  );
}

function SubAgentPill({ delegation, frame }: SubAgentCardProps) {
  const f = FRAMES_SPAWNED[frame % 4];
  const name = trunc(delegation.profileName, 8);
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.9em] font-mono border-purple-400/50 bg-card/50"
      title={`[sub-agent] ${delegation.profileName}: ${delegation.task}`}
    >
      <span className="text-purple-400">{f.face}</span>
      <span className="text-foreground truncate">{name}</span>
    </div>
  );
}

// ── Agent pill (map view) ──────────────────────────────────────────────────────

interface AgentPillProps {
  personality: Personality;
  state: AgentState;
  frame: number;
  inMeeting: boolean;
  onClick?: () => void;
}

function AgentPill({ personality, state, frame, inMeeting, onClick }: AgentPillProps) {
  const f = FRAMES[state][frame % 4];
  const name = trunc(personality.name, 8);
  const cls = inMeeting ? 'text-yellow-400' : STATE_FACE_CLS[state];

  return (
    <div
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.9em] font-mono ${STATE_BORDER_CLS[state]} bg-card/50 ${state === 'offline' ? 'opacity-50' : ''} ${onClick ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
      title={`${personality.name} — ${STATE_LABEL[state]}`}
      onClick={onClick}
    >
      <span className={cls}>{f.face}</span>
      <span className="text-foreground truncate">{name}</span>
    </div>
  );
}

// ── Zone box (shared by map and large views) ──────────────────────────────────

interface ZoneBoxProps {
  label: string;
  zoneId: string;
  agents: Personality[];
  tasks: Task[];
  meetingPairs: Set<string>;
  framesMap: Map<string, number>;
  whiteboardText?: string;
  onAgentClick?: (personalityId: string) => void;
  now: number;
  /** 'pill' = compact name+face row (map view); 'card' = full agent card (large view) */
  mode?: 'pill' | 'card';
  /** Active sub-agent delegations — shown in workspace zone only */
  delegations?: ActiveDelegationInfo[];
}

function ZoneBox({
  label,
  zoneId,
  agents,
  tasks,
  meetingPairs,
  framesMap,
  whiteboardText,
  onAgentClick,
  now,
  mode = 'pill',
  delegations = [],
}: ZoneBoxProps) {
  const hasMeeting = zoneId === 'meeting' && agents.length > 0;
  const showDelegations = zoneId === 'workspace' && delegations.length > 0;

  return (
    <div className="border border-border rounded p-2 min-h-[60px] flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[0.9em] font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        {agents.length > 0 && (
          <span className="text-[0.9em] text-muted-foreground/60">{agents.length}</span>
        )}
      </div>

      {/* Whiteboard in meeting room */}
      {hasMeeting && whiteboardText && (
        <div className="font-mono text-[0.9em] text-yellow-400/90 mb-1 px-1 border-b border-yellow-400/20 pb-1">
          <span className="text-muted-foreground/40">╭─╮</span> {trunc(whiteboardText, 14)}{' '}
          <span className="text-muted-foreground/40">╰─╯</span>
        </div>
      )}

      {/* Agents */}
      {agents.length === 0 && !showDelegations ? (
        <span className="text-[0.9em] text-muted-foreground/30 italic">empty</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {agents.map((p) => {
            const { state, taskLabel } = deriveAgentState(p, tasks, now, delegations);
            const inMeeting = meetingPairs.has(p.id);
            return mode === 'card' ? (
              <AgentCard
                key={p.id}
                personality={p}
                state={state}
                taskLabel={taskLabel}
                frame={framesMap.get(p.id) ?? 0}
                onClick={
                  onAgentClick
                    ? () => {
                        onAgentClick(p.id);
                      }
                    : undefined
                }
              />
            ) : (
              <AgentPill
                key={p.id}
                personality={p}
                state={state}
                frame={framesMap.get(p.id) ?? 0}
                inMeeting={inMeeting}
                onClick={
                  onAgentClick
                    ? () => {
                        onAgentClick(p.id);
                      }
                    : undefined
                }
              />
            );
          })}
          {/* Sub-agent delegations — workspace zone only */}
          {showDelegations &&
            delegations.map((d) =>
              mode === 'card' ? (
                <SubAgentCard
                  key={d.delegationId}
                  delegation={d}
                  frame={framesMap.get(d.delegationId) ?? 0}
                />
              ) : (
                <SubAgentPill
                  key={d.delegationId}
                  delegation={d}
                  frame={framesMap.get(d.delegationId) ?? 0}
                />
              )
            )}
        </div>
      )}
    </div>
  );
}

// ── Shared zone-distribution helper ───────────────────────────────────────────

function distributeZones(personalities: Personality[], tasks: Task[]) {
  const meetingPairs = computeReactMeetingPairs(tasks);
  const now = Date.now();
  const zones: Record<'workspace' | 'meeting' | 'break-room', Personality[]> = {
    workspace: [],
    meeting: [],
    'break-room': [],
  };
  for (const p of personalities) {
    zones[computeZoneForAgent(p, tasks, meetingPairs, undefined, now)].push(p);
  }
  const activeJointTask = tasks.find(
    (t) => t.status === 'running' && meetingPairs.has(t.securityContext?.personalityId ?? '')
  );
  return { zones, meetingPairs, activeJointTask, now };
}

// ── AgentWorldMapView (compact pill layout) ────────────────────────────────────

interface MapViewProps {
  personalities: Personality[];
  tasks: Task[];
  framesMap: Map<string, number>;
  onAgentClick?: (personalityId: string) => void;
  delegations?: ActiveDelegationInfo[];
  zoom?: number;
}

function AgentWorldMapView({
  personalities,
  tasks,
  framesMap,
  onAgentClick,
  delegations = [],
  zoom = 1,
}: MapViewProps) {
  const { zones, meetingPairs, activeJointTask, now } = distributeZones(personalities, tasks);

  return (
    <div
      className="grid grid-cols-2 gap-2 font-mono"
      style={{ fontSize: `${Math.round(11 * zoom)}px` }}
      role="list"
      aria-label="Agent world map"
    >
      <ZoneBox
        label="Workspace"
        zoneId="workspace"
        agents={zones.workspace}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
        delegations={delegations}
      />
      <ZoneBox
        label="Meeting Room"
        zoneId="meeting"
        agents={zones.meeting}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        whiteboardText={activeJointTask?.name}
        onAgentClick={onAgentClick}
        now={now}
      />
      <ZoneBox
        label="Break Room"
        zoneId="break-room"
        agents={zones['break-room']}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
      />
      <ZoneBox
        label="Server Room"
        zoneId="server-room"
        agents={[]}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
      />
    </div>
  );
}

// ── AgentWorldLargeView (full card layout per zone) ────────────────────────────

function AgentWorldLargeView({
  personalities,
  tasks,
  framesMap,
  onAgentClick,
  delegations = [],
  zoom = 1,
}: MapViewProps) {
  const { zones, meetingPairs, activeJointTask, now } = distributeZones(personalities, tasks);

  return (
    <div
      className="grid grid-cols-2 gap-3 font-mono"
      style={{ fontSize: `${Math.round(11 * zoom)}px` }}
      role="list"
      aria-label="Agent world large view"
    >
      <ZoneBox
        label="Workspace"
        zoneId="workspace"
        agents={zones.workspace}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
        mode="card"
        delegations={delegations}
      />
      <ZoneBox
        label="Meeting Room"
        zoneId="meeting"
        agents={zones.meeting}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        whiteboardText={activeJointTask?.name}
        onAgentClick={onAgentClick}
        now={now}
        mode="card"
      />
      <ZoneBox
        label="Break Room"
        zoneId="break-room"
        agents={zones['break-room']}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
        mode="card"
      />
      <ZoneBox
        label="Server Room"
        zoneId="server-room"
        agents={[]}
        tasks={tasks}
        meetingPairs={meetingPairs}
        framesMap={framesMap}
        onAgentClick={onAgentClick}
        now={now}
        mode="card"
      />
    </div>
  );
}

// ── AgentWorldWidget ───────────────────────────────────────────────────────────

export interface AgentWorldWidgetProps {
  className?: string;
  /** Cap on how many agents are shown. Default: 16 */
  maxAgents?: number;
  /** Called when the user clicks an agent pill or card. */
  onAgentClick?: (personalityId: string) => void;
  /** Controlled view mode. Defaults to 'grid' when not provided. */
  viewMode?: 'grid' | 'map' | 'large';
  /** Zoom multiplier for map and large views (font-size scale) and grid view (CSS transform). Range 0.5–2.0. Default: 1. */
  zoom?: number;
}

export function AgentWorldWidget({
  className = '',
  maxAgents = 16,
  onAgentClick,
  viewMode = 'grid',
  zoom = 1,
}: AgentWorldWidgetProps) {
  // Per-personality frame counters — staggered so agents animate out of phase
  const framesRef = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver — pause animation and polling when off-screen
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, []);

  // WebSocket for real-time tasks + soul (personalities) updates
  const { lastMessage, subscribe } = useWebSocket('/ws/metrics');
  const [wsTasksData, setWsTasksData] = useState<{ tasks: Task[]; total: number } | null>(null);
  const [wsPersonalitiesData, setWsPersonalitiesData] = useState<{
    personalities: Personality[];
  } | null>(null);
  const wsHasDataRef = useRef(false);

  useEffect(() => {
    subscribe(['tasks', 'soul']);
  }, [subscribe]);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.channel === 'tasks') {
      setWsTasksData(lastMessage.payload as { tasks: Task[]; total: number });
      wsHasDataRef.current = true;
    }
    if (lastMessage.channel === 'soul') {
      setWsPersonalitiesData(lastMessage.payload as { personalities: Personality[] });
      wsHasDataRef.current = true;
    }
  }, [lastMessage]);

  // Queries — serve as initial data load and reconnect hydration.
  // refetchInterval is disabled once WebSocket data has arrived.
  const { data: personalitiesData } = useQuery({
    queryKey: ['world-personalities'],
    queryFn: fetchPersonalities,
    refetchInterval: isVisible && !wsHasDataRef.current ? 10_000 : false,
    staleTime: 5_000,
    enabled: isVisible,
  });

  const { data: tasksData } = useQuery({
    queryKey: ['world-tasks-running'],
    queryFn: () => fetchTasks({ status: 'running', limit: 20 }),
    refetchInterval: isVisible && !wsHasDataRef.current ? 3_000 : false,
    enabled: isVisible,
  });

  const { data: delegationsData } = useQuery({
    queryKey: ['world-delegations-active'],
    queryFn: fetchActiveDelegations,
    // Delegations not broadcast via WS yet — keep polling but only when visible
    refetchInterval: isVisible ? 3_000 : false,
    enabled: isVisible,
  });

  // Merge WS data with query cache (WS wins when available)
  const resolvedPersonalitiesData = wsPersonalitiesData ?? personalitiesData;
  const resolvedTasksData = wsTasksData ?? tasksData;

  // Animation loop — 4 fps; paused when off-screen
  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(() => {
      for (const [id, frame] of framesRef.current) {
        framesRef.current.set(id, (frame + 1) % 4);
      }
      setTick((t) => t + 1);
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [isVisible]);

  void tick; // used only to trigger re-render

  const personalities = (resolvedPersonalitiesData?.personalities ?? []).slice(0, maxAgents);
  const tasks: Task[] = resolvedTasksData?.tasks ?? [];
  const delegations: ActiveDelegationInfo[] = delegationsData?.delegations ?? [];
  const now = Date.now();

  // Ensure each personality and delegation has a staggered initial frame
  for (const p of personalities) {
    if (!framesRef.current.has(p.id)) {
      framesRef.current.set(p.id, Math.floor(Math.random() * 4));
    }
  }
  for (const d of delegations) {
    if (!framesRef.current.has(d.delegationId)) {
      framesRef.current.set(d.delegationId, Math.floor(Math.random() * 4));
    }
  }

  if (personalities.length === 0 && delegations.length === 0) {
    return (
      <p ref={containerRef} className={`text-sm text-muted-foreground font-mono ${className}`}>
        No agents found.
      </p>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      {viewMode === 'large' ? (
        <AgentWorldLargeView
          personalities={personalities}
          tasks={tasks}
          framesMap={framesRef.current}
          onAgentClick={onAgentClick}
          delegations={delegations}
          zoom={zoom}
        />
      ) : viewMode === 'map' ? (
        <AgentWorldMapView
          personalities={personalities}
          tasks={tasks}
          framesMap={framesRef.current}
          onAgentClick={onAgentClick}
          delegations={delegations}
          zoom={zoom}
        />
      ) : (
        <div
          className="flex flex-wrap gap-2"
          role="list"
          aria-label="Agent world"
          style={{ fontSize: '11px', transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        >
          {personalities.map((p) => {
            const { state, taskLabel } = deriveAgentState(p, tasks, now, delegations);
            return (
              <div key={p.id} role="listitem">
                <AgentCard
                  personality={p}
                  state={state}
                  taskLabel={taskLabel}
                  frame={framesRef.current.get(p.id) ?? 0}
                  onClick={
                    onAgentClick
                      ? () => {
                          onAgentClick(p.id);
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
          {delegations.map((d) => (
            <div key={d.delegationId} role="listitem">
              <SubAgentCard delegation={d} frame={framesRef.current.get(d.delegationId) ?? 0} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
