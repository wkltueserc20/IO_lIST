import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

interface MenuItem {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu-item${item.disabled ? ' context-menu-item--disabled' : ''}`}
          disabled={item.disabled}
          onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
