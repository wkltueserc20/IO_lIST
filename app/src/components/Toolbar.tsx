import { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  saveToFileHandle,
  saveAsFile,
  openFileWithPicker,
  loadFromJSON,
  exportToExcel,
} from '../utils/fileUtils';
import type { MainSystemBrand } from '../types';

const BRANDS: { value: MainSystemBrand; label: string }[] = [
  { value: 'KEYENCE', label: 'KEYENCE KV' },
  { value: 'Mitsubishi', label: '三菱 (Mitsubishi)' },
  { value: 'Siemens', label: '西門子 (Siemens)' },
  { value: 'Omron', label: '歐姆龍 (Omron)' },
  { value: 'Modbus', label: 'Modbus Generic' },
  { value: 'Custom', label: '自訂 (Custom)' },
];

export function Toolbar() {
  const {
    projectName, mainSystem,
    setProjectName, setMainSystem,
    getProjectData, loadProject, markSaved,
    fileHandle, setFileHandle,
    hasUnsavedChanges,
  } = useProjectStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedTip, setSavedTip] = useState(false);

  const showSavedTip = () => {
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 1800);
  };

  // 存檔：若有 handle 直接覆寫；否則改走另存新檔
  const handleSave = async () => {
    const data = getProjectData();
    if (fileHandle) {
      try {
        await saveToFileHandle(data, fileHandle);
        markSaved();
        showSavedTip();
      } catch (e) {
        alert('存檔失敗：' + (e as Error).message);
      }
    } else {
      await handleSaveAs();
    }
  };

  // 另存新檔：永遠顯示檔案對話框
  const handleSaveAs = async () => {
    const data = getProjectData();
    try {
      const handle = await saveAsFile(data);
      if (handle) {
        setFileHandle(handle);
        markSaved();
        showSavedTip();
      } else if (!('showSaveFilePicker' in window)) {
        // Fallback 下載也算完成
        markSaved();
        showSavedTip();
      }
    } catch (e) {
      alert('另存新檔失敗：' + (e as Error).message);
    }
  };

  const handleExport = () => exportToExcel(getProjectData());

  // 開啟：優先用 File System Access API，不支援則 fallback 到 input
  const handleOpen = async () => {
    try {
      const result = await openFileWithPicker();
      if (result) {
        loadProject(result.data);
        setFileHandle(result.handle);
        return;
      }
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await loadFromJSON(file);
      loadProject(data);
      setFileHandle(null); // input fallback 無法取得 handle
    } catch (err) {
      alert((err as Error).message);
    }
    e.target.value = '';
  };

  const currentFileName = fileHandle ? fileHandle.name : null;

  return (
    <div className="toolbar">
      <input
        className="project-name-input"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="專案名稱"
      />
      <select
        className="brand-select"
        value={mainSystem}
        onChange={(e) => setMainSystem(e.target.value as MainSystemBrand)}
      >
        {BRANDS.map((b) => (
          <option key={b.value} value={b.value}>{b.label}</option>
        ))}
      </select>

      {currentFileName && (
        <span className="current-filename" title={currentFileName}>
          {hasUnsavedChanges ? '● ' : ''}{currentFileName}
        </span>
      )}

      <div className="toolbar-actions">
        <button onClick={handleOpen}>📂 開啟</button>
        <button
          className={`save-btn${hasUnsavedChanges ? ' has-changes' : ''}`}
          onClick={handleSave}
          title={fileHandle ? `存檔至 ${fileHandle.name}` : '另存新檔'}
        >
          {savedTip ? '✓ 已存檔' : '💾 存檔'}
        </button>
        <button onClick={handleSaveAs} title="另存新檔">
          📄 另存新檔
        </button>
        <div className="toolbar-sep" />
        <button onClick={handleExport}>📊 匯出 Excel</button>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  );
}
