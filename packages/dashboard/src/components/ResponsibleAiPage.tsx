import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  BarChart3,
  Sparkles,
  Database,
  FileText,
  Search,
  AlertTriangle,
} from 'lucide-react';

// ── Auth helper ──────────────────────────────────────────────────────

const API_HEADERS = () => ({
  'Content-Type': 'application/json',
  // Token is stored under 'accessToken' (see api/client.ts setAuthTokens).
  Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
});

// ── Types ────────────────────────────────────────────────────────────

interface CohortSlice {
  dimension: string;
  value: string;
  sampleCount: number;
  errorCount: number;
  errorRate: number;
  avgScore: number;
}

interface FairnessMetrics {
  disparateImpactRatio: number;
  groups: { name: string; positiveRate: number; sampleCount: number }[];
  pass: boolean;
}

interface ShapToken {
  token: string;
  attribution: number;
}

interface ShapExplanation {
  id: string;
  tokens: ShapToken[];
  inputText: string;
}

interface ProvenanceSummary {
  included: number;
  filtered: number;
  synthetic: number;
  redacted: number;
  entries: { id: string; userId: string; conversationId: string; status: string }[];
}

interface ModelCard {
  id: string;
  name: string;
  version: string;
  description: string;
  intendedUse: string;
  limitations: string;
  ethicalConsiderations: string;
  trainingData: string;
  metrics: Record<string, number>;
}

// ── API functions ────────────────────────────────────────────────────

async function fetchCohortAnalysis(evalRunId: string): Promise<{ slices: CohortSlice[] }> {
  const res = await fetch(
    `/api/v1/responsible-ai/cohort-analysis?evalRunId=${encodeURIComponent(evalRunId)}`,
    {
      headers: API_HEADERS(),
    }
  );
  if (!res.ok) throw new Error('Failed to fetch cohort analysis');
  return res.json();
}

async function fetchFairness(evalRunId: string): Promise<FairnessMetrics> {
  const res = await fetch(
    `/api/v1/responsible-ai/fairness?evalRunId=${encodeURIComponent(evalRunId)}`,
    {
      headers: API_HEADERS(),
    }
  );
  if (!res.ok) throw new Error('Failed to fetch fairness metrics');
  return res.json();
}

async function fetchShap(id: string): Promise<ShapExplanation> {
  const res = await fetch(`/api/v1/responsible-ai/shap/${encodeURIComponent(id)}`, {
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to fetch SHAP explanation');
  return res.json();
}

async function fetchProvenance(datasetId: string): Promise<ProvenanceSummary> {
  const res = await fetch(
    `/api/v1/responsible-ai/provenance/summary/${encodeURIComponent(datasetId)}`,
    {
      headers: API_HEADERS(),
    }
  );
  if (!res.ok) throw new Error('Failed to fetch provenance summary');
  return res.json();
}

async function fetchModelCard(id: string): Promise<ModelCard> {
  const res = await fetch(`/api/v1/responsible-ai/model-cards/${encodeURIComponent(id)}`, {
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to fetch model card');
  return res.json();
}

async function fetchModelCardMarkdown(id: string): Promise<string> {
  const res = await fetch(`/api/v1/responsible-ai/model-cards/${encodeURIComponent(id)}/markdown`, {
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to fetch model card markdown');
  return res.text();
}

async function redactProvenance(datasetId: string, entryId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/responsible-ai/provenance/${encodeURIComponent(datasetId)}/redact/${encodeURIComponent(entryId)}`,
    {
      method: 'POST',
      headers: API_HEADERS(),
    }
  );
  if (!res.ok) throw new Error('Failed to redact entry');
}

// ── Utility ──────────────────────────────────────────────────────────

function errorRateColor(rate: number): string {
  if (rate > 0.3) return 'text-red-400';
  if (rate > 0.15) return 'text-yellow-400';
  return 'text-green-400';
}

function errorRateBg(rate: number): string {
  if (rate > 0.3) return 'bg-red-500/10';
  if (rate > 0.15) return 'bg-yellow-500/10';
  return 'bg-green-500/10';
}

// ── Section wrapper ──────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
        {icon}
        {title}
      </h2>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">{children}</div>
    </div>
  );
}

// ── 1. Cohort Error Analysis ─────────────────────────────────────────

function CohortErrorAnalysis() {
  const [evalRunId, setEvalRunId] = useState('');
  const [submittedId, setSubmittedId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['responsible-ai', 'cohort-analysis', submittedId],
    queryFn: () => fetchCohortAnalysis(submittedId),
    enabled: !!submittedId,
  });

  return (
    <Section title="Cohort Error Analysis" icon={<BarChart3 className="w-5 h-5 text-blue-400" />}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Eval Run ID"
          value={evalRunId}
          onChange={(e) => {
            setEvalRunId(e.target.value);
          }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          onClick={() => {
            setSubmittedId(evalRunId);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
        >
          Analyze
        </button>
      </div>

      {isLoading && <p className="text-zinc-400 text-sm">Loading cohort analysis...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}

      {data?.slices && data.slices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-400">
                <th className="py-2 px-3">Dimension</th>
                <th className="py-2 px-3">Value</th>
                <th className="py-2 px-3 text-right">Samples</th>
                <th className="py-2 px-3 text-right">Errors</th>
                <th className="py-2 px-3 text-right">Error Rate</th>
                <th className="py-2 px-3 text-right">Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {data.slices.map((slice, i) => (
                <tr
                  key={`${slice.dimension}-${slice.value}-${i}`}
                  className={`border-b border-zinc-800 ${errorRateBg(slice.errorRate)}`}
                >
                  <td className="py-2 px-3 text-white">{slice.dimension}</td>
                  <td className="py-2 px-3 text-zinc-300">{slice.value}</td>
                  <td className="py-2 px-3 text-right text-zinc-300">{slice.sampleCount}</td>
                  <td className="py-2 px-3 text-right text-zinc-300">{slice.errorCount}</td>
                  <td
                    className={`py-2 px-3 text-right font-mono font-semibold ${errorRateColor(slice.errorRate)}`}
                  >
                    {(slice.errorRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-right text-zinc-300">
                    {slice.avgScore.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.slices?.length === 0 && (
        <p className="text-zinc-500 text-sm">No cohort slices found for this eval run.</p>
      )}
    </Section>
  );
}

// ── 2. Fairness Metrics ──────────────────────────────────────────────

function FairnessMetrics() {
  const [evalRunId, setEvalRunId] = useState('');
  const [submittedId, setSubmittedId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['responsible-ai', 'fairness', submittedId],
    queryFn: () => fetchFairness(submittedId),
    enabled: !!submittedId,
  });

  return (
    <Section title="Fairness Metrics" icon={<ShieldCheck className="w-5 h-5 text-purple-400" />}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Eval Run ID"
          value={evalRunId}
          onChange={(e) => {
            setEvalRunId(e.target.value);
          }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          onClick={() => {
            setSubmittedId(evalRunId);
          }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
        >
          Evaluate
        </button>
      </div>

      {isLoading && <p className="text-zinc-400 text-sm">Loading fairness metrics...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}

      {data && (
        <div className="space-y-4">
          {/* Pass/fail badge */}
          <div className="flex items-center gap-3">
            <span className="text-zinc-400 text-sm">Overall:</span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                data.pass
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
              }`}
            >
              {data.pass ? 'PASS' : 'FAIL'}
            </span>
          </div>

          {/* Disparate impact gauge */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-zinc-400 text-sm">Disparate Impact Ratio</span>
              <span className="text-white font-mono text-sm">
                {data.disparateImpactRatio.toFixed(3)}
              </span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  data.disparateImpactRatio >= 0.8 && data.disparateImpactRatio <= 1.25
                    ? 'bg-green-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(data.disparateImpactRatio * 50, 100)}%` }}
              />
            </div>
            <p className="text-zinc-500 text-xs mt-1">
              Acceptable range: 0.8 - 1.25 (four-fifths rule)
            </p>
          </div>

          {/* Group comparison table */}
          {data.groups.length > 0 && (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-400">
                  <th className="py-2 px-3">Group</th>
                  <th className="py-2 px-3 text-right">Positive Rate</th>
                  <th className="py-2 px-3 text-right">Sample Count</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.name} className="border-b border-zinc-800">
                    <td className="py-2 px-3 text-white">{g.name}</td>
                    <td className="py-2 px-3 text-right text-zinc-300 font-mono">
                      {(g.positiveRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-300">{g.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 3. SHAP Explainability ───────────────────────────────────────────

function shapColor(attribution: number): string {
  if (attribution > 0) {
    const intensity = Math.min(Math.abs(attribution), 1);
    return `rgba(239, 68, 68, ${0.15 + intensity * 0.7})`;
  }
  if (attribution < 0) {
    const intensity = Math.min(Math.abs(attribution), 1);
    return `rgba(59, 130, 246, ${0.15 + intensity * 0.7})`;
  }
  return 'transparent';
}

function ShapExplainability() {
  const [shapId, setShapId] = useState('');
  const [submittedId, setSubmittedId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['responsible-ai', 'shap', submittedId],
    queryFn: () => fetchShap(submittedId),
    enabled: !!submittedId,
  });

  return (
    <Section title="SHAP Explainability" icon={<Sparkles className="w-5 h-5 text-amber-400" />}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Explanation ID"
          value={shapId}
          onChange={(e) => {
            setShapId(e.target.value);
          }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          onClick={() => {
            setSubmittedId(shapId);
          }}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded transition-colors"
        >
          Explain
        </button>
      </div>

      {isLoading && <p className="text-zinc-400 text-sm">Loading SHAP explanation...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}

      {data && (
        <div>
          <p className="text-zinc-400 text-xs mb-3">
            Token heatmap: <span className="text-red-400">red = positive attribution</span>,{' '}
            <span className="text-blue-400">blue = negative attribution</span>
          </p>
          <div className="flex flex-wrap gap-1 p-4 bg-zinc-800 rounded-lg">
            {data.tokens.map((t, i) => (
              <span
                key={`${t.token}-${i}`}
                className="px-1.5 py-0.5 rounded text-sm text-white font-mono"
                style={{ backgroundColor: shapColor(t.attribution) }}
                title={`${t.token}: ${t.attribution.toFixed(4)}`}
              >
                {t.token}
              </span>
            ))}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.7)' }}
              />
              High positive
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.25)' }}
              />
              Low positive
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: 'rgba(59, 130, 246, 0.25)' }}
              />
              Low negative
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: 'rgba(59, 130, 246, 0.7)' }}
              />
              High negative
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── 4. Data Provenance ───────────────────────────────────────────────

function DataProvenance() {
  const [datasetId, setDatasetId] = useState('');
  const [submittedId, setSubmittedId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['responsible-ai', 'provenance', submittedId],
    queryFn: () => fetchProvenance(submittedId),
    enabled: !!submittedId,
  });

  const handleRedact = async (entryId: string) => {
    if (!submittedId) return;
    try {
      await redactProvenance(submittedId, entryId);
      void refetch();
    } catch {
      // Error handling deferred to UI feedback
    }
  };

  const filteredEntries = data?.entries.filter(
    (e) =>
      !searchTerm ||
      e.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.conversationId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Section title="Data Provenance" icon={<Database className="w-5 h-5 text-teal-400" />}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Dataset ID"
          value={datasetId}
          onChange={(e) => {
            setDatasetId(e.target.value);
          }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          onClick={() => {
            setSubmittedId(datasetId);
          }}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm rounded transition-colors"
        >
          Load
        </button>
      </div>

      {isLoading && <p className="text-zinc-400 text-sm">Loading provenance data...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}

      {data && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Included', value: data.included, color: 'text-green-400' },
              { label: 'Filtered', value: data.filtered, color: 'text-yellow-400' },
              { label: 'Synthetic', value: data.synthetic, color: 'text-blue-400' },
              { label: 'Redacted', value: data.redacted, color: 'text-red-400' },
            ].map((card) => (
              <div key={card.label} className="bg-zinc-800 rounded-lg p-4 text-center">
                <p className="text-zinc-400 text-xs mb-1">{card.label}</p>
                <p className={`text-2xl font-bold font-mono ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by user or conversation ID..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 pl-9 text-sm text-white placeholder-zinc-500"
            />
          </div>

          {/* Entries table */}
          {filteredEntries && filteredEntries.length > 0 && (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-400">
                  <th className="py-2 px-3">Entry ID</th>
                  <th className="py-2 px-3">User</th>
                  <th className="py-2 px-3">Conversation</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-800">
                    <td className="py-2 px-3 text-zinc-300 font-mono text-xs">{entry.id}</td>
                    <td className="py-2 px-3 text-zinc-300">{entry.userId}</td>
                    <td className="py-2 px-3 text-zinc-300 font-mono text-xs">
                      {entry.conversationId}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          entry.status === 'redacted'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-green-500/10 text-green-400'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {entry.status !== 'redacted' && (
                        <button
                          onClick={() => void handleRedact(entry.id)}
                          className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-colors"
                        >
                          GDPR Redact
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 5. Model Cards ───────────────────────────────────────────────────

function ModelCards() {
  const [cardId, setCardId] = useState('');
  const [submittedId, setSubmittedId] = useState('');
  const [markdownView, setMarkdownView] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['responsible-ai', 'model-card', submittedId],
    queryFn: () => fetchModelCard(submittedId),
    enabled: !!submittedId,
  });

  const handleViewMarkdown = async () => {
    if (!submittedId) return;
    try {
      const md = await fetchModelCardMarkdown(submittedId);
      setMarkdownView(md);
    } catch {
      setMarkdownView('Failed to load markdown.');
    }
  };

  return (
    <Section title="Model Cards" icon={<FileText className="w-5 h-5 text-indigo-400" />}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Model Card ID"
          value={cardId}
          onChange={(e) => {
            setCardId(e.target.value);
          }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          onClick={() => {
            setSubmittedId(cardId);
            setMarkdownView(null);
          }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
        >
          Load
        </button>
      </div>

      {isLoading && <p className="text-zinc-400 text-sm">Loading model card...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}

      {data && !markdownView && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-lg">{data.name}</h3>
              <p className="text-zinc-400 text-sm">Version {data.version}</p>
            </div>
            <button
              onClick={() => void handleViewMarkdown()}
              className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors"
            >
              View Markdown
            </button>
          </div>

          <div className="grid gap-3">
            {[
              { label: 'Description', value: data.description },
              { label: 'Intended Use', value: data.intendedUse },
              { label: 'Limitations', value: data.limitations },
              { label: 'Ethical Considerations', value: data.ethicalConsiderations },
              { label: 'Training Data', value: data.trainingData },
            ].map((field) => (
              <div key={field.label} className="bg-zinc-800 rounded-lg p-4">
                <p className="text-zinc-400 text-xs font-semibold uppercase mb-1">{field.label}</p>
                <p className="text-zinc-200 text-sm">{field.value}</p>
              </div>
            ))}
          </div>

          {Object.keys(data.metrics).length > 0 && (
            <div className="bg-zinc-800 rounded-lg p-4">
              <p className="text-zinc-400 text-xs font-semibold uppercase mb-2">
                Performance Metrics
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(data.metrics).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-zinc-400">{key}</span>
                    <span className="text-white font-mono">{value.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {markdownView && (
        <div>
          <button
            onClick={() => {
              setMarkdownView(null);
            }}
            className="mb-3 px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors"
          >
            Back to Card View
          </button>
          <pre className="bg-zinc-800 rounded-lg p-4 text-sm text-zinc-200 whitespace-pre-wrap overflow-auto max-h-96">
            {markdownView}
          </pre>
        </div>
      )}
    </Section>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function ResponsibleAiPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <AlertTriangle className="w-7 h-7 text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Responsible AI</h1>
          <p className="text-zinc-400 text-sm">
            Bias detection, fairness analysis, explainability, provenance, and model documentation
          </p>
        </div>
      </div>

      <CohortErrorAnalysis />
      <FairnessMetrics />
      <ShapExplainability />
      <DataProvenance />
      <ModelCards />
    </div>
  );
}
