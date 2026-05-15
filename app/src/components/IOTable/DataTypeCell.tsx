import { useRef, useEffect } from 'react';
import { useProjectStore } from '../../store/useProjectStore';

interface Props {
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  onEndEdit: () => void;
}

export function DataTypeCell({ value, onChange, isEditing, onEndEdit }: Props) {
  const dataTypes = useProjectStore((s) => s.dataTypes);
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  // Close dropdown on outside click
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
