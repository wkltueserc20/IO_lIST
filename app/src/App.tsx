import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainContent } from './components/MainContent';
import { ImportExcelModal } from './components/ImportExcelModal';
import { GlobalSearchPanel } from './components/GlobalSearchPanel';
import { StatusBar } from './components/StatusBar';
import { useProjectStore } from './store/useProjectStore';
import { useFileActions } from './hooks/useFileActions';
import { isTauri } from './utils/fileUtils';
import type { ParsedResult } from './utils/excelImport';
import './App.css';

const SHORTCUT_SECTIONS = [
  {
    title: '全域操作',
    items: [
      { desc: '新增專案',   keys: ['Ctrl', 'N'] },
      { desc: '開啟檔案',   keys: ['Ctrl', 'O'] },
      { desc: '存檔',       keys: ['Ctrl', 'S'] },
      { desc: '另存新檔',   keys: ['Ctrl', 'Shift', 'S'] },
      { desc: '復原',       keys: ['Ctrl', 'Z'] },
      { desc: '重做',       keys: ['Ctrl', 'Y'] },
      { desc: '全域搜尋',   keys: ['Ctrl', 'F'] },
    ],
  },
  {
    title: '表格操作',
    items: [
      { desc: '選取格子',   keys: ['Click'] },
      { desc: '進入編輯',   keys: ['2× Click'] },
      { desc: '多格選取',   keys: ['Drag'] },
      { desc: '複製',       keys: ['Ctrl', 'C'] },
      { desc: '貼上',       keys: ['Ctrl', 'V'] },
      { desc: '剪下',       keys: ['Ctrl', 'X'] },
      { desc: '清除格子',   keys: ['Del'] },
      { desc: '取消選取',   keys: ['Esc'] },
    ],
  },
];

interface HighlightTarget {
  deviceId: string;
  rowId: string;
  ioType: 'send' | 'receive';
}

function App() {
  const { hasUnsavedChanges, undo, redo, projectName, setRecentFiles, currentFilePath, getProjectData, markSaved, showSavedTip, devices, selectDevice, setViewMode } =
    useProjectStore();
  const { handleNew, handleOpen, handleSave, handleSaveAs, handleExport, handleOpenPath, handleImportExcel, handleConfirmImport } = useFileActions();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [importModal, setImportModal] = useState<{ result: ParsedResult; fileName: string } | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchKeyword, setGlobalSearchKeyword] = useState('');
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');

  // Apply persisted theme before first paint
  useLayoutEffect(() => {
    const saved = localStorage.getItem('io-color-scheme') as 'light' | 'dark' | null;
    if (saved) {
      document.body.dataset.theme = saved;
      setColorScheme(saved);
    }
  }, []);

  const toggleColorScheme = useCallback(() => {
    setColorScheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = next === 'light' ? '' : next;
      localStorage.setItem('io-color-scheme', next);
      return next;
    });
  }, []);

  const navigateTo = useCallback((deviceId: string, rowId: string, ioType: 'send' | 'receive') => {
    selectDevice(deviceId);
    setViewMode('device');
    setHighlightTarget({ deviceId, rowId, ioType });
  }, [selectDevice, setViewMode]);

  // ── Browser beforeunload (non-Tauri) ──────────────────────
  useEffect(() => {
    if (isTauri()) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ── Global Ctrl+Z/Y and Ctrl+F ─────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+F: global search (intercept everywhere)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setGlobalSearchOpen(true);
        return;
      }
      if (isTauri()) return; // Tauri handles undo/redo via menu-action event
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        undo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        redo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ── Tauri: all event listeners ─────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenMenu: (() => void) | undefined;
    let unlistenOpenFile: (() => void) | undefined;
    let unlistenRecentFiles: (() => void) | undefined;
    let unlistenAutoSave: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const appWindow = getCurrentWindow();

      // Menu action events from Rust
      unlistenMenu = await listen<string>('menu-action', async ({ payload }) => {
        switch (payload) {
          case 'new':        handleNew();     break;
          case 'open':       await handleOpen(); break;
          case 'save':       await handleSave(); break;
          case 'save-as':    await handleSaveAs(); break;
          case 'export-excel': handleExport(); break;
          case 'undo':       undo();          break;
          case 'redo':       redo();          break;
          case 'print':      window.print();  break;
        }
      });

      // File association / recent file menu click
      unlistenOpenFile = await listen<string>('open-file', async ({ payload }) => {
        if (payload) await handleOpenPath(payload);
      });

      // Recent files list sent from Rust on startup
      unlistenRecentFiles = await listen<string>('recent-files-loaded', ({ payload }) => {
        try {
          const paths: string[] = JSON.parse(payload);
          setRecentFiles(paths);
        } catch { /* ignore malformed */ }
      });

      // Auto-save tick from Rust timer
      unlistenAutoSave = await listen('auto-save-tick', async () => {
        const path = (window as unknown as Record<string, unknown>).__ioCurrentPath__ as string | null;
        if (!path) return;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const data = getProjectData();
          await invoke('write_file', { path, content: JSON.stringify(data, null, 2) });
          markSaved();
          showSavedTip();
        } catch { /* silent auto-save failure */ }
      });

      // Close-requested: Rust always intercepts X button and emits this event
      const { invoke } = await import('@tauri-apps/api/core');
      unlistenClose = await listen('close-requested', async () => {
        const hasUnsaved = useProjectStore.getState().hasUnsavedChanges;
        if (!hasUnsaved) {
          await invoke('close_window');
          return;
        }
        const ok = await confirm('有未存儲的變更，確定要關閉嗎？', { title: 'IO 設備通訊對照表', kind: 'warning' });
        if (ok) await invoke('close_window');
      });
    })();

    return () => {
      unlistenMenu?.();
      unlistenOpenFile?.();
      unlistenRecentFiles?.();
      unlistenAutoSave?.();
      unlistenClose?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tauri: sync window title ───────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const title = `${hasUnsavedChanges ? '● ' : ''}${projectName} - IO 設備通訊對照表`;
      await getCurrentWindow().setTitle(title);
    })();
  }, [projectName, hasUnsavedChanges]);

  // ── Sync dynamic refs used by one-time Tauri event handlers ──
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ioHasUnsaved__ = hasUnsavedChanges;
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('set_unsaved_state', { hasUnsaved: hasUnsavedChanges });
      });
    }
  }, [hasUnsavedChanges]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ioCurrentPath__ = currentFilePath;
  }, [currentFilePath]);

  return (
    <>
      <div className="app-layout">
        <Toolbar
          onImportExcel={async () => {
            const r = await handleImportExcel();
            if (r) setImportModal(r);
          }}
          colorScheme={colorScheme}
          onToggleColorScheme={toggleColorScheme}
        />
        <div className="app-body">
          <Sidebar />
          <MainContent
            highlightTarget={highlightTarget}
            clearHighlight={() => setHighlightTarget(null)}
            onNavigate={navigateTo}
          />
        </div>
        <StatusBar />
      </div>

      <button
        className="shortcut-fab"
        onClick={() => setShowShortcuts((v) => !v)}
        title="鍵盤快捷鍵"
      >?</button>

      {globalSearchOpen && (
        <GlobalSearchPanel
          keyword={globalSearchKeyword}
          onKeywordChange={setGlobalSearchKeyword}
          onClose={() => { setGlobalSearchOpen(false); setGlobalSearchKeyword(''); }}
          onNavigate={navigateTo}
          devices={devices}
        />
      )}

      {importModal && (
        <ImportExcelModal
          result={importModal.result}
          onConfirm={(mainSystem) => {
            handleConfirmImport(importModal.result, mainSystem);
            setImportModal(null);
          }}
          onCancel={() => setImportModal(null)}
        />
      )}

      {showShortcuts && (
        <>
          <div className="shortcut-overlay" onClick={() => setShowShortcuts(false)} />
          <div className="shortcut-panel">
            <div className="shortcut-panel-header">鍵盤快捷鍵</div>
            {SHORTCUT_SECTIONS.map((section, si) => (
              <div key={section.title}>
                {si > 0 && <div className="shortcut-section-sep" />}
                <div className="shortcut-section-title">{section.title}</div>
                {section.items.map(({ desc, keys }) => (
                  <div key={desc} className="shortcut-row">
                    <span className="shortcut-desc">{desc}</span>
                    <span className="shortcut-keys">
                      {keys.map((k) => <kbd key={k}>{k}</kbd>)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default App;
