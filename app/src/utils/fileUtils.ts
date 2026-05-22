import * as XLSX from 'xlsx';
import type { ProjectData } from '../types';
import { parseExcelToProjectData } from './excelImport';
import type { ParsedResult } from './excelImport';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'DINT', 'UDINT', 'FLOAT', 'STRING'];
const hasFileSystemAccess = 'showOpenFilePicker' in window;

export const isTauri = (): boolean => !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

// ── Tauri IPC helpers (lazy-imported to avoid errors in browser) ──

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function tauriOpenDialog(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ filters: [{ name: 'JSON 專案檔', extensions: ['json'] }], multiple: false });
  if (Array.isArray(result)) return result[0] ?? null;
  return result ?? null;
}

async function tauriSaveDialog(
  suggestedName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({
    defaultPath: suggestedName,
    filters: filters ?? [{ name: 'JSON 專案檔', extensions: ['json'] }],
  });
}

// ── 解析專案 JSON ─────────────────────────────────────────────

function parseProjectJSON(text: string): ProjectData {
  const parsed = JSON.parse(text);
  if (!parsed.devices || !Array.isArray(parsed.devices)) {
    throw new Error('無效的專案檔案格式');
  }
  if (!parsed.dataTypes) parsed.dataTypes = [...DEFAULT_DATA_TYPES];
  return parsed as ProjectData;
}

async function parseProjectFile(file: File): Promise<ProjectData> {
  return parseProjectJSON(await file.text());
}

// ── 開啟 ─────────────────────────────────────────────────────

/**
 * 開啟檔案對話框並載入資料。
 * - Tauri：使用原生 dialog + read_file command，回傳 { data, path }
 * - 瀏覽器（File System Access API）：回傳 { data, handle }
 * - 瀏覽器 fallback：回傳 null（呼叫端自行使用 <input>）
 */
export async function openFileWithPicker(): Promise<
  | { data: ProjectData; path: string; handle: null }
  | { data: ProjectData; path: null; handle: FileSystemFileHandle }
  | null
> {
  if (isTauri()) {
    const path = await tauriOpenDialog();
    if (!path) return null;
    const text = await tauriInvoke<string>('read_file', { path });
    return { data: parseProjectJSON(text), path, handle: null };
  }

  if (!hasFileSystemAccess) return null;

  try {
    const [handle] = await (window as unknown as {
      showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
    }).showOpenFilePicker({
      types: [{ description: 'JSON 專案檔', accept: { 'application/json': ['.json'] } }],
    });
    const file: File = await handle.getFile();
    const data = await parseProjectFile(file);
    return { data, path: null, handle };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

/** Fallback：給 <input type="file"> 使用（瀏覽器無 File System Access API） */
export async function loadFromJSON(file: File): Promise<ProjectData> {
  return parseProjectFile(file);
}

// ── 存檔 ─────────────────────────────────────────────────────

/** Tauri：直接覆寫指定路徑（存檔） */
export async function saveToFilePath(path: string, data: ProjectData): Promise<void> {
  await tauriInvoke('write_file', { path, content: JSON.stringify(data, null, 2) });
}

/** 瀏覽器：直接寫入已持有的 FileSystemFileHandle（存檔） */
export async function saveToFileHandle(data: ProjectData, handle: FileSystemFileHandle): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/**
 * 另存新檔對話框。
 * - Tauri：使用原生 save dialog + write_file，回傳路徑字串
 * - 瀏覽器（File System Access API）：回傳 FileSystemFileHandle
 * - 瀏覽器 fallback：觸發下載，回傳 null
 */
export async function saveAsFile(data: ProjectData): Promise<string | FileSystemFileHandle | null> {
  if (isTauri()) {
    const path = await tauriSaveDialog(`${data.project || 'project'}.json`);
    if (!path) return null;
    await saveToFilePath(path, data);
    return path;
  }

  if (hasFileSystemAccess) {
    try {
      const handle = await (window as unknown as {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: `${data.project || 'project'}.json`,
        types: [{ description: 'JSON 專案檔', accept: { 'application/json': ['.json'] } }],
      });
      await saveToFileHandle(data, handle);
      return handle;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  downloadJSON(data);
  return null;
}

function downloadJSON(data: ProjectData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.project || 'project'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 最近開啟 ─────────────────────────────────────────────────

const RECENT_FILE_NAME = 'recent-files.json';
const MAX_RECENT = 10;

export async function loadRecentFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const dir = await tauriInvoke<string>('get_app_data_dir');
    const path = `${dir}/${RECENT_FILE_NAME}`;
    const text = await tauriInvoke<string>('read_file', { path });
    return JSON.parse(text) as string[];
  } catch {
    return [];
  }
}

export async function saveRecentFiles(paths: string[]): Promise<void> {
  if (!isTauri()) return;
  try {
    const dir = await tauriInvoke<string>('get_app_data_dir');
    const path = `${dir}/${RECENT_FILE_NAME}`;
    await tauriInvoke('write_file', { path, content: JSON.stringify(paths) });
  } catch {
    // best-effort — ignore errors
  }
}

export function addToRecentFiles(newPath: string, existing: string[]): string[] {
  const deduped = existing.filter((p) => p !== newPath);
  return [newPath, ...deduped].slice(0, MAX_RECENT);
}

// ── Excel 匯入 ────────────────────────────────────────────────

export async function importFromExcel(): Promise<{ result: ParsedResult; fileName: string } | null> {
  let base64: string;
  let fileName: string;

  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ filters: [{ name: 'Excel 檔案', extensions: ['xlsx'] }], multiple: false });
    const path = Array.isArray(selected) ? selected[0] ?? null : selected ?? null;
    if (!path) return null;
    base64 = await tauriInvoke<string>('read_file_base64', { path });
    fileName = path.split(/[\\/]/).pop() ?? path;
  } else {
    try {
      const [handle] = await (window as unknown as {
        showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker({
        types: [{ description: 'Excel 檔案', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      });
      const file: File = await handle.getFile();
      fileName = file.name;
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      base64 = btoa(binary);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  const wb = XLSX.read(base64, { type: 'base64' });
  const result = parseExcelToProjectData(wb, fileName);
  return { result, fileName };
}

// ── Excel 匯出 ────────────────────────────────────────────────

export async function exportToExcel(data: ProjectData, currentFilePath?: string | null): Promise<boolean> {
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number)[][] = [
    ['設備名稱', 'IP 位址', 'Port', '備註'],
    ...data.devices.map((d) => [
      d.name,
      d.ip || '（未設定）',
      d.port || '',
      '',
    ]),
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summaryWs, '設備清單');

  for (const device of data.devices) {
    const ipMeta = `設備：${device.name}    IP：${device.ip || '未設定'}    Port：${device.port || '—'}`;
    const rows: (string | number)[][] = [];
    const headers = ['設備名稱', '設備IO點位位址', '訊號名稱', '資料類型', '主系統點位位址', '備註'];

    rows.push([ipMeta]);
    rows.push([]);

    rows.push(['▼ 設備發送 IO']);
    rows.push(headers);
    for (const row of device.sendIO) {
      rows.push([device.name, row.deviceAddress, row.signalName, row.dataType, row.mainSystemAddress, row.remark]);
    }

    rows.push([]);

    rows.push(['▼ 設備接受 IO']);
    rows.push(headers);
    for (const row of device.receiveIO) {
      rows.push([device.name, row.deviceAddress, row.signalName, row.dataType, row.mainSystemAddress, row.remark]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, device.name.substring(0, 31));
  }

  if (isTauri()) {
    const fileName = `${data.project || 'export'}.xlsx`;
    const sep = currentFilePath
      ? Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\'))
      : -1;
    const defaultPath = sep >= 0
      ? `${currentFilePath!.substring(0, sep + 1)}${fileName}`
      : fileName;
    const path = await tauriSaveDialog(
      defaultPath,
      [{ name: 'Excel 檔案', extensions: ['xlsx'] }],
    );
    if (!path) return false;
    const content = XLSX.write(wb, { type: 'base64', bookSST: true }) as string;
    await tauriInvoke('write_file_base64', { path, content });
  } else {
    XLSX.writeFile(wb, `${data.project || 'export'}.xlsx`, { bookSST: true });
  }
  return true;
}
