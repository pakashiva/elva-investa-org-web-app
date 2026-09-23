import * as XLSX from 'xlsx';
import type { ReportFormat, ReportSheet } from '../types/admin';

function fileBase(name: string): string {
  return name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sheetRows(sheet: ReportSheet): Record<string, unknown>[] {
  return sheet.rows.length > 0 ? sheet.rows : [{ Notice: 'No rows in this range' }];
}

function toCsv(sheets: ReportSheet[]): string {
  return sheets
    .map((sheet) => {
      const rows = sheetRows(sheet);
      const headers = Object.keys(rows[0] ?? { Notice: '' });
      const lines = [
        headers.join(','),
        ...rows.map((row) =>
          headers
            .map((header) => {
              const value = row[header] == null ? '' : String(row[header]);
              if (/[",\n]/.test(value)) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return value;
            })
            .join(',')
        ),
      ];
      return [`# ${sheet.name}`, ...lines].join('\n');
    })
    .join('\n\n');
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toPdf(title: string, sheets: ReportSheet[]): Blob {
  const lines: string[] = [title, ''];
  for (const sheet of sheets) {
    lines.push(sheet.name);
    const rows = sheetRows(sheet);
    const headers = Object.keys(rows[0] ?? { Notice: '' });
    lines.push(headers.join(' | '));
    for (const row of rows.slice(0, 80)) {
      lines.push(headers.map((header) => String(row[header] ?? '')).join(' | '));
    }
    if (rows.length > 80) {
      lines.push(`… ${rows.length - 80} more rows`);
    }
    lines.push('');
  }

  const content = lines
    .slice(0, 52)
    .map((line, index) => `BT /F1 9 Tf 36 ${560 - index * 10} Td (${escapePdf(line.slice(0, 140))}) Tj ET`)
    .join('\n');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];

  let offset = 9;
  const offsets = [0];
  const body = objects
    .map((object) => {
      offsets.push(offset);
      const chunk = `${object}\n`;
      offset += chunk.length;
      return chunk;
    })
    .join('');

  const xref = `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((value) => `${String(value).padStart(10, '0')} 00000 n `)
    .join('\n')}\n`;

  const pdf = `%PDF-1.4\n${body}${xref}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

export function downloadReportFile(
  reportName: string,
  sheets: ReportSheet[],
  format: ReportFormat
) {
  const base = fileBase(reportName);
  if (format === 'csv') {
    triggerDownload(new Blob([toCsv(sheets)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
    return;
  }

  if (format === 'pdf') {
    triggerDownload(toPdf(reportName, sheets), `${base}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheetRows(sheet));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  triggerDownload(
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${base}.xlsx`
  );
}
