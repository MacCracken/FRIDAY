/**
 * Log Retention Settings
 *
 * Editable audit log retention policy with compressed backup export.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, Clock, Loader2, Download, Save, CheckCircle, AlertCircle } from 'lucide-react';
import { fetchAuditStats, enforceRetention, exportAuditBackup } from '../api/client';

export function LogRetentionSettings() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['audit-stats'],
    queryFn: fetchAuditStats,
  });

  const [maxAgeDays, setMaxAgeDays] = useState(90);
  const [maxEntries, setMaxEntries] = useState(100000);

  const retentionMutation = useMutation({
    mutationFn: () => enforceRetention({ maxAgeDays, maxEntries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-stats'] });
    },
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportAuditBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `friday-audit-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card p-4 space-y-4">
      <h3 className="font-medium text-sm flex items-center gap-2">
        <Database className="w-4 h-4" />
        Log Retention
      </h3>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading stats...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Total Audit Entries</p>
            <p className="text-lg font-bold">{stats?.totalEntries?.toLocaleString() ?? 0}</p>
          </div>
          {stats?.dbSizeEstimateMb !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground">Database Size</p>
              <p className="text-lg font-bold">{stats.dbSizeEstimateMb.toFixed(1)} MB</p>
            </div>
          )}
          {stats?.oldestEntry && (
            <div>
              <p className="text-xs text-muted-foreground">Oldest Entry</p>
              <p className="text-sm flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(stats.oldestEntry).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Retention Policy */}
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground mb-2">Retention Policy</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Max Retention Days</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={maxAgeDays}
              onChange={(e) => setMaxAgeDays(Number(e.target.value))}
              className="px-2 py-1 text-sm border rounded-md bg-background w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Max Entries</label>
            <input
              type="number"
              min={100}
              max={10000000}
              value={maxEntries}
              onChange={(e) => setMaxEntries(Number(e.target.value))}
              className="px-2 py-1 text-sm border rounded-md bg-background w-full"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => retentionMutation.mutate()}
            disabled={retentionMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {retentionMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Enforce Retention
          </button>

          {retentionMutation.isSuccess && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              Removed {retentionMutation.data.deletedCount.toLocaleString()} entries
            </span>
          )}
          {retentionMutation.isError && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {retentionMutation.error instanceof Error ? retentionMutation.error.message : 'Failed'}
            </span>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground mb-2">Backup</p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted/50 disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Export Audit Log
        </button>
        {exportError && (
          <p className="text-xs text-destructive mt-1 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {exportError}
          </p>
        )}
      </div>
    </div>
  );
}
