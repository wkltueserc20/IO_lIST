import { create } from 'zustand';
import type { Device, IORow, ProjectData, MainSystemBrand } from '../types';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'FLOAT', 'STRING'];

type HistorySnapshot = {
  projectName: string;
  mainSystem: MainSystemBrand;
  dataTypes: string[];
  devices: Device[];
  selectedDeviceId: string | null;
};

function newRow(): IORow {
  return {
    id: crypto.randomUUID(),
    deviceAddress: '',
    signalName: '',
    dataType: '',
    mainSystemAddress: '',
    remark: '',
  };
}

interface ProjectStore {
  projectName: string;
  mainSystem: MainSystemBrand;
  dataTypes: string[];
  devices: Device[];
  selectedDeviceId: string | null;
  hasUnsavedChanges: boolean;
  fileHandle: FileSystemFileHandle | null;
  past: HistorySnapshot[];

  // Project
  setProjectName: (name: string) => void;
  setMainSystem: (brand: MainSystemBrand) => void;
  loadProject: (data: ProjectData) => void;
  getProjectData: () => ProjectData;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;

  // Devices
  addDevice: (name: string) => void;
  deleteDevice: (id: string) => void;
  selectDevice: (id: string | null) => void;
  renameDevice: (id: string, name: string) => void;

  // IO Rows
  addIORow: (deviceId: string, type: 'send' | 'receive') => string;
  deleteIORow: (deviceId: string, type: 'send' | 'receive', rowId: string) => void;
  updateIORow: (deviceId: string, type: 'send' | 'receive', rowId: string, field: keyof IORow, value: string) => void;
  insertRowsAfter: (deviceId: string, type: 'send' | 'receive', afterIndex: number, rows: Partial<IORow>[]) => void;
  clearCellRange: (deviceId: string, type: 'send' | 'receive', cells: { rowId: string; field: keyof IORow }[]) => void;

  // Data Types
  addDataType: (name: string) => boolean;
  removeDataType: (name: string) => void;

  // Batch replace
  batchReplaceAddress: (
    searchTerm: string,
    replaceTerm: string,
    targetColumns: ('deviceAddress' | 'mainSystemAddress')[],
    scope: 'current' | 'all',
    currentDeviceId: string,
    matchType: 'exact' | 'contains'
  ) => number;

  // Table clipboard (copy/paste)
  tableClipboard: { colKeys: (keyof IORow)[]; data: string[][] } | null;
  setTableClipboard: (cb: { colKeys: (keyof IORow)[]; data: string[][] } | null) => void;
  pasteClipboard: (deviceId: string, type: 'send' | 'receive', startRowIdx: number) => number;

  // Undo
  undo: () => void;

  markSaved: () => void;
}

function snap(s: ProjectStore): HistorySnapshot {
  return {
    projectName: s.projectName,
    mainSystem: s.mainSystem,
    dataTypes: s.dataTypes,
    devices: s.devices,
    selectedDeviceId: s.selectedDeviceId,
  };
}

function pushPast(past: HistorySnapshot[], entry: HistorySnapshot): HistorySnapshot[] {
  const next = [...past, entry];
  if (next.length > 50) next.shift();
  return next;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectName: '未命名專案',
  mainSystem: 'KEYENCE',
  dataTypes: [...DEFAULT_DATA_TYPES],
  devices: [],
  selectedDeviceId: null,
  hasUnsavedChanges: false,
  fileHandle: null,
  past: [],

  setProjectName: (name) => set((s) => ({ past: pushPast(s.past, snap(s)), projectName: name, hasUnsavedChanges: true })),
  setMainSystem: (brand) => set((s) => ({ past: pushPast(s.past, snap(s)), mainSystem: brand, hasUnsavedChanges: true })),
  setFileHandle: (handle) => set({ fileHandle: handle }),

  loadProject: (data) => set({
    projectName: data.project,
    mainSystem: data.mainSystem,
    dataTypes: data.dataTypes || [...DEFAULT_DATA_TYPES],
    devices: data.devices,
    selectedDeviceId: data.devices[0]?.id ?? null,
    hasUnsavedChanges: false,
    past: [],
  }),

  getProjectData: (): ProjectData => {
    const s = get();
    return {
      project: s.projectName,
      mainSystem: s.mainSystem,
      dataTypes: s.dataTypes,
      devices: s.devices,
    };
  },

  addDevice: (name) => {
    const device: Device = { id: crypto.randomUUID(), name, sendIO: [], receiveIO: [] };
    set((s) => ({
      past: pushPast(s.past, snap(s)),
      devices: [...s.devices, device],
      selectedDeviceId: device.id,
      hasUnsavedChanges: true,
    }));
  },

  deleteDevice: (id) => set((s) => {
    const devices = s.devices.filter((d) => d.id !== id);
    const selectedDeviceId = s.selectedDeviceId === id
      ? (devices[0]?.id ?? null)
      : s.selectedDeviceId;
    return { past: pushPast(s.past, snap(s)), devices, selectedDeviceId, hasUnsavedChanges: true };
  }),

  selectDevice: (id) => set({ selectedDeviceId: id }),

  renameDevice: (id, name) => set((s) => ({
    past: pushPast(s.past, snap(s)),
    devices: s.devices.map((d) => d.id === id ? { ...d, name } : d),
    hasUnsavedChanges: true,
  })),

  addIORow: (deviceId, type) => {
    const row = newRow();
    set((s) => ({
      past: pushPast(s.past, snap(s)),
      devices: s.devices.map((d) => {
        if (d.id !== deviceId) return d;
        const key = type === 'send' ? 'sendIO' : 'receiveIO';
        return { ...d, [key]: [...d[key], row] };
      }),
      hasUnsavedChanges: true,
    }));
    return row.id;
  },

  deleteIORow: (deviceId, type, rowId) => set((s) => ({
    past: pushPast(s.past, snap(s)),
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      return { ...d, [key]: d[key].filter((r) => r.id !== rowId) };
    }),
    hasUnsavedChanges: true,
  })),

  updateIORow: (deviceId, type, rowId, field, value) => set((s) => ({
    past: pushPast(s.past, snap(s)),
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      return { ...d, [key]: d[key].map((r) => r.id === rowId ? { ...r, [field]: value } : r) };
    }),
    hasUnsavedChanges: true,
  })),

  insertRowsAfter: (deviceId, type, afterIndex, rows) => set((s) => ({
    past: pushPast(s.past, snap(s)),
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      const existing = d[key];
      const newRows: IORow[] = rows.map((r) => ({ ...newRow(), ...r }));
      const updated = [
        ...existing.slice(0, afterIndex + 1),
        ...newRows,
        ...existing.slice(afterIndex + 1),
      ];
      return { ...d, [key]: updated };
    }),
    hasUnsavedChanges: true,
  })),

  clearCellRange: (deviceId, type, cells) => set((s) => ({
    past: pushPast(s.past, snap(s)),
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      return {
        ...d,
        [key]: d[key].map((r) => {
          const fields = cells.filter((c) => c.rowId === r.id).map((c) => c.field);
          if (fields.length === 0) return r;
          const updated = { ...r };
          fields.forEach((f) => { (updated as unknown as Record<string, string>)[f as string] = ''; });
          return updated;
        }),
      };
    }),
    hasUnsavedChanges: true,
  })),

  addDataType: (name) => {
    const s = get();
    if (s.dataTypes.some((t) => t.toLowerCase() === name.toLowerCase())) return false;
    set({ dataTypes: [...s.dataTypes, name], hasUnsavedChanges: true });
    return true;
  },

  removeDataType: (name) => {
    if (DEFAULT_DATA_TYPES.includes(name)) return;
    set((s) => ({ dataTypes: s.dataTypes.filter((t) => t !== name), hasUnsavedChanges: true }));
  },

  batchReplaceAddress: (searchTerm, replaceTerm, targetColumns, scope, currentDeviceId, matchType) => {
    const norm = (str: string) => str.trim().toUpperCase();
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    const applyReplace = (value: string): string => {
      if (!value || !searchTerm) return value;
      if (matchType === 'exact') {
        return norm(value) === norm(searchTerm) ? replaceTerm : value;
      }
      return value.replace(regex, replaceTerm);
    };

    let count = 0;
    const currentDevices = get().devices;
    const newDevices = currentDevices.map((device) => {
      if (scope === 'current' && device.id !== currentDeviceId) return device;

      const replaceRows = (rows: IORow[]) =>
        rows.map((row) => {
          const updated = { ...row };
          for (const col of targetColumns) {
            const next = applyReplace(row[col]);
            if (next !== row[col]) { updated[col] = next; count++; }
          }
          return updated;
        });

      return { ...device, sendIO: replaceRows(device.sendIO), receiveIO: replaceRows(device.receiveIO) };
    });

    set((cur) => ({ past: pushPast(cur.past, snap(cur)), devices: newDevices, hasUnsavedChanges: true }));
    return count;
  },

  tableClipboard: null,
  setTableClipboard: (cb) => set({ tableClipboard: cb }),
  pasteClipboard: (deviceId, type, startRowIdx) => {
    const { tableClipboard } = get();
    if (!tableClipboard) return 0;
    const { colKeys, data } = tableClipboard;
    let count = 0;
    const currentDevices = get().devices;
    const newDevices = currentDevices.map((device) => {
      if (device.id !== deviceId) return device;
      const storeKey = type === 'send' ? 'sendIO' : 'receiveIO';
      const rowList = [...device[storeKey]];
      data.forEach((rowData, i) => {
        const targetIdx = startRowIdx + i;
        if (targetIdx < rowList.length) {
          const updated = { ...rowList[targetIdx] };
          colKeys.forEach((col, j) => { if (j < rowData.length) (updated as unknown as Record<string, string>)[col] = rowData[j]; });
          rowList[targetIdx] = updated;
        } else {
          const nr = newRow();
          colKeys.forEach((col, j) => { if (j < rowData.length) (nr as unknown as Record<string, string>)[col] = rowData[j]; });
          rowList.push(nr);
        }
        count++;
      });
      return { ...device, [storeKey]: rowList };
    });
    set((cur) => ({ past: pushPast(cur.past, snap(cur)), devices: newDevices, hasUnsavedChanges: true }));
    return count;
  },

  undo: () => set((s) => {
    if (s.past.length === 0) return {};
    const prev = s.past[s.past.length - 1];
    return {
      past: s.past.slice(0, -1),
      projectName: prev.projectName,
      mainSystem: prev.mainSystem,
      dataTypes: prev.dataTypes,
      devices: prev.devices,
      selectedDeviceId: prev.selectedDeviceId,
      hasUnsavedChanges: true,
    };
  }),

  markSaved: () => set({ hasUnsavedChanges: false }),
}));

export { DEFAULT_DATA_TYPES };
