import * as XLSX from 'xlsx';
import type { IORow } from '../types';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'FLOAT', 'STRING'];

export interface ParsedDevice {
  name: string;
  ip: string;
  port: string;
  sendIO: IORow[];
  receiveIO: IORow[];
}

export interface ParsedResult {
  projectName: string;
  devices: ParsedDevice[];
  dataTypes: string[];
}

function cellStr(row: unknown[], idx: number): string {
  const v = (row as unknown[])[idx];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function isEffectiveRow(row: unknown[]): boolean {
  // A data row must have at least one non-empty value in columns 0-5
  for (let i = 0; i < 6; i++) {
    if (cellStr(row, i) !== '') return true;
  }
  return false;
}

function parseDeviceSheet(ws: XLSX.WorkSheet): { sendIO: IORow[]; receiveIO: IORow[] } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  const sendIO: IORow[] = [];
  const receiveIO: IORow[] = [];

  type Mode = 'init' | 'send-header' | 'send-data' | 'recv-header' | 'recv-data';
  let mode: Mode = 'init';
  let defaultMode: 'send-data' | 'recv-data' | null = null;

  for (const raw of rows) {
    const row = raw as unknown[];
    const first = cellStr(row, 0);

    if (first.includes('▼ 設備發送 IO')) { mode = 'send-header'; continue; }
    if (first.includes('▼ 設備接受 IO')) { mode = 'recv-header'; continue; }

    if (mode === 'send-header') { mode = 'send-data'; continue; } // skip header row
    if (mode === 'recv-header') { mode = 'recv-data'; continue; }

    if (!isEffectiveRow(row)) continue;

    // Skip metadata-style rows (1st col contains 設備：)
    if (first.startsWith('設備：')) continue;

    // Skip column-header rows
    if (first === '設備名稱' && cellStr(row, 1) === '設備IO點位位址') continue;

    const ioRow: IORow = {
      id: crypto.randomUUID(),
      deviceAddress:     cellStr(row, 1),
      signalName:        cellStr(row, 2),
      dataType:          cellStr(row, 3),
      mainSystemAddress: cellStr(row, 4),
      remark:            cellStr(row, 5),
    };

    if (mode === 'send-data') { sendIO.push(ioRow); continue; }
    if (mode === 'recv-data') { receiveIO.push(ioRow); continue; }

    // No section header found yet — remember we've seen data and default to sendIO
    if (defaultMode === null) defaultMode = 'send-data';
    if (defaultMode === 'send-data') sendIO.push(ioRow);
  }

  return { sendIO, receiveIO };
}

function collectDataTypes(devices: ParsedDevice[]): string[] {
  const seen = new Set<string>(DEFAULT_DATA_TYPES);
  for (const d of devices) {
    for (const row of [...d.sendIO, ...d.receiveIO]) {
      if (row.dataType) seen.add(row.dataType);
    }
  }
  return Array.from(seen);
}

export function parseExcelToProjectData(wb: XLSX.WorkBook, fileName: string): ParsedResult {
  const projectName = fileName.replace(/\.xlsx$/i, '');
  const sheetNames = wb.SheetNames;

  // ── Step 1: Read device list from 設備清單 sheet ─────────────
  const summarySheet = wb.Sheets['設備清單'];
  let baseDevices: Array<{ name: string; ip: string; port: string }> = [];

  if (summarySheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(summarySheet, { header: 1, defval: '' });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const name = cellStr(row, 0);
      if (!name) continue;
      const ip = cellStr(row, 1) === '（未設定）' ? '' : cellStr(row, 1);
      const port = cellStr(row, 2);
      baseDevices.push({ name, ip, port });
    }
  } else {
    // Fallback: infer from sheet names excluding 設備清單
    baseDevices = sheetNames
      .filter((n) => n !== '設備清單')
      .map((name) => ({ name, ip: '', port: '' }));
  }

  // ── Step 2: Parse IO for each device ─────────────────────────
  const devices: ParsedDevice[] = baseDevices.map(({ name, ip, port }) => {
    // Find matching sheet: exact first, then 31-char prefix
    const exactSheet = wb.Sheets[name];
    const prefixSheet = !exactSheet
      ? wb.Sheets[sheetNames.find((s) => s === name.substring(0, 31)) ?? '']
      : undefined;
    const ws = exactSheet ?? prefixSheet;

    const { sendIO, receiveIO } = ws ? parseDeviceSheet(ws) : { sendIO: [], receiveIO: [] };
    return { name, ip, port, sendIO, receiveIO };
  });

  const dataTypes = collectDataTypes(devices);
  return { projectName, devices, dataTypes };
}
