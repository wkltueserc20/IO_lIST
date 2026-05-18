import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainContent } from './components/MainContent';
import { useProjectStore } from './store/useProjectStore';
import './App.css';

const SHORTCUTS = [
  { desc: '選取格子',   keys: ['Click'] },
  { desc: '進入編輯',   keys: ['2× Click'] },
  { desc: '多格選取',   keys: ['Drag'] },
  { desc: '複製',       keys: ['Ctrl', 'C'] },
  { desc: '貼上',       keys: ['Ctrl', 'V'] },
  { desc: '剪下',       keys: ['Ctrl', 'X'] },
  { desc: '清除格子',   keys: ['Del'] },
  { desc: '復原',       keys: ['Ctrl', 'Z'] },
  { desc: '取消選取',   keys: ['Esc'] },
];

function App() {
  const hasUnsavedChanges = useProjectStore((s) => s.hasUnsavedChanges);
  const undo = useProjectStore((s) => s.undo);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        undo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  return (
    <>
      <div className="app-layout">
        <Toolbar />
        <div className="app-body">
          <Sidebar />
          <MainContent />
        </div>
      </div>

      <button
        className="shortcut-fab"
        onClick={() => setShowShortcuts((v) => !v)}
        title="鍵盤快捷鍵"
      >?</button>

      {showShortcuts && (
        <>
          <div className="shortcut-overlay" onClick={() => setShowShortcuts(false)} />
          <div className="shortcut-panel">
            <div className="shortcut-panel-header">鍵盤快捷鍵</div>
            {SHORTCUTS.map(({ desc, keys }) => (
              <div key={desc} className="shortcut-row">
                <span className="shortcut-desc">{desc}</span>
                <span className="shortcut-keys">
                  {keys.map((k) => <kbd key={k}>{k}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default App;
