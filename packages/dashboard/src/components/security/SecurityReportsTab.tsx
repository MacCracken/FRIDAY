import { useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Download, Loader2, XCircle, CheckCircle } from 'lucide-react';
import {
  fetchReports,
  generateReport,
  downloadReport,
  exportAuditLog,
  fetchDepartments,
  fetchDepartmentReport,
  fetchExecutiveReport,
  fetchRegisterReport,
} from '../../api/client';
import type { ReportSummary } from '../../api/client';

const AuditLogTab = lazy(() =>
  import('./SecurityAuditTab').then((m) => ({ default: m.AuditLogTab }))
);

type ReportType =
  | 'audit-report'
  | 'audit-export'
  | 'department-scorecard'
  | 'executive-summary'
  | 'register-report';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'audit-report', label: 'Audit Report' },
  { value: 'audit-export', label: 'Audit Log Export' },
  { value: 'department-scorecard', label: 'Department Scorecard' },
  { value: 'executive-summary', label: 'Executive Summary' },
  { value: 'register-report', label: 'Register Report' },
];

const FORMAT_OPTIONS: Record<ReportType, string[]> = {
  'audit-report': ['json', 'html', 'csv'],
  'audit-export': ['jsonl', 'csv', 'syslog'],
  'department-scorecard': ['json', 'html', 'md', 'csv'],
  'executive-summary': ['json', 'html', 'md'],
  'register-report': ['json', 'csv'],
};

const NEEDS_DEPARTMENT: Record<ReportType, 'required' | 'optional' | false> = {
  'audit-report': false,
  'audit-export': false,
  'department-scorecard': 'required',
  'executive-summary': false,
  'register-report': 'optional',
};

interface ReportsTabProps {
  reviewed?: Set<string>;
  onMarkReviewed?: (ids: string[]) => void;
  onMarkAllReviewed?: () => Promise<void>;
}

export function ReportsTab({ reviewed, onMarkReviewed, onMarkAllReviewed }: ReportsTabProps) {
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<ReportType>('audit-report');
  const [format, setFormat] = useState('json');
  const [selectedDept, setSelectedDept] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: fetchReports });

  const { data: deptsData } = useQuery({
    queryKey: ['risk-departments'],
    queryFn: () => fetchDepartments(),
    staleTime: 30_000,
  });
  const departments = deptsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      switch (reportType) {
        case 'audit-report':
          await generateReport({
            title: `Audit Report - ${new Date().toLocaleDateString()}`,
            format,
          });
          void queryClient.invalidateQueries({ queryKey: ['reports'] });
          return;
        case 'audit-export': {
          const blob = await exportAuditLog({ format: format as 'jsonl' | 'csv' | 'syslog' });
          triggerDownload(blob, `audit-export.${format}`);
          return;
        }
        case 'department-scorecard': {
          if (!selectedDept) throw new Error('Select a department');
          const text = await fetchDepartmentReport(selectedDept, format);
          triggerDownload(new Blob([text]), `dept-scorecard.${format}`);
          return;
        }
        case 'executive-summary': {
          const text = await fetchExecutiveReport(format);
          triggerDownload(new Blob([text]), `executive-summary.${format}`);
          return;
        }
        case 'register-report': {
          const text = await fetchRegisterReport({
            format,
            departmentId: selectedDept || undefined,
          });
          triggerDownload(new Blob([text]), `register-report.${format}`);
          return;
        }
      }
    },
  });

  const handleTypeChange = (type: ReportType) => {
    setReportType(type);
    const formats = FORMAT_OPTIONS[type];
    if (!formats.includes(format)) setFormat(formats[0]);
    if (!NEEDS_DEPARTMENT[type]) setSelectedDept('');
  };

  const handleDownload = async (report: ReportSummary) => {
    try {
      const blob = await downloadReport(report.id);
      triggerDownload(blob, `report-${report.id}.${report.format}`);
    } catch {
      // download failed silently
    }
  };

  const needsDept = NEEDS_DEPARTMENT[reportType];

  return (
    <div className="space-y-8">
      {/* Report Generation */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Generate Report</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Generate audit, department, and executive reports
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Report Type
            </label>
            <select
              value={reportType}
              onChange={(e) => {
                handleTypeChange(e.target.value as ReportType);
              }}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
              data-testid="report-type-select"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
              }}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
              data-testid="report-format-select"
            >
              {FORMAT_OPTIONS[reportType].map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {needsDept && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Department{needsDept === 'optional' ? ' (optional)' : ''}
              </label>
              <select
                value={selectedDept}
                onChange={(e) => {
                  setSelectedDept(e.target.value);
                }}
                className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
                data-testid="department-select"
              >
                <option value="">
                  {needsDept === 'required' ? 'Select department...' : 'All departments'}
                </option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="btn btn-ghost flex items-center gap-2"
            onClick={() => {
              mutation.mutate();
            }}
            disabled={mutation.isPending || (needsDept === 'required' && !selectedDept)}
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {mutation.isPending ? 'Generating...' : 'Generate'}
          </button>
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
      </div>

      {/* Existing Reports List */}
      <div className="space-y-4">
        <h3 className="font-semibold">Generated Reports</h3>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.reports.length ? (
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
                    <p className="font-medium text-sm">{report.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {report.format.toUpperCase()} •{' '}
                      {new Date(report.generatedAt).toLocaleString()} • {report.entryCount} entries
                    </p>
                  </div>
                </div>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => void handleDownload(report)}
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log Section */}
      <div className="border-t border-border pt-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <AuditLogTab
            reviewed={reviewed ?? new Set()}
            onMarkReviewed={onMarkReviewed ?? (() => {})}
            onMarkAllReviewed={
              onMarkAllReviewed ??
              (() => {
                void Promise.resolve();
              })
            }
          />
        </Suspense>
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
