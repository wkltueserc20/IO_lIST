import { useState, useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  onEndEdit: () => void;
  placeholder?: string;
  onEnterLast?: () => void;
  isLast?: boolean;
}

export function EditableCell({ value, onChange, isEditing, onEndEdit, placeholder, onEnterLast, isLast }: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft to external value when not editing
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  // Explicit focus after React commits the render — more reliable than autoFocus
  // in React 18 concurrent mode where autoFocus can fire before the DOM is ready.
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = () => { onChange(draft); onEndEdit(); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { commit(); if (isLast) onEnterLast?.(); }
    if (e.key === 'Escape') { setDraft(value); onEndEdit(); }
    if (e.key === 'Tab') { e.preventDefault(); commit(); }
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
