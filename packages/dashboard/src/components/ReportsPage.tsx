import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Loader2, Plus, CheckCircle, XCircle } from 'lucide-react';
import { fetchReports, generateReport, downloadReport } from '../api/client';
import type { ReportSummary } from '../api/client';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState('json');
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: fetchReports });
  const mutation = useMutation({
    mutationFn: generateReport,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const handleDownload = async (report: ReportSummary) => {
    try {
      const blob = await downloadReport(report.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `report-${report.id}.${report.format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // download failed silently
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Audit Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">Generate and download audit reports</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
            }}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="json">JSON</option>
            <option value="html">HTML</option>
            <option value="csv">CSV</option>
          </select>
          <button
            className="btn btn-ghost flex items-center gap-2"
            onClick={() => {
              mutation.mutate({
                title: `Security Report - ${new Date().toLocaleDateString()}`,
                format,
              });
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {mutation.isPending ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      {mutation.isPending && (
        <div className="card p-4 flex items-center gap-3 border-primary/30 bg-primary/5">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <p className="text-sm text-primary">Generating report, please wait...</p>
        </div>
      )}

      {mutation.isError && (
        <div className="card p-4 flex items-center gap-3 border-destructive/30 bg-destructive/5">
          <XCircle className="w-5 h-5 text-destructive" />
          <p className="text-sm text-destructive">Failed to generate report. Please try again.</p>
        </div>
      )}

      {mutation.isSuccess && !mutation.isPending && (
        <div className="card p-4 flex items-center gap-3 border-green-500/30 bg-green-500/5">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <p className="text-sm text-green-600">Report generated successfully.</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.reports.length && !mutation.isPending ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No reports generated yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.reports ?? []).map((report) => (
            <div key={report.id} className="card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium">{report.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(report.generatedAt).toLocaleString()} · {report.entryCount} entries ·{' '}
                    {(report.sizeBytes / 1024).toFixed(1)} KB · {report.format.toUpperCase()}
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost p-2"
                title="Download"
                onClick={() => void handleDownload(report)}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
