import * as XLSX from 'xlsx';
import type { ProjectData } from '../types';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'FLOAT', 'STRING'];
const hasFileSystemAccess = 'showOpenFilePicker' in window;

// ── 解析專案 JSON ──────────────────────────────────────────

async function parseProjectFile(file: File): Promise<ProjectData> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed.devices || !Array.isArray(parsed.devices)) {
    throw new Error('無效的專案檔案格式');
  }
  if (!parsed.dataTypes) parsed.dataTypes = [...DEFAULT_DATA_TYPES];
  return parsed as ProjectData;
}

// ── 開啟 ──────────────────────────────────────────────────

/** 使用 File System Access API 開啟，回傳資料與 handle；取消回傳 null；不支援則回傳 null（呼叫端 fallback 到 input）*/
export async function openFileWithPicker(): Promise<{ data: ProjectData; handle: FileSystemFileHandle } | null> {
  if (!hasFileSystemAccess) return null;
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'JSON 專案檔', accept: { 'application/json': ['.json'] } }],
    });
    const file: File = await handle.getFile();
    const data = await parseProjectFile(file);
    return { data, handle };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

/** Fallback：給 <input type="file"> 使用 */
export async function loadFromJSON(file: File): Promise<ProjectData> {
  return parseProjectFile(file);
}

// ── 存檔 ──────────────────────────────────────────────────

/** 直接寫入已持有的 FileSystemFileHandle（存檔） */
export async function saveToFileHandle(data: ProjectData, handle: FileSystemFileHandle): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/** 顯示儲存對話框（另存新檔），回傳新 handle；取消回傳 null；不支援則 fallback 下載 */
export async function saveAsFile(data: ProjectData): Promise<FileSystemFileHandle | null> {
  if (hasFileSystemAccess) {
    try {
      const handle = await (window as any).showSaveFilePicker({
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
  // Fallback：觸發下載
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

// ── Excel 匯出 ────────────────────────────────────────────

export function exportToExcel(data: ProjectData): void {
  const wb = XLSX.utils.book_new();

  // 設備清單 Sheet（第一個）
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

  // 各設備 IO Sheet
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

  XLSX.writeFile(wb, `${data.project || 'export'}.xlsx`, { bookSST: true });
}
