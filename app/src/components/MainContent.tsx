import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { IOTable } from './IOTable/IOTable';
import type { SortState } from './IOTable/IOTable';
import { DataTypeManager } from './IOTable/DataTypeManager';
import { BatchReplaceModal } from './IOTable/BatchReplaceModal';
import { DeviceSettingsModal } from './IOTable/DeviceSettingsModal';
import { MainSystemView } from './MainSystemView/MainSystemView';
import { ConflictBadge } from './ConflictBadge';
import { EmptyDeviceGuide } from './EmptyDeviceGuide';
import { findConflictingAddresses } from '../utils/addressUtils';
import type { MainSystemBrand } from '../types';

type TablePersistState = {
  collapsed: boolean;
  sorting: SortState;
  showCompleteOnly: boolean;
};

const DEFAULT_TABLE_STATE: TablePersistState = {
  collapsed: false,
  sorting: null,
  showCompleteOnly: false,
};

const PLACEHOLDERS: Record<MainSystemBrand, string> = {
  KEYENCE: '如：DM100、MR0',
  Mitsubishi: '如：D100、M0、X0',
  Siemens: '如：MW100、M0.0',
  Omron: '如：DM0000、CIO0.00',
  Modbus: '如：40001、00001',
  Custom: '自訂位址',
};

interface HighlightTarget {
  deviceId: string;
  rowId: string;
  ioType: 'send' | 'receive';
}

interface Props {
  highlightTarget: HighlightTarget | null;
  clearHighlight: () => void;
  onNavigate: (deviceId: string, rowId: string, ioType: 'send' | 'receive') => void;
}

export function MainContent({ highlightTarget, clearHighlight, onNavigate }: Props) {
  const { devices, selectedDeviceId, mainSystem, checkDuplicateIP, viewMode, addIORow } = useProjectStore();
  const [showBatchReplace, setShowBatchReplace] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tableStates, setTableStates] = useState<Record<string, TablePersistState>>({});
  const device = devices.find((d) => d.id === selectedDeviceId);

  const getTableState = (deviceId: string, type: 'send' | 'receive') =>
    tableStates[`${deviceId}-${type}`] ?? DEFAULT_TABLE_STATE;

  const patchTableState = (deviceId: string, type: 'send' | 'receive', patch: Partial<TablePersistState>) => {
    const key = `${deviceId}-${type}`;
    setTableStates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? DEFAULT_TABLE_STATE), ...patch },
    }));
  };

  // Auto-expand table when navigating to a highlight target
  useEffect(() => {
    if (!highlightTarget) return;
    patchTableState(highlightTarget.deviceId, highlightTarget.ioType, { collapsed: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTarget]);

  // 計算所有設備的主系統點位位址重複集合（跨設備全域偵測）
  const conflictingAddresses = useMemo(() => {
    const allAddresses = devices.flatMap((d) =>
      [...d.sendIO, ...d.receiveIO].map((r) => r.mainSystemAddress)
    );
    return findConflictingAddresses(allAddresses);
  }, [devices]);

  if (viewMode === 'main-system') {
    return <MainSystemView devices={devices} onNavigate={onNavigate} />;
  }

  if (!device) {
    return (
      <main className="main-content main-content-empty">
        <div className="empty-hint">請從左側選擇或新增設備</div>
      </main>
    );
  }

  const placeholder = PLACEHOLDERS[mainSystem] || '自訂位址';

  const sendTotal = device.sendIO.length;
  const receiveTotal = device.receiveIO.length;
  const totalIO = sendTotal + receiveTotal;
  const sendComplete = device.sendIO.filter((r) => r.deviceAddress.trim() && r.signalName.trim()).length;
  const receiveComplete = device.receiveIO.filter((r) => r.deviceAddress.trim() && r.signalName.trim()).length;
  const totalComplete = sendComplete + receiveComplete;

  const dupResult = device.ip
    ? checkDuplicateIP(device.ip, device.port ?? '', device.id)
    : { type: 'none' as const };

  const badgeClass =
    !device.ip ? 'ip-badge ip-badge-unset'
    : dupResult.type === 'error' ? 'ip-badge ip-badge-error'
    : dupResult.type === 'warn'  ? 'ip-badge ip-badge-warn'
    : 'ip-badge ip-badge-ok';

  const badgeLabel = !device.ip
    ? '○ 未設定 IP'
    : dupResult.type === 'error'
    ? `✕ ${device.ip}:${device.port}`
    : dupResult.type === 'warn'
    ? `⚠ ${device.ip}:${device.port}`
    : `● ${device.ip}${device.port ? `:${device.port}` : ''}`;

  return (
    <main className="main-content">
      <div className="device-header">
        <h2>{device.name}</h2>
        <button className={badgeClass} onClick={() => setShowSettings(true)} title="設備網路設定">
          {badgeLabel}
        </button>
        <button className="batch-replace-btn" onClick={() => setShowBatchReplace(true)}>
          ⚡ 批量替換
        </button>
        <ConflictBadge
          conflictCount={conflictingAddresses.size}
          onClick={() => document.querySelector('[data-conflict="true"]')?.scrollIntoView({ behavior: 'smooth' })}
        />
      </div>
      <div className="device-stats-bar">
        <span className="device-stat-send">↑ 發送 {sendTotal}</span>
        <span className="device-stat-sep">·</span>
        <span className="device-stat-recv">↓ 接收 {receiveTotal}</span>
        {totalIO > 0 && (
          <>
            <span className="device-stat-sep">·</span>
            <span className={totalComplete === totalIO ? 'device-stat-done' : ''}>
              完整 {totalComplete}/{totalIO}（{Math.round((totalComplete / totalIO) * 100)}%）
            </span>
          </>
        )}
      </div>
      {showSettings && (
        <DeviceSettingsModal device={device} onClose={() => setShowSettings(false)} />
      )}
      {showBatchReplace && (
        <BatchReplaceModal
          currentDeviceId={device.id}
          onClose={() => setShowBatchReplace(false)}
        />
      )}
      {device.sendIO.length === 0 && device.receiveIO.length === 0 ? (
        <EmptyDeviceGuide
          onAddSend={() => addIORow(device.id, 'send')}
          onAddReceive={() => addIORow(device.id, 'receive')}
        />
      ) : (
        <>
          <IOTable
            key={`${device.id}-send`}
            deviceId={device.id}
            deviceName={device.name}
            type="send"
            rows={device.sendIO}
            mainSystemPlaceholder={placeholder}
            conflictingAddresses={conflictingAddresses}
            collapsed={getTableState(device.id, 'send').collapsed}
            onCollapseToggle={() => patchTableState(device.id, 'send', { collapsed: !getTableState(device.id, 'send').collapsed })}
            sorting={getTableState(device.id, 'send').sorting}
            onSortingChange={(s) => patchTableState(device.id, 'send', { sorting: s })}
            showCompleteOnly={getTableState(device.id, 'send').showCompleteOnly}
            onShowCompleteOnlyChange={(v) => patchTableState(device.id, 'send', { showCompleteOnly: v })}
            highlightRowId={highlightTarget?.deviceId === device.id && highlightTarget?.ioType === 'send' ? highlightTarget.rowId : null}
            clearHighlight={clearHighlight}
          />
          <IOTable
            key={`${device.id}-receive`}
            deviceId={device.id}
            deviceName={device.name}
            type="receive"
            rows={device.receiveIO}
            mainSystemPlaceholder={placeholder}
            conflictingAddresses={conflictingAddresses}
            collapsed={getTableState(device.id, 'receive').collapsed}
            onCollapseToggle={() => patchTableState(device.id, 'receive', { collapsed: !getTableState(device.id, 'receive').collapsed })}
            sorting={getTableState(device.id, 'receive').sorting}
            onSortingChange={(s) => patchTableState(device.id, 'receive', { sorting: s })}
            showCompleteOnly={getTableState(device.id, 'receive').showCompleteOnly}
            onShowCompleteOnlyChange={(v) => patchTableState(device.id, 'receive', { showCompleteOnly: v })}
            highlightRowId={highlightTarget?.deviceId === device.id && highlightTarget?.ioType === 'receive' ? highlightTarget.rowId : null}
            clearHighlight={clearHighlight}
          />
        </>
      )}
      <DataTypeManager />
    </main>
  );
}
