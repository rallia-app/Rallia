/**
 * Export Service
 *
 * Provides functionality to export data to CSV and PDF formats.
 * Uses Expo FileSystem, Sharing, and Print for file operations.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Logger } from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface ExportColumn<T> {
  key: keyof T | string;
  header: string;
  formatter?: (value: unknown, row: T) => string;
}

export interface ExportOptions {
  filename: string;
  format: 'csv' | 'json' | 'pdf';
}

export interface PDFExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}

// =============================================================================
// CSV UTILITIES
// =============================================================================

/**
 * Escape a value for CSV format
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If the value contains a comma, newline, or double quote, wrap it in quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    // Double any existing double quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Convert an array of objects to CSV format
 */
export function toCSV<T>(
  data: T[],
  columns: ExportColumn<T>[]
): string {
  // Create header row
  const headers = columns.map(col => escapeCSVValue(col.header));
  const headerRow = headers.join(',');

  // Create data rows
  const dataRows = data.map(row => {
    const values = columns.map(col => {
      const key = col.key as keyof T;
      const rowRecord = row as Record<string, unknown>;
      const value = typeof key === 'string' && (key as string).includes('.')
        ? getNestedValue(rowRecord, key as string)
        : rowRecord[key as string];

      if (col.formatter) {
        return escapeCSVValue(col.formatter(value, row));
      }

      return escapeCSVValue(value);
    });

    return values.join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// =============================================================================
// PDF UTILITIES
// =============================================================================

/**
 * Generate HTML table for PDF export
 */
function generateHTMLTable<T>(
  data: T[],
  columns: ExportColumn<T>[],
  options: PDFExportOptions
): string {
  const headerCells = columns
    .map(col => `<th style="border: 1px solid #ddd; padding: 8px; background-color: #4a90d9; color: white; text-align: left;">${escapeHTML(col.header)}</th>`)
    .join('');

  const rows = data.map((row, index) => {
    const rowRecord = row as Record<string, unknown>;
    const cells = columns.map(col => {
      const key = col.key as keyof T;
      const value = typeof key === 'string' && (key as string).includes('.')
        ? getNestedValue(rowRecord, key as string)
        : rowRecord[key as string];
      
      const displayValue = col.formatter 
        ? col.formatter(value, row)
        : (value ?? '');
      
      return `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHTML(String(displayValue))}</td>`;
    }).join('');
    
    const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
    return `<tr style="background-color: ${bgColor};">${cells}</tr>`;
  }).join('');

  const timestamp = new Date().toLocaleString();
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHTML(options.title)}</title>
        <style>
          @page {
            size: ${options.orientation === 'landscape' ? 'landscape' : 'portrait'};
            margin: 20mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 12px;
            color: #333;
            line-height: 1.4;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #4a90d9;
          }
          .header h1 {
            margin: 0;
            color: #4a90d9;
            font-size: 24px;
          }
          .header p {
            margin: 5px 0 0 0;
            color: #666;
            font-size: 14px;
          }
          .meta {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            font-size: 11px;
            color: #666;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
          }
          .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 10px;
            color: #999;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHTML(options.title)}</h1>
          ${options.subtitle ? `<p>${escapeHTML(options.subtitle)}</p>` : ''}
        </div>
        <div class="meta">
          <span>Total Records: ${data.length}</span>
          <span>Generated: ${timestamp}</span>
        </div>
        <table>
          <thead>
            <tr>${headerCells}</tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="footer">
          <p>Rallia Admin Export - Confidential</p>
        </div>
      </body>
    </html>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHTML(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

// =============================================================================
// EXPORT FUNCTIONS
// =============================================================================

/**
 * Export data to a file and share it (CSV or JSON)
 */
export async function exportData<T>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions
): Promise<boolean> {
  try {
    // For PDF, use the dedicated PDF export function
    if (options.format === 'pdf') {
      return exportToPDF(data, columns, {
        filename: options.filename,
        title: options.filename.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      });
    }

    let content: string;
    let mimeType: string;
    let fileExtension: string;

    if (options.format === 'csv') {
      content = toCSV(data, columns);
      mimeType = 'text/csv';
      fileExtension = 'csv';
    } else {
      content = JSON.stringify(data, null, 2);
      mimeType = 'application/json';
      fileExtension = 'json';
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${options.filename}_${timestamp}.${fileExtension}`;
    
    // Create file in cache directory
    const file = new File(Paths.cache, filename);
    
    // Write file content
    await file.write(content);

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();

    if (isAvailable) {
      await Sharing.shareAsync(file.uri, {
        mimeType,
        dialogTitle: `Export ${options.filename}`,
        UTI: options.format === 'csv' ? 'public.comma-separated-values-text' : 'public.json',
      });

      Logger.logUserAction('data_exported', {
        filename,
        format: options.format,
        rowCount: data.length,
      });

      return true;
    } else {
      Logger.warn('Sharing not available on this device');
      return false;
    }
  } catch (error) {
    Logger.error('Failed to export data', error as Error);
    throw error;
  }
}

/**
 * Export data to PDF format and share it
 */
export async function exportToPDF<T>(
  data: T[],
  columns: ExportColumn<T>[],
  options: PDFExportOptions
): Promise<boolean> {
  try {
    // Generate HTML content
    const html = generateHTMLTable(data, columns, options);

    // Generate PDF file
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();

    if (isAvailable) {
      // Generate a better filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const shareOptions = {
        mimeType: 'application/pdf',
        dialogTitle: `Export ${options.title}`,
        UTI: 'com.adobe.pdf',
      };

      await Sharing.shareAsync(uri, shareOptions);

      Logger.logUserAction('data_exported', {
        filename: `${options.filename}_${timestamp}.pdf`,
        format: 'pdf',
        rowCount: data.length,
      });

      return true;
    } else {
      Logger.warn('Sharing not available on this device');
      return false;
    }
  } catch (error) {
    Logger.error('Failed to export PDF', error as Error);
    throw error;
  }
}

// =============================================================================
// PREDEFINED EXPORT CONFIGURATIONS
// =============================================================================

/**
 * Export users to CSV
 */
export interface UserExportData {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  last_active: string | null;
  status: string;
  email_verified: boolean;
}

export const userExportColumns: ExportColumn<UserExportData>[] = [
  { key: 'id', header: 'User ID' },
  { key: 'email', header: 'Email' },
  { key: 'first_name', header: 'First Name' },
  { key: 'last_name', header: 'Last Name' },
  {
    key: 'created_at',
    header: 'Created At',
    formatter: (value) => value ? new Date(value as string).toLocaleDateString() : '',
  },
  {
    key: 'last_active',
    header: 'Last Active',
    formatter: (value) => value ? new Date(value as string).toLocaleDateString() : 'Never',
  },
  { key: 'status', header: 'Status' },
  {
    key: 'email_verified',
    header: 'Email Verified',
    formatter: (value) => value ? 'Yes' : 'No',
  },
];

export async function exportUsers(users: UserExportData[]): Promise<boolean> {
  return exportData(users, userExportColumns, {
    filename: 'users_export',
    format: 'csv',
  });
}

/**
 * Export users to PDF
 */
export async function exportUsersToPDF(users: UserExportData[]): Promise<boolean> {
  return exportToPDF(users, userExportColumns, {
    filename: 'users_export',
    title: 'User Export Report',
    subtitle: `Total Users: ${users.length}`,
    orientation: 'landscape',
  });
}

/**
 * Export audit logs to CSV
 */
export interface AuditLogExportData {
  id: string;
  admin_id: string;
  admin_name: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  severity: string;
  created_at: string;
  ip_address: string | null;
}

export const auditLogExportColumns: ExportColumn<AuditLogExportData>[] = [
  { key: 'id', header: 'Log ID' },
  {
    key: 'created_at',
    header: 'Timestamp',
    formatter: (value) => value ? new Date(value as string).toLocaleString() : '',
  },
  { key: 'admin_name', header: 'Admin' },
  { key: 'action_type', header: 'Action' },
  { key: 'entity_type', header: 'Entity Type' },
  { key: 'entity_id', header: 'Entity ID' },
  { key: 'description', header: 'Description' },
  { key: 'severity', header: 'Severity' },
  { key: 'ip_address', header: 'IP Address' },
];

export async function exportAuditLogs(logs: AuditLogExportData[]): Promise<boolean> {
  return exportData(logs, auditLogExportColumns, {
    filename: 'audit_log_export',
    format: 'csv',
  });
}

/**
 * Export audit logs to PDF
 */
export async function exportAuditLogsToPDF(logs: AuditLogExportData[]): Promise<boolean> {
  return exportToPDF(logs, auditLogExportColumns, {
    filename: 'audit_log_export',
    title: 'Audit Log Report',
    subtitle: `Total Entries: ${logs.length}`,
    orientation: 'landscape',
  });
}

// =============================================================================
// EXPORT DEFAULT
// =============================================================================

export const exportService = {
  toCSV,
  exportData,
  exportToPDF,
  exportUsers,
  exportUsersToPDF,
  exportAuditLogs,
  exportAuditLogsToPDF,
  userExportColumns,
  auditLogExportColumns,
};

export default exportService;
