import { useRef, useState } from 'react';
import { EditableCell } from './EditableCell';
import { fillAddresses, parseAddress, shouldAutoBool } from '../../utils/addressUtils';

interface Props {
  value: string;
  rowIndex: number;
  onChange: (value: string) => void;
  onFill: (fromIndex: number, addresses: string[], autoBool: boolean) => void;
  placeholder?: string;
  isConflict?: boolean;
  isEditing: boolean;
  onEndEdit: () => void;
  onTabOut?: (dir: 'forward' | 'backward') => void;
  onEnterOut?: () => void;
  initialChar?: string;
}

export function AddressCell({ value, rowIndex, onChange, onFill, placeholder = '如：DM0', isConflict = false, isEditing, onEndEdit, onTabOut, onEnterOut, initialChar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    setIsInvalid(newValue.trim() !== '' && parseAddress(newValue.trim()) === null);
  };
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
    <div
      ref={containerRef}
      className={`address-cell-wrapper${isConflict ? ' cell-conflict' : ''}`}
      data-invalid={isInvalid ? 'true' : undefined}
      title={isInvalid ? '無效位址格式。範例：DM0、DM5.3、M10、MR5' : undefined}
    >
      <EditableCell
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        isEditing={isEditing}
        onEndEdit={onEndEdit}
        onTabOut={onTabOut}
        onEnterOut={onEnterOut}
        initialChar={initialChar}
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
