import { useState, useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  onEndEdit: () => void;
  placeholder?: string;
  onTabOut?: (dir: 'forward' | 'backward') => void;
  onEnterOut?: () => void;
  initialChar?: string;
}

export function EditableCell({ value, onChange, isEditing, onEndEdit, placeholder, onTabOut, onEnterOut, initialChar }: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      if (initialChar !== undefined) {
        setDraft(initialChar);
        inputRef.current.focus();
      } else {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => { onChange(draft); onEndEdit(); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      onEnterOut?.();
    }
    if (e.key === 'Escape') { setDraft(value); onEndEdit(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      commit();
      onTabOut?.(e.shiftKey ? 'backward' : 'forward');
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="cell-display" title={value || placeholder}>
      {value || <span className="cell-placeholder">{placeholder}</span>}
    </div>
  );
}
