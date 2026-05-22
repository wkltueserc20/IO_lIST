import { create } from 'zustand';
import type { Device, IORow, ProjectData, MainSystemBrand, ConnectionStatus, PlcBrand, PlcValue } from '../types';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'DINT', 'UDINT', 'FLOAT', 'STRING'];

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
  currentFilePath: string | null;
  recentFiles: string[];
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  // Project
  setProjectName: (name: string) => void;
  setMainSystem: (brand: MainSystemBrand) => void;
  loadProject: (data: ProjectData) => void;
  getProjectData: () => ProjectData;
  setCurrentFilePath: (path: string | null) => void;
  setRecentFiles: (paths: string[]) => void;

  // Devices
  addDevice: (name: string) => void;
  deleteDevice: (id: string) => void;
  selectDevice: (id: string | null) => void;
  renameDevice: (id: string, name: string) => void;
  reorderDevices: (fromId: string, toId: string) => void;
  cloneDevice: (id: string) => void;
  updateDeviceSettings: (id: string, ip: string, port: string) => void;
  checkDuplicateIP: (ip: string, port: string, excludeId: string) => { type: 'none' | 'warn' | 'error'; deviceName?: string };

  // IO Rows
  addIORow: (deviceId: string, type: 'send' | 'receive') => string;
  reorderIORows: (deviceId: string, type: 'send' | 'receive', fromId: string, toId: string) => void;
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
  redo: () => void;

  markSaved: () => void;
  lastSavedAt: Date | null;

  // UI feedback
  savedTip: boolean;
  showSavedTip: () => void;
  exportTip: boolean;
  showExportTip: () => void;

  // View mode
  viewMode: 'device' | 'main-system';
  setViewMode: (mode: 'device' | 'main-system') => void;

  // Connection status (runtime only, not persisted in history snapshots)
  connectionStatus: Record<string, ConnectionStatus>;
  setConnectionStatus: (deviceId: string, status: ConnectionStatus) => void;

  // PLC live monitor (runtime only, not persisted in history snapshots)
  monitoringDevices: Set<string>;
  pollingInterval: number;
  plcValues: Record<string, Record<string, PlcValue>>;
  startMonitoring: (id: string) => void;
  stopMonitoring: (id: string) => void;
  setPollingInterval: (ms: number) => void;
  setPlcValues: (deviceId: string, values: Record<string, PlcValue>) => void;
  updateDevicePlcBrand: (id: string, brand: PlcBrand) => void;
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
  currentFilePath: null,
  recentFiles: [],
  past: [],
  future: [],
  connectionStatus: {},
  monitoringDevices: new Set<string>(),
  pollingInterval: 1000,
  plcValues: {},

  setProjectName: (name) => set((s) => ({ past: pushPast(s.past, snap(s)), future: [], projectName: name, hasUnsavedChanges: true })),
  setMainSystem: (brand) => set((s) => ({ past: pushPast(s.past, snap(s)), future: [], mainSystem: brand, hasUnsavedChanges: true })),
  setCurrentFilePath: (path) => set({ currentFilePath: path }),
  setRecentFiles: (paths) => set({ recentFiles: paths }),

  loadProject: (data) => set({
    projectName: data.project,
    mainSystem: data.mainSystem,
    dataTypes: (() => {
      const saved = data.dataTypes ?? [];
      const customs = saved.filter((t) => !DEFAULT_DATA_TYPES.includes(t));
      return [...DEFAULT_DATA_TYPES, ...customs];
    })(),
    devices: data.devices,
    selectedDeviceId: data.devices[0]?.id ?? null,
    hasUnsavedChanges: false,
    past: [],
    future: [],
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
      past: pushPast(s.past, snap(s)), future: [],
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
    return { past: pushPast(s.past, snap(s)), future: [], devices, selectedDeviceId, hasUnsavedChanges: true };
  }),

  selectDevice: (id) => set({ selectedDeviceId: id }),

  renameDevice: (id, name) => set((s) => ({
    past: pushPast(s.past, snap(s)), future: [],
    devices: s.devices.map((d) => d.id === id ? { ...d, name } : d),
    hasUnsavedChanges: true,
  })),

  reorderDevices: (fromId, toId) => set((s) => {
    if (fromId === toId) return {};
    const devices = [...s.devices];
    const fromIdx = devices.findIndex((d) => d.id === fromId);
    const toIdx = devices.findIndex((d) => d.id === toId);
    if (fromIdx === -1 || toIdx === -1) return {};
    const [moved] = devices.splice(fromIdx, 1);
    devices.splice(toIdx, 0, moved);
    return { past: pushPast(s.past, snap(s)), future: [], devices, hasUnsavedChanges: true };
  }),

  updateDeviceSettings: (id, ip, port) => set((s) => ({
    past: pushPast(s.past, snap(s)), future: [],
    devices: s.devices.map((d) => d.id === id ? { ...d, ip, port } : d),
    hasUnsavedChanges: true,
  })),

  checkDuplicateIP: (ip, port, excludeId) => {
    if (!ip) return { type: 'none' };
    const others = get().devices.filter((d) => d.id !== excludeId && d.ip === ip);
    if (others.length === 0) return { type: 'none' };
    const samePort = others.find((d) => d.port === port);
    if (samePort) return { type: 'error', deviceName: samePort.name };
    return { type: 'warn', deviceName: others[0].name };
  },

  addIORow: (deviceId, type) => {
    const row = newRow();
    set((s) => ({
      past: pushPast(s.past, snap(s)), future: [],
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
    past: pushPast(s.past, snap(s)), future: [],
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      return { ...d, [key]: d[key].filter((r) => r.id !== rowId) };
    }),
    hasUnsavedChanges: true,
  })),

  updateIORow: (deviceId, type, rowId, field, value) => set((s) => ({
    past: pushPast(s.past, snap(s)), future: [],
    devices: s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      return { ...d, [key]: d[key].map((r) => r.id === rowId ? { ...r, [field]: value } : r) };
    }),
    hasUnsavedChanges: true,
  })),

  insertRowsAfter: (deviceId, type, afterIndex, rows) => set((s) => ({
    past: pushPast(s.past, snap(s)), future: [],
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
    past: pushPast(s.past, snap(s)), future: [],
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

    set((cur) => ({ past: pushPast(cur.past, snap(cur)), future: [], devices: newDevices, hasUnsavedChanges: true }));
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
    set((cur) => ({ past: pushPast(cur.past, snap(cur)), future: [], devices: newDevices, hasUnsavedChanges: true }));
    return count;
  },

  undo: () => set((s) => {
    if (s.past.length === 0) return {};
    const prev = s.past[s.past.length - 1];
    const current = snap(s);
    const nextFuture = [...s.future, current];
    if (nextFuture.length > 50) nextFuture.shift();
    return {
      past: s.past.slice(0, -1),
      future: nextFuture,
      projectName: prev.projectName,
      mainSystem: prev.mainSystem,
      dataTypes: prev.dataTypes,
      devices: prev.devices,
      selectedDeviceId: prev.selectedDeviceId,
      hasUnsavedChanges: true,
    };
  }),

  redo: () => set((s) => {
    if (s.future.length === 0) return {};
    const next = s.future[s.future.length - 1];
    const current = snap(s);
    const nextPast = pushPast(s.past, current);
    return {
      past: nextPast,
      future: s.future.slice(0, -1),
      projectName: next.projectName,
      mainSystem: next.mainSystem,
      dataTypes: next.dataTypes,
      devices: next.devices,
      selectedDeviceId: next.selectedDeviceId,
      hasUnsavedChanges: true,
    };
  }),

  cloneDevice: (id) => set((s) => {
    const idx = s.devices.findIndex((d) => d.id === id);
    if (idx === -1) return {};
    const src = s.devices[idx];
    const cloned = {
      id: crypto.randomUUID(),
      name: `${src.name} (複本)`,
      ip: src.ip,
      port: src.port,
      sendIO: src.sendIO.map((r) => ({ ...r, id: crypto.randomUUID() })),
      receiveIO: src.receiveIO.map((r) => ({ ...r, id: crypto.randomUUID() })),
    };
    const devices = [...s.devices.slice(0, idx + 1), cloned, ...s.devices.slice(idx + 1)];
    return { past: pushPast(s.past, snap(s)), future: [], devices, selectedDeviceId: cloned.id, hasUnsavedChanges: true };
  }),

  reorderIORows: (deviceId, type, fromId, toId) => set((s) => {
    if (fromId === toId) return {};
    const newDevices = s.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const key = type === 'send' ? 'sendIO' : 'receiveIO';
      const rows = [...d[key]];
      const fromIdx = rows.findIndex((r) => r.id === fromId);
      const toIdx = rows.findIndex((r) => r.id === toId);
      if (fromIdx === -1 || toIdx === -1) return d;
      const [moved] = rows.splice(fromIdx, 1);
      rows.splice(toIdx, 0, moved);
      return { ...d, [key]: rows };
    });
    return { past: pushPast(s.past, snap(s)), future: [], devices: newDevices, hasUnsavedChanges: true };
  }),

  lastSavedAt: null,
  markSaved: () => set({ hasUnsavedChanges: false, lastSavedAt: new Date() }),

  savedTip: false,
  showSavedTip: () => {
    set({ savedTip: true });
    setTimeout(() => set({ savedTip: false }), 1800);
  },
  exportTip: false,
  showExportTip: () => {
    set({ exportTip: true });
    setTimeout(() => set({ exportTip: false }), 1800);
  },

  viewMode: 'device',
  setViewMode: (mode) => set({ viewMode: mode }),

  setConnectionStatus: (deviceId, status) =>
    set((s) => ({ connectionStatus: { ...s.connectionStatus, [deviceId]: status } })),

  startMonitoring: (id) =>
    set((s) => ({ monitoringDevices: new Set([...s.monitoringDevices, id]) })),

  stopMonitoring: (id) =>
    set((s) => {
      const next = new Set(s.monitoringDevices);
      next.delete(id);
      const { [id]: _removed, ...rest } = s.plcValues;
      return { monitoringDevices: next, plcValues: rest };
    }),

  setPollingInterval: (ms) => set({ pollingInterval: ms }),

  setPlcValues: (deviceId, values) =>
    set((s) => ({ plcValues: { ...s.plcValues, [deviceId]: values } })),

  updateDevicePlcBrand: (id, brand) =>
    set((s) => ({
      past: pushPast(s.past, snap(s)),
      future: [],
      devices: s.devices.map((d) => d.id === id ? { ...d, plcBrand: brand ?? undefined } : d),
      hasUnsavedChanges: true,
    })),
}));

export { DEFAULT_DATA_TYPES };
