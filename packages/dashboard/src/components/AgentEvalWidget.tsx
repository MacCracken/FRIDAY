/**
 * Agent Eval Widget — Dashboard component for eval suite results.
 *
 * Displays: pass/fail summary, per-scenario results, historical trends.
 * Canvas type: 'eval-results'
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '../api/client';
import type { SuiteRunResult, EvalSuite } from '@secureyeoman/shared';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

interface SuiteListResponse {
  items: EvalSuite[];
  total: number;
}

interface RunListResponse {
  items: SuiteRunResult[];
  total: number;
}

export function AgentEvalWidget() {
  const [selectedSuite, setSelectedSuite] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: suites } = useQuery<SuiteListResponse>({
    queryKey: ['eval-suites'],
    queryFn: () => apiFetch('/eval/suites'),
    refetchInterval: 30_000,
  });

  const { data: runs } = useQuery<RunListResponse>({
    queryKey: ['eval-runs', selectedSuite],
    queryFn: () => apiFetch(`/eval/runs${selectedSuite ? `?suiteId=${selectedSuite}` : ''}`),
    refetchInterval: 10_000,
  });

  const { data: runDetail } = useQuery<SuiteRunResult>({
    queryKey: ['eval-run', selectedRun],
    queryFn: () => apiFetch(`/eval/runs/${selectedRun}`),
    enabled: !!selectedRun,
  });

  const runSuiteMutation = useMutation({
    mutationFn: (suiteId: string) => apiFetch(`/eval/suites/${suiteId}/run`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['eval-runs'] });
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">Agent Evaluation</h2>

      {/* Suite selector */}
      <div className="flex items-center gap-2">
        <label htmlFor="eval-suite-select" className="text-sm font-medium">
          Suite:
        </label>
        <select
          id="eval-suite-select"
          className="rounded border px-2 py-1 text-sm"
          value={selectedSuite ?? ''}
          onChange={(e) => {
            setSelectedSuite(e.target.value || null);
            setSelectedRun(null);
          }}
        >
          <option value="">All suites</option>
          {(suites?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {selectedSuite && (
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={runSuiteMutation.isPending}
            onClick={() => {
              runSuiteMutation.mutate(selectedSuite);
            }}
          >
            {runSuiteMutation.isPending ? 'Running...' : 'Run Suite'}
          </button>
        )}
      </div>

      {/* Run history */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase text-gray-500">
              <th className="px-2 py-1">Suite</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Passed</th>
              <th className="px-2 py-1">Failed</th>
              <th className="px-2 py-1">Errors</th>
              <th className="px-2 py-1">Duration</th>
              <th className="px-2 py-1">Tokens</th>
              <th className="px-2 py-1">Cost</th>
              <th className="px-2 py-1">Date</th>
            </tr>
          </thead>
          <tbody>
            {(runs?.items ?? []).map((run) => (
              <tr
                key={run.id}
                className="cursor-pointer border-b hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => {
                  setSelectedRun(run.id);
                }}
              >
                <td className="px-2 py-1">{run.suiteName}</td>
                <td className="px-2 py-1">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      run.passed
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}
                  >
                    {run.passed ? 'PASS' : 'FAIL'}
                  </span>
                </td>
                <td className="px-2 py-1 text-green-600">{run.passedCount}</td>
                <td className="px-2 py-1 text-red-600">{run.failedCount}</td>
                <td className="px-2 py-1 text-yellow-600">{run.errorCount}</td>
                <td className="px-2 py-1">{((run.totalDurationMs ?? 0) / 1000).toFixed(1)}s</td>
                <td className="px-2 py-1">{(run.totalTokens ?? 0).toLocaleString()}</td>
                <td className="px-2 py-1">${(run.totalCostUsd ?? 0).toFixed(4)}</td>
                <td className="px-2 py-1">{new Date(run.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Run detail — per-scenario results */}
      {runDetail && (
        <div className="mt-4 rounded border p-3">
          <h3 className="mb-2 font-medium">
            Run Detail: {runDetail.suiteName}
            <span
              className={`ml-2 text-sm ${runDetail.passed ? 'text-green-600' : 'text-red-600'}`}
            >
              ({runDetail.passedCount}/{runDetail.totalScenarios} passed)
            </span>
          </h3>
          <div className="space-y-2">
            {runDetail.results.map((sr, idx) => (
              <div
                key={idx}
                className={`rounded border-l-4 p-2 text-sm ${
                  sr.passed
                    ? 'border-green-500 bg-green-50 dark:bg-green-950'
                    : 'border-red-500 bg-red-50 dark:bg-red-950'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{sr.scenarioName}</span>
                  <span className="text-xs text-gray-500">
                    {sr.status} | {sr.durationMs}ms | {sr.totalTokens} tokens
                  </span>
                </div>
                {sr.errorMessage && (
                  <div className="mt-1 text-xs text-red-600">{sr.errorMessage}</div>
                )}
                {sr.toolCallErrors.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-red-600">
                    {sr.toolCallErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                {sr.forbiddenToolCallViolations.length > 0 && (
                  <div className="mt-1 text-xs text-red-600">
                    Forbidden tools called: {sr.forbiddenToolCallViolations.join(', ')}
                  </div>
                )}
                {sr.assertionResults.length > 0 && (
                  <div className="mt-1 text-xs">
                    {sr.assertionResults.map((ar, i) => (
                      <span
                        key={i}
                        className={`mr-1 ${ar.passed ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {ar.assertion.type}: {ar.passed ? 'pass' : 'fail'}
                        {ar.reason ? ` (${ar.reason})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
