import { api } from '../lib/api';
import type {
  BuiltReport,
  GeneratedReportRow,
  ReportFormat,
  ReportKind,
  ReportSheet,
} from '../types/admin';

function asFormat(value: unknown): ReportFormat {
  if (value === 'csv' || value === 'pdf') {
    return value;
  }
  return 'xlsx';
}

function mapSheet(row: Record<string, unknown>): ReportSheet {
  return {
    name: String(row.name ?? 'Sheet'),
    rows: Array.isArray(row.rows)
      ? row.rows.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}))
      : [],
  };
}

function mapHistory(row: Record<string, unknown>): GeneratedReportRow {
  return {
    id: String(row.id ?? ''),
    report_name: String(row.report_name ?? 'Report'),
    report_type: String(row.report_type ?? 'Report'),
    date_range_label: String(row.date_range_label ?? '—'),
    generated_by: String(row.generated_by ?? 'Admin'),
    generated_date: String(row.generated_date ?? row.created_at ?? ''),
    format: asFormat(row.format),
    created_at: String(row.created_at ?? ''),
  };
}

export async function buildReport(
  kind: ReportKind,
  from: string,
  to: string
): Promise<BuiltReport> {
  const payload = await api<Record<string, unknown>>('/api/client-portal/reports/build', {
    method: 'POST',
    body: JSON.stringify({ kind, from, to }),
  });
  return {
    name: String(payload.name ?? 'Report'),
    type: String(payload.type ?? 'Report'),
    sheets: Array.isArray(payload.sheets)
      ? payload.sheets.map((sheet) => mapSheet(sheet as Record<string, unknown>))
      : [],
  };
}

export async function saveGeneratedReport(input: {
  name: string;
  type: string;
  from: string;
  to: string;
  rangeLabel: string;
  generatedBy: string;
  format: ReportFormat;
  payload: BuiltReport;
}): Promise<GeneratedReportRow> {
  const data = await api<Record<string, unknown>>('/api/client-portal/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return mapHistory(data);
}

export async function listGeneratedReports(): Promise<GeneratedReportRow[]> {
  const payload = await api<{ reports: Record<string, unknown>[] }>('/api/client-portal/reports');
  return Array.isArray(payload.reports) ? payload.reports.map(mapHistory) : [];
}

export async function getGeneratedReport(id: string): Promise<{
  meta: GeneratedReportRow;
  payload: BuiltReport;
}> {
  const row = await api<Record<string, unknown>>(`/api/client-portal/reports/${id}`);
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    meta: mapHistory(row),
    payload: {
      name: String(payload.name ?? row.report_name ?? 'Report'),
      type: String(payload.type ?? row.report_type ?? 'Report'),
      sheets: Array.isArray(payload.sheets)
        ? payload.sheets.map((sheet) => mapSheet(sheet as Record<string, unknown>))
        : [],
    },
  };
}
