import React from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  isTauri,
  saveToFilePath,
  saveAsFile,
  openFileWithPicker,
  loadFromJSON,
  exportToExcel,
  importFromExcel,
  addToRecentFiles,
  saveRecentFiles,
} from '../utils/fileUtils';
import type { ProjectData, MainSystemBrand } from '../types';
import type { ParsedResult } from '../utils/excelImport';

const DEFAULT_DATA_TYPES = ['BOOL', 'UINT', 'INT', 'WORD', 'DWORD', 'FLOAT', 'STRING'];

function parseJSON(text: string): ProjectData {
  const parsed = JSON.parse(text);
  if (!parsed.devices || !Array.isArray(parsed.devices)) throw new Error('無效的專案檔案格式');
  if (!parsed.dataTypes) parsed.dataTypes = [...DEFAULT_DATA_TYPES];
  return parsed as ProjectData;
}

export function useFileActions() {
  const {
    getProjectData, loadProject, markSaved, showSavedTip,
    currentFilePath, setCurrentFilePath,
    recentFiles, setRecentFiles,
    hasUnsavedChanges, showExportTip,
  } = useProjectStore();

  const persistRecent = async (path: string) => {
    const updated = addToRecentFiles(path, recentFiles);
    setRecentFiles(updated);
    await saveRecentFiles(updated);
  };

  const handleNew = () => {
    if (hasUnsavedChanges && !window.confirm('有未存儲的變更，確定要新增嗎？')) return;
    loadProject({ project: '未命名專案', mainSystem: 'KEYENCE', dataTypes: [], devices: [] });
    setCurrentFilePath(null);
  };

  const handleOpen = async (fileInput?: React.RefObject<HTMLInputElement | null>) => {
    try {
      const result = await openFileWithPicker();
      if (!result) {
        if (!isTauri()) fileInput?.current?.click();
        return;
      }
      loadProject(result.data);
      if (result.path) {
        setCurrentFilePath(result.path);
        await persistRecent(result.path);
      } else {
        setCurrentFilePath(null);
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  /** Called when Rust emits open-file (file association / recent menu) */
  const handleOpenPath = async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const text = await invoke<string>('read_file', { path });
      loadProject(parseJSON(text));
      setCurrentFilePath(path);
      await persistRecent(path);
    } catch (e) {
      alert(`無法開啟檔案：${(e as Error).message}`);
    }
  };

  const handleSave = async () => {
    const data = getProjectData();
    if (isTauri() && currentFilePath) {
      try {
        await saveToFilePath(currentFilePath, data);
        markSaved();
        showSavedTip();
      } catch (e) {
        alert('存檔失敗：' + (e as Error).message);
      }
    } else {
      await handleSaveAs();
    }
  };

  const handleSaveAs = async () => {
    const data = getProjectData();
    try {
      const result = await saveAsFile(data);
      if (result === null) {
        if (!('showSaveFilePicker' in window) && !isTauri()) {
          markSaved();
          showSavedTip();
        }
        return;
      }
      if (typeof result === 'string') {
        setCurrentFilePath(result);
        await persistRecent(result);
      }
      markSaved();
      showSavedTip();
    } catch (e) {
      alert('另存新檔失敗：' + (e as Error).message);
    }
  };

  const handleExport = async () => {
    try {
      const exported = await exportToExcel(getProjectData(), currentFilePath);
      if (exported) showExportTip();
    } catch (e) {
      alert('匯出 Excel 失敗：' + (e as Error).message);
    }
  };

  const handleImportExcel = async (): Promise<{ result: ParsedResult; fileName: string } | null> => {
    try {
      return await importFromExcel();
    } catch (e) {
      alert('開啟 Excel 失敗：' + (e as Error).message);
      return null;
    }
  };

  const handleConfirmImport = (result: ParsedResult, mainSystem: MainSystemBrand) => {
    const projectData: ProjectData = {
      project: result.projectName,
      mainSystem,
      dataTypes: result.dataTypes,
      devices: result.devices.map((d) => ({
        id: crypto.randomUUID(),
        name: d.name,
        ip: d.ip,
        port: d.port,
        sendIO: d.sendIO,
        receiveIO: d.receiveIO,
      })),
    };
    loadProject(projectData);
    setCurrentFilePath(null);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await loadFromJSON(file);
      loadProject(data);
      setCurrentFilePath(null);
    } catch (err) {
      alert((err as Error).message);
    }
    e.target.value = '';
  };

  return {
    handleNew,
    handleOpen,
    handleOpenPath,
    handleSave,
    handleSaveAs,
    handleExport,
    handleImportExcel,
    handleConfirmImport,
    handleFileInputChange,
  };
}
