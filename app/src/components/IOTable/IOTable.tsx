import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { EditableCell } from './EditableCell';
import { DataTypeCell } from './DataTypeCell';
import { AddressCell } from './AddressCell';
import { naturalSortAddress } from '../../utils/addressUtils';
import type { IORow } from '../../types';

interface Props {
  deviceId: string;
  deviceName: string;
  type: 'send' | 'receive';
  rows: IORow[];
  mainSystemPlaceholder: string;
  conflictingAddresses: Set<string>;
  collapsed: boolean;
  onCollapseToggle: () => void;
  sorting: SortState;
  onSortingChange: (s: SortState) => void;
  showCompleteOnly: boolean;
  onShowCompleteOnlyChange: (v: boolean) => void;
}

const EDITABLE_COLS: (keyof IORow)[] = [
  'deviceAddress', 'signalName', 'dataType', 'mainSystemAddress', 'remark',
];

export type SortState = { key: keyof IORow; dir: 'asc' | 'desc' } | null;

const COLUMNS = [
  { id: 'deviceName',        header: '設備名稱',       width: 120, selIdx: null as null | number, sortKey: null as null | keyof IORow },
  { id: 'deviceAddress',     header: '設備IO點位位址',  width: 160, selIdx: 0,   sortKey: 'deviceAddress'     as keyof IORow },
  { id: 'signalName',        header: '訊號名稱',       width: 150, selIdx: 1,   sortKey: null },
  { id: 'dataType',          header: '資料類型',       width: 110, selIdx: 2,   sortKey: null },
  { id: 'mainSystemAddress', header: '主系統點位位址', width: 160, selIdx: 3,   sortKey: 'mainSystemAddress' as keyof IORow },
  { id: 'remark',            header: '備註',           width: 150, selIdx: 4,   sortKey: null },
  { id: 'actions',           header: '',              width: 40,  selIdx: null, sortKey: null },
];

// Module-level key so keyboard handler knows which table was last interacted with
let activeTableKey = '';

export function IOTable({
  deviceId, deviceName, type, rows, mainSystemPlaceholder, conflictingAddresses,
  collapsed, onCollapseToggle, sorting, onSortingChange, showCompleteOnly, onShowCompleteOnlyChange,
}: Props) {
  const {
    updateIORow, deleteIORow, addIORow, insertRowsAfter,
    setTableClipboard, tableClipboard, pasteClipboard, clearCellRange,
  } = useProjectStore();

  const tableKey = `${deviceId}-${type}`;

  // ─── React state (causes re-renders) ──────────────────────────────
  const [editingCell, setEditingCell]           = useState<{ row: number; col: number } | null>(null);
  const [isDragging, setIsDragging]             = useState(false);
  const [selAnchor, setSelAnchor]               = useState<{ row: number; col: number } | null>(null);
  const [selEnd, setSelEnd]                     = useState<{ row: number; col: number } | null>(null);
  const [copyDone, setCopyDone]                 = useState(false);
  const [pasteResult, setPasteResult]           = useState<number | null>(null);

  // ─── Refs (synchronous, no re-render needed) ─────────────────────
  // selectedCellRef tracks the currently-selected 1×1 cell.
  // Updated directly in event handlers so it is always current when
  // the next mousedown fires — never depends on React render timing.
  const selectedCellRef        = useRef<{ row: number; col: number } | null>(null);
  // Snapshot taken at mousedown; the click handler compares against
  // this to decide "click on already-selected cell → enter edit mode".
  const selectedAtMouseDownRef = useRef<{ row: number; col: number } | null>(null);

  const dragStartRef     = useRef<{ row: number; col: number } | null>(null);
  const hasDraggedRef    = useRef(false);
  const dragFromInputRef = useRef(false);
  const pasteRowRef      = useRef(0);
  const rowsRef          = useRef(rows);         rowsRef.current = rows;
  const selRectRef       = useRef<typeof selRect>(null);
  const tableClipboardRef = useRef(tableClipboard); tableClipboardRef.current = tableClipboard;

  // ─── Derived rows ─────────────────────────────────────────────────
  const displayRows = useMemo(
    () => showCompleteOnly
      ? rows.filter((r) => r.deviceAddress.trim() && r.signalName.trim())
      : rows,
    [rows, showCompleteOnly],
  );

  const sortedRows = useMemo(() => {
    if (!sorting) return displayRows;
    return [...displayRows].sort((a, b) => {
      const av = (a[sorting.key] as string) || '';
      const bv = (b[sorting.key] as string) || '';
      const cmp = (sorting.key === 'deviceAddress' || sorting.key === 'mainSystemAddress')
        ? naturalSortAddress(av, bv)
        : av.localeCompare(bv, 'zh-TW');
      return sorting.dir === 'asc' ? cmp : -cmp;
    });
  }, [displayRows, sorting]);

  const completeCount = useMemo(
    () => rows.filter((r) => r.deviceAddress.trim() && r.signalName.trim()).length,
    [rows],
  );

  // ─── Data callbacks ───────────────────────────────────────────────
  const update = useCallback(
    (rowId: string, field: keyof IORow, value: string) =>
      updateIORow(deviceId, type, rowId, field, value),
    [deviceId, type, updateIORow],
  );

  const handleFill = useCallback(
    (fromIndex: number, addresses: string[], autoBool: boolean) => {
      const existing = rows.length - fromIndex - 1;
      const needed   = Math.max(0, addresses.length - existing);
      if (needed > 0)
        insertRowsAfter(deviceId, type, rows.length - 1,
          addresses.slice(existing).map((a) => ({
            deviceAddress: a, ...(autoBool ? { dataType: 'BOOL' } : {}),
          })));
      rows.slice(fromIndex + 1, fromIndex + 1 + Math.min(addresses.length, existing))
        .forEach((row, i) => {
          updateIORow(deviceId, type, row.id, 'deviceAddress', addresses[i]);
          if (autoBool && !row.dataType) updateIORow(deviceId, type, row.id, 'dataType', 'BOOL');
        });
    },
    [rows, deviceId, type, updateIORow, insertRowsAfter],
  );

  const handleFillMainSystem = useCallback(
    (fromIndex: number, addresses: string[], autoBool: boolean) => {
      const existing = rows.length - fromIndex - 1;
      const needed   = Math.max(0, addresses.length - existing);
      if (needed > 0)
        insertRowsAfter(deviceId, type, rows.length - 1,
          addresses.slice(existing).map((a) => ({
            mainSystemAddress: a, ...(autoBool ? { dataType: 'BOOL' } : {}),
          })));
      rows.slice(fromIndex + 1, fromIndex + 1 + Math.min(addresses.length, existing))
        .forEach((row, i) => {
          updateIORow(deviceId, type, row.id, 'mainSystemAddress', addresses[i]);
          if (autoBool && !row.dataType) updateIORow(deviceId, type, row.id, 'dataType', 'BOOL');
        });
    },
    [rows, deviceId, type, updateIORow, insertRowsAfter],
  );

  const handleAddRow         = () => addIORow(deviceId, type);
  const handleEnterOnLastRow = () => addIORow(deviceId, type);

  // ─── onEndEdit factory ────────────────────────────────────────────
  const makeOnEndEdit = useCallback(
    (origIdx: number, colIdx: number) => () => {
      setEditingCell(null);
      selectedCellRef.current = { row: origIdx, col: colIdx };
      setSelAnchor({ row: origIdx, col: colIdx });
      setSelEnd({ row: origIdx, col: colIdx });
      pasteRowRef.current = origIdx;
    },
    [],
  );

  // ─── Selection rect ───────────────────────────────────────────────
  const selRect = useMemo(() => {
    if (!selAnchor || !selEnd) return null;
    return {
      r1: Math.min(selAnchor.row, selEnd.row), r2: Math.max(selAnchor.row, selEnd.row),
      c1: Math.min(selAnchor.col, selEnd.col), c2: Math.max(selAnchor.col, selEnd.col),
    };
  }, [selAnchor, selEnd]);
  selRectRef.current = selRect;

  const isCellSelected = useCallback((rowIdx: number, colIdx: number) => {
    const r = selRectRef.current;
    if (!r) return false;
    return rowIdx >= r.r1 && rowIdx <= r.r2 && colIdx >= r.c1 && colIdx <= r.c2;
  }, []);

  const toggleSort = useCallback((key: keyof IORow) => {
    onSortingChange(
      !sorting || sorting.key !== key ? { key, dir: 'asc' }
      : sorting.dir === 'asc'         ? { key, dir: 'desc' }
      : null
    );
  }, [sorting, onSortingChange]);

  // ─── Mouse handlers ───────────────────────────────────────────────
  const handleTableMouseDown = useCallback((e: React.MouseEvent<HTMLTableElement>) => {
    setIsDragging(false);

    const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
    if (!td) return;
    const rowStr = td.dataset.row;
    const colStr = td.dataset.col;
    if (rowStr === undefined || colStr === undefined || colStr === '') return;

    const row = parseInt(rowStr, 10);
    const col = parseInt(colStr, 10);

    activeTableKey       = tableKey;
    pasteRowRef.current  = row;
    dragStartRef.current = { row, col };
    dragFromInputRef.current =
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA' ||
      (e.target as HTMLElement).tagName === 'SELECT';

    hasDraggedRef.current = false;

    // Snapshot current selection before clearing — click handler checks
    // this to detect "click on already-selected cell → edit mode".
    selectedAtMouseDownRef.current = selectedCellRef.current;
    selectedCellRef.current = null;

    if (e.shiftKey && selAnchor) {
      e.preventDefault();
      setSelEnd({ row, col });
      return;
    }

    setSelAnchor(null);
    setSelEnd(null);
  }, [tableKey, selAnchor]);

  const handleCellMouseEnter = useCallback((e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    if (!(e.buttons & 1))         return;
    if (dragFromInputRef.current) return;
    const start = dragStartRef.current;
    if (!start)                   return;
    if (start.row === rowIdx && start.col === colIdx) return;

    // First cross-cell move: set up window mouseup so isDragging clears
    // even if the button is released outside the table element.
    if (!hasDraggedRef.current) {
      const stopDrag = () => {
        setIsDragging(false);
        window.removeEventListener('mouseup', stopDrag);
      };
      window.addEventListener('mouseup', stopDrag);
    }

    hasDraggedRef.current   = true;
    selectedCellRef.current = null;
    setIsDragging(true);
    setSelAnchor({ row: start.row, col: start.col });
    setSelEnd({ row: rowIdx, col: colIdx });
    activeTableKey = tableKey;
  }, [tableKey]);

  // Single click: select cell. If cell was already selected when mousedown
  // fired (selectedAtMouseDownRef matches), enter edit mode instead.
  const handleTableClick = useCallback((e: React.MouseEvent<HTMLTableElement>) => {
    if (e.shiftKey) return;
    if (hasDraggedRef.current) return;
    const targetTag = (e.target as HTMLElement).tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

    const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
    if (!td) return;
    const rowStr = td.dataset.row;
    const colStr = td.dataset.col;
    if (rowStr === undefined || colStr === undefined || colStr === '') return;

    const row = parseInt(rowStr, 10);
    const col = parseInt(colStr, 10);

    const prev       = selectedAtMouseDownRef.current;
    const wasSelected = prev !== null && prev.row === row && prev.col === col;

    if (wasSelected) {
      setEditingCell({ row, col });
      setSelAnchor(null);
      setSelEnd(null);
      return;
    }

    selectedCellRef.current = { row, col };
    setSelAnchor({ row, col });
    setSelEnd({ row, col });
  }, []);

  // Double-click always enters edit mode regardless of selection state.
  const handleTableDblClick = useCallback((e: React.MouseEvent<HTMLTableElement>) => {
    const targetTag = (e.target as HTMLElement).tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

    const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
    if (!td) return;
    const rowStr = td.dataset.row;
    const colStr = td.dataset.col;
    if (rowStr === undefined || colStr === undefined || colStr === '') return;

    setEditingCell({ row: parseInt(rowStr, 10), col: parseInt(colStr, 10) });
    setSelAnchor(null);
    setSelEnd(null);
  }, []);

  // ─── Copy / Paste / Delete ────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const rect = selRectRef.current;
    if (!rect) return;
    const colKeys = EDITABLE_COLS.slice(rect.c1, rect.c2 + 1);
    const data: string[][] = [];
    for (let r = rect.r1; r <= rect.r2 && r < rowsRef.current.length; r++)
      data.push(colKeys.map((col) => rowsRef.current[r][col] || ''));
    setTableClipboard({ colKeys, data });
    navigator.clipboard.writeText(data.map((r) => r.join('\t')).join('\n')).catch(() => {});
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 1500);
  }, [setTableClipboard]);

  const handlePaste = useCallback(() => {
    const cb = tableClipboardRef.current;
    if (!cb) return;
    const n = pasteClipboard(deviceId, type, pasteRowRef.current);
    setSelEnd(null);
    setPasteResult(n);
    setTimeout(() => setPasteResult(null), 2000);
  }, [pasteClipboard, deviceId, type]);

  const handleDelete = useCallback(() => {
    const rect = selRectRef.current;
    if (!rect) return;
    const colKeys = EDITABLE_COLS.slice(rect.c1, rect.c2 + 1) as (keyof IORow)[];
    const cells: { rowId: string; field: keyof IORow }[] = [];
    for (let r = rect.r1; r <= rect.r2 && r < rowsRef.current.length; r++)
      colKeys.forEach((field) => cells.push({ rowId: rowsRef.current[r].id, field }));
    clearCellRange(deviceId, type, cells);
  }, [deviceId, type, clearCellRange]);

  const handleCopyRef   = useRef(handleCopy);   handleCopyRef.current   = handleCopy;
  const handlePasteRef  = useRef(handlePaste);  handlePasteRef.current  = handlePaste;
  const handleDeleteRef = useRef(handleDelete); handleDeleteRef.current = handleDelete;

  // ─── Keyboard handler ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeTableKey !== tableKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selRectRef.current) {
        handleCopyRef.current(); e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selRectRef.current) {
        handleCopyRef.current(); handleDeleteRef.current(); e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && tableClipboardRef.current) {
        handlePasteRef.current(); e.preventDefault();
      } else if (e.key === 'Delete' && selRectRef.current) {
        handleDeleteRef.current(); e.preventDefault();
      } else if (e.key === 'Escape') {
        setSelAnchor(null); setSelEnd(null);
        setEditingCell(null);
        selectedCellRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (activeTableKey === tableKey) activeTableKey = '';
    };
  }, [tableKey]);

  // ─── Render ───────────────────────────────────────────────────────
  const baseLabel = type === 'send' ? '設備發送 IO' : '設備接受 IO';

  return (
    <div className={`io-table-section io-table-section-${type}`}>
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <div className="io-table-label collapsible-label" onClick={onCollapseToggle}>
        <span className="collapse-icon">{collapsed ? '▶' : '▼'}</span>
        {baseLabel}
        <span className="row-count-badge">
          {showCompleteOnly ? `${completeCount} / ${rows.length} 筆` : `${rows.length} 筆`}
        </span>
        <button
          className={`filter-toggle-btn${showCompleteOnly ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onShowCompleteOnlyChange(!showCompleteOnly); }}
          title={showCompleteOnly ? '顯示全部' : '只顯示完整資料行'}
        >
          {showCompleteOnly ? '全部展開' : '只看完整'}
        </button>

        {selRect && (
          <span className="sel-badge" onClick={(e) => e.stopPropagation()}>
            {selRect.r2 - selRect.r1 + 1}×{selRect.c2 - selRect.c1 + 1} 格已選
            {copyDone
              ? <span className="copy-done-tip"> ✓ 已複製</span>
              : <span className="copy-hint"> (Ctrl+C 複製)</span>}
          </span>
        )}

        {tableClipboard && (
          <button
            className="filter-toggle-btn sel-action-btn"
            onClick={(e) => { e.stopPropagation(); handlePaste(); }}
            title="點任意格後按此或 Ctrl+V 貼上"
          >
            貼上 {tableClipboard.data.length} 行
            {pasteResult !== null && <span className="paste-tip"> ✓{pasteResult}格</span>}
          </button>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {!collapsed && (
        <>
          <div className="io-table-wrapper">
            <table
              className={`io-table${isDragging ? ' cell-dragging' : ''}`}
              onMouseDown={handleTableMouseDown}
              onMouseUp={() => setIsDragging(false)}
              onClick={handleTableClick}
              onDoubleClick={handleTableDblClick}
            >
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const isSorted = sorting?.key === col.sortKey;
                    return (
                      <th
                        key={col.id}
                        style={{ width: col.width }}
                        className={col.sortKey ? 'sortable-header' : ''}
                        onClick={col.sortKey ? () => toggleSort(col.sortKey!) : undefined}
                      >
                        {col.header}
                        {col.sortKey && (
                          <span className="sort-icon">
                            {isSorted ? (sorting!.dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="empty-table-hint">
                      {showCompleteOnly
                        ? '沒有完整資料行（需同時填寫設備IO點位位址與訊號名稱）'
                        : '尚無資料，點擊下方「＋ 新增行」開始建立'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => {
                    const origIdx    = rows.findIndex((r) => r.id === row.id);
                    const isComplete = !!(row.deviceAddress.trim() && row.signalName.trim());
                    const sel        = (c: number) => isCellSelected(origIdx, c) ? 'cell-selected' : '';
                    const enter      = (c: number) =>
                      (e: React.MouseEvent) => handleCellMouseEnter(e, origIdx, c);

                    return (
                      <tr key={row.id} className={`io-row${isComplete ? ' io-row-complete' : ''}`}>

                        {/* 設備名稱 (read-only, not selectable) */}
                        <td>
                          <div className="cell-display cell-readonly">{deviceName}</div>
                        </td>

                        {/* 設備IO點位位址 */}
                        <td data-row={origIdx} data-col={0} className={sel(0)} onMouseEnter={enter(0)}>
                          <AddressCell
                            value={row.deviceAddress} rowIndex={origIdx}
                            onChange={(v) => update(row.id, 'deviceAddress', v)}
                            onFill={handleFill} onEnterLast={handleEnterOnLastRow}
                            isLast={origIdx === rows.length - 1}
                            isEditing={editingCell?.row === origIdx && editingCell?.col === 0}
                            onEndEdit={makeOnEndEdit(origIdx, 0)}
                          />
                        </td>

                        {/* 訊號名稱 */}
                        <td data-row={origIdx} data-col={1} className={sel(1)} onMouseEnter={enter(1)}>
                          <EditableCell
                            value={row.signalName} onChange={(v) => update(row.id, 'signalName', v)}
                            placeholder="訊號名稱" onEnterLast={handleEnterOnLastRow}
                            isLast={origIdx === rows.length - 1}
                            isEditing={editingCell?.row === origIdx && editingCell?.col === 1}
                            onEndEdit={makeOnEndEdit(origIdx, 1)}
                          />
                        </td>

                        {/* 資料類型 */}
                        <td data-row={origIdx} data-col={2} className={sel(2)} onMouseEnter={enter(2)}>
                          <DataTypeCell
                            value={row.dataType} onChange={(v) => update(row.id, 'dataType', v)}
                            isEditing={editingCell?.row === origIdx && editingCell?.col === 2}
                            onEndEdit={makeOnEndEdit(origIdx, 2)}
                          />
                        </td>

                        {/* 主系統點位位址 */}
                        <td data-row={origIdx} data-col={3} className={sel(3)} onMouseEnter={enter(3)}>
                          <AddressCell
                            value={row.mainSystemAddress} rowIndex={origIdx}
                            onChange={(v) => update(row.id, 'mainSystemAddress', v)}
                            onFill={handleFillMainSystem} onEnterLast={handleEnterOnLastRow}
                            isLast={origIdx === rows.length - 1}
                            placeholder={mainSystemPlaceholder}
                            isConflict={
                              !!row.mainSystemAddress &&
                              conflictingAddresses.has(row.mainSystemAddress.trim().toUpperCase())
                            }
                            isEditing={editingCell?.row === origIdx && editingCell?.col === 3}
                            onEndEdit={makeOnEndEdit(origIdx, 3)}
                          />
                        </td>

                        {/* 備註 */}
                        <td data-row={origIdx} data-col={4} className={sel(4)} onMouseEnter={enter(4)}>
                          <EditableCell
                            value={row.remark} onChange={(v) => update(row.id, 'remark', v)}
                            placeholder="備註" onEnterLast={handleEnterOnLastRow}
                            isLast={origIdx === rows.length - 1}
                            isEditing={editingCell?.row === origIdx && editingCell?.col === 4}
                            onEndEdit={makeOnEndEdit(origIdx, 4)}
                          />
                        </td>

                        {/* 刪除 */}
                        <td>
                          <button
                            className="delete-row-btn"
                            onClick={() => deleteIORow(deviceId, type, row.id)}
                            title="刪除此行"
                          >✕</button>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {!showCompleteOnly && (
            <button className="add-row-btn" onClick={handleAddRow}>＋ 新增行</button>
          )}
        </>
      )}
    </div>
  );
}
