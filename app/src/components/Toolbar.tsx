import { useRef } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { useFileActions } from '../hooks/useFileActions';
import type { MainSystemBrand } from '../types';

const BRANDS: { value: MainSystemBrand; label: string }[] = [
  { value: 'KEYENCE', label: 'KEYENCE KV' },
  { value: 'Mitsubishi', label: '三菱 (Mitsubishi)' },
  { value: 'Siemens', label: '西門子 (Siemens)' },
  { value: 'Omron', label: '歐姆龍 (Omron)' },
  { value: 'Modbus', label: 'Modbus Generic' },
  { value: 'Custom', label: '自訂 (Custom)' },
];

interface ToolbarProps {
  onImportExcel?: () => void;
  colorScheme: 'light' | 'dark';
  onToggleColorScheme: () => void;
}

export function Toolbar({ onImportExcel, colorScheme, onToggleColorScheme }: ToolbarProps) {
  const { projectName, mainSystem, setProjectName, setMainSystem, currentFilePath, hasUnsavedChanges, savedTip, exportTip, viewMode, setViewMode } =
    useProjectStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { handleNew, handleOpen, handleSave, handleSaveAs, handleExport, handleFileInputChange } = useFileActions();

  const currentFileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() ?? currentFilePath : null;

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
        <span className="current-filename" title={currentFilePath ?? currentFileName}>
          {hasUnsavedChanges ? '● ' : ''}{currentFileName}
        </span>
      )}

      <div className="toolbar-actions">
        <button onClick={() => handleNew()}>🆕 新增</button>
        <button onClick={() => handleOpen(fileInputRef)}>📂 開啟</button>
        <button
          className={`view-toggle-btn${viewMode === 'main-system' ? ' active' : ''}`}
          onClick={() => setViewMode(viewMode === 'main-system' ? 'device' : 'main-system')}
          title="切換主系統視角"
        >
          🔀 主系統視角
        </button>
        <button
          className={`save-btn${hasUnsavedChanges ? ' has-changes' : ''}`}
          onClick={handleSave}
          title={currentFilePath ? `存檔至 ${currentFileName}` : '另存新檔'}
        >
          {savedTip ? '✓ 已存檔' : '💾 存檔'}
        </button>
        <button onClick={handleSaveAs} title="另存新檔">📄 另存新檔</button>
        <div className="toolbar-sep" />
        <button onClick={onImportExcel}>📂 開啟 Excel</button>
        <button onClick={handleExport}>{exportTip ? '✓ 已匯出' : '📊 匯出 Excel'}</button>
        <button onClick={() => window.print()} title="列印 / 匯出 PDF">🖨️ 列印</button>
        <div className="toolbar-sep" />
        <button onClick={onToggleColorScheme} title="切換深色/淺色模式">
          {colorScheme === 'dark' ? '☀️ 淺色' : '🌙 深色'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
