import { useRef, useState } from 'react';
import { EditableCell } from './EditableCell';
import { fillAddresses, shouldAutoBool } from '../../utils/addressUtils';

interface Props {
  value: string;
  rowIndex: number;
  onChange: (value: string) => void;
  onFill: (fromIndex: number, addresses: string[], autoBool: boolean) => void;
  onEnterLast?: () => void;
  isLast?: boolean;
  placeholder?: string;
  isConflict?: boolean;
  isEditing: boolean;
  onEndEdit: () => void;
}

export function AddressCell({ value, rowIndex, onChange, onFill, onEnterLast, isLast, placeholder = '如：DM0', isConflict = false, isEditing, onEndEdit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  const startY = useRef(0);
  const rowHeight = 36;

  const handleHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!value) return;
    setIsDragging(true);
    startY.current = e.clientY;
    setPreviewCount(0);

    const handleMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientY - startY.current;
      const count = Math.max(0, Math.round(diff / rowHeight));
      setPreviewCount(count);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      const diff = ev.clientY - startY.current;
      const count = Math.max(0, Math.round(diff / rowHeight));
      setIsDragging(false);
      setPreviewCount(0);
      if (count > 0 && value) {
        const addresses = fillAddresses(value, count);
        const autoBool = shouldAutoBool(value);
        onFill(rowIndex, addresses, autoBool);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div ref={containerRef} className={`address-cell-wrapper${isConflict ? ' cell-conflict' : ''}`}>
      <EditableCell
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onEnterLast={onEnterLast}
        isLast={isLast}
        isEditing={isEditing}
        onEndEdit={onEndEdit}
      />
      {value && (
        <div
          className="fill-handle"
          onMouseDown={handleHandleMouseDown}
          title="向下拖曳填充"
        />
      )}
      {isDragging && previewCount > 0 && (
        <div className="fill-preview-indicator">
          +{previewCount} 行
        </div>
      )}
    </div>
  );
}
