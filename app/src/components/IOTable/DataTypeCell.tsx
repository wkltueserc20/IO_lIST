import { useRef, useEffect } from 'react';
import { useProjectStore } from '../../store/useProjectStore';

interface Props {
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  onEndEdit: () => void;
  onTabOut?: (dir: 'forward' | 'backward') => void;
}

export function DataTypeCell({ value, onChange, isEditing, onEndEdit, onTabOut }: Props) {
  const dataTypes = useProjectStore((s) => s.dataTypes);
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;
  const onTabOutRef = useRef(onTabOut);
  onTabOutRef.current = onTabOut;

  useEffect(() => {
    if (!isEditing) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        onEndEditRef.current();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isEditing]);

  // Capture Tab when dropdown is open (no focused input, events bubble to container)
  useEffect(() => {
    if (!isEditing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        onEndEditRef.current();
        onTabOutRef.current?.(e.shiftKey ? 'backward' : 'forward');
      }
      if (e.key === 'Escape') {
        onEndEditRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isEditing]);

  const handleSelect = (type: string) => {
    onChange(type);
    onEndEdit();
  };

  return (
    <div ref={containerRef} className="datatype-cell" style={{ position: 'relative' }}>
      <div className="cell-display">
        {value || <span className="cell-placeholder">選擇類型</span>}
        <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
      </div>
      {isEditing && (
        <div className="datatype-dropdown">
          {dataTypes.map((t) => (
            <div
              key={t}
              className={`datatype-option ${t === value ? 'selected' : ''}`}
              onClick={() => handleSelect(t)}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
