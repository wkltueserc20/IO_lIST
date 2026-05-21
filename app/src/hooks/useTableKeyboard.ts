import { useRef, useEffect, useCallback } from 'react';
import type { IORow } from '../types';

const EDITABLE_COLS: (keyof IORow)[] = [
  'deviceAddress', 'signalName', 'dataType', 'mainSystemAddress', 'remark',
];
const NUM_COLS = EDITABLE_COLS.length;

type Cell = { row: number; col: number };
type SelRect = { r1: number; r2: number; c1: number; c2: number } | null;

interface Params {
  tableKey: string;
  isActive: () => boolean;
  rows: IORow[];
  editingCell: Cell | null;
  setEditingCell: (cell: Cell | null) => void;
  setSelAnchor: (c: Cell | null) => void;
  setSelEnd: (c: Cell | null) => void;
  selectedCellRef: React.MutableRefObject<Cell | null>;
  selRectRef: React.MutableRefObject<SelRect>;
  pasteRowRef: React.MutableRefObject<number>;
  deviceId: string;
  type: 'send' | 'receive';
  showCompleteOnly: boolean;
  addIORow: (deviceId: string, type: 'send' | 'receive') => string;
  updateIORow: (deviceId: string, type: 'send' | 'receive', rowId: string, field: keyof IORow, value: string) => void;
}

export function useTableKeyboard({
  tableKey, isActive, rows, editingCell, setEditingCell,
  setSelAnchor, setSelEnd, selectedCellRef, selRectRef, pasteRowRef,
  deviceId, type, showCompleteOnly, addIORow, updateIORow,
}: Params) {
  const pendingInitialCharRef = useRef<string | undefined>(undefined);

  // Keep mutable refs so closures always see latest values
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const editingCellRef = useRef(editingCell);
  editingCellRef.current = editingCell;
  const showCompleteOnlyRef = useRef(showCompleteOnly);
  showCompleteOnlyRef.current = showCompleteOnly;

  // Navigate to a cell: update selection state and optionally enter edit mode
  const navigateTo = useCallback((cell: Cell, enterEdit: boolean) => {
    selectedCellRef.current = cell;
    setSelAnchor(cell);
    setSelEnd(cell);
    pasteRowRef.current = cell.row;
    if (enterEdit) {
      setEditingCell(cell);
    } else {
      setEditingCell(null);
    }
  }, [selectedCellRef, setSelAnchor, setSelEnd, setEditingCell, pasteRowRef]);

  // Compute the cell that Tab/Shift+Tab leads to
  // Returns null if already at boundary (first cell, shift-tab) — no-op
  const getNextTabCell = useCallback((row: number, col: number, forward: boolean): { cell: Cell; addRow: boolean } | null => {
    const rowCount = rowsRef.current.length;
    if (forward) {
      if (col < NUM_COLS - 1) return { cell: { row, col: col + 1 }, addRow: false };
      if (row < rowCount - 1) return { cell: { row: row + 1, col: 0 }, addRow: false };
      if (showCompleteOnlyRef.current) return null;
      return { cell: { row: row + 1, col: 0 }, addRow: true };
    } else {
      if (col > 0) return { cell: { row, col: col - 1 }, addRow: false };
      if (row > 0) return { cell: { row: row - 1, col: NUM_COLS - 1 }, addRow: false };
      return null;
    }
  }, []);

  const doTab = useCallback((row: number, col: number, forward: boolean) => {
    const result = getNextTabCell(row, col, forward);
    if (!result) return;
    if (result.addRow) {
      addIORow(deviceId, type);
      setTimeout(() => navigateTo(result.cell, true), 0);
    } else {
      navigateTo(result.cell, true);
    }
  }, [getNextTabCell, addIORow, deviceId, type, navigateTo]);

  // Called by EditableCell / AddressCell's EditableCell when Tab is pressed during editing
  const handleTabOut = useCallback((row: number, col: number, dir: 'forward' | 'backward') => {
    doTab(row, col, dir === 'forward');
  }, [doTab]);

  // Called by EditableCell / AddressCell's EditableCell when Enter is pressed during editing
  const handleEnterFromCell = useCallback((row: number, col: number) => {
    const rowCount = rowsRef.current.length;
    if (row < rowCount - 1) {
      navigateTo({ row: row + 1, col }, true);
    } else if (!showCompleteOnlyRef.current) {
      addIORow(deviceId, type);
      setTimeout(() => navigateTo({ row: row + 1, col }, true), 0);
    }
  }, [addIORow, deviceId, type, navigateTo]);

  // Global keyboard handler (selection-mode keys + Ctrl+D + type-to-replace)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isActive()) return;

      const editing = editingCellRef.current;
      const sel = selectedCellRef.current;
      const rowCount = rowsRef.current.length;

      // ── DataTypeCell Tab: editing col=2 (dropdown has no focused input) ──
      if (editing !== null && editing.col === 2 && e.key === 'Tab') {
        e.preventDefault();
        setEditingCell(null);
        // After React re-renders and closes the dropdown, navigate
        const row = editing.row;
        const col = editing.col;
        setTimeout(() => doTab(row, col, !e.shiftKey), 0);
        return;
      }

      // ── When a text input/select is focused, don't intercept ──
      if (editing !== null) return;

      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // ── Arrow key navigation ──
      if (sel && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        let { row, col } = sel;
        if (e.key === 'ArrowUp')    row = Math.max(0, row - 1);
        if (e.key === 'ArrowDown')  row = Math.min(rowCount - 1, row + 1);
        if (e.key === 'ArrowLeft')  col = Math.max(0, col - 1);
        if (e.key === 'ArrowRight') col = Math.min(NUM_COLS - 1, col + 1);
        navigateTo({ row, col }, false);
        return;
      }

      // ── Tab navigation in selection mode ──
      if (e.key === 'Tab' && sel) {
        e.preventDefault();
        doTab(sel.row, sel.col, !e.shiftKey);
        return;
      }

      // ── Ctrl+D fill down ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        const rect = selRectRef.current;
        if (!rect || rect.r2 <= rect.r1) return;
        for (let c = rect.c1; c <= rect.c2; c++) {
          const field = EDITABLE_COLS[c];
          const srcRow = rowsRef.current[rect.r1];
          if (!srcRow) continue;
          const srcVal = (srcRow[field] as string) || '';
          for (let r = rect.r1 + 1; r <= rect.r2 && r < rowsRef.current.length; r++) {
            updateIORow(deviceId, type, rowsRef.current[r].id, field, srcVal);
          }
        }
        return;
      }

      // ── Type-to-replace: visible char, no ctrl/meta, not IME composing, not dataType col ──
      if (
        e.key.length === 1 &&
        !e.ctrlKey && !e.metaKey &&
        !e.isComposing &&
        sel && sel.col !== 2
      ) {
        pendingInitialCharRef.current = e.key;
        setEditingCell(sel);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  return { pendingInitialCharRef, handleTabOut, handleEnterFromCell };
}
