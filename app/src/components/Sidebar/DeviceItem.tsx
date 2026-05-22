import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../../store/useProjectStore';
import { isTauri } from '../../utils/fileUtils';
import type { Device, ConnectionStatus } from '../../types';

interface Props {
  device: Device;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

export function DeviceItem({ device, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }: Props) {
  const { selectedDeviceId, selectDevice, deleteDevice, renameDevice, cloneDevice, checkDuplicateIP, setViewMode, connectionStatus, setConnectionStatus, monitoringDevices, startMonitoring, stopMonitoring } = useProjectStore();
  const isSelected = selectedDeviceId === device.id;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');

  const allRows = [...device.sendIO, ...device.receiveIO];
  const totalRows = allRows.length;
  const completeRows = allRows.filter((r) => r.deviceAddress.trim() && r.signalName.trim()).length;
  const completePct = totalRows > 0 ? Math.round((completeRows / totalRows) * 100) : 0;

  const ipStatus = device.ip
    ? checkDuplicateIP(device.ip, device.port ?? '', device.id)
    : { type: 'none' as const };

  const ipDot =
    !device.ip              ? '○'
    : ipStatus.type === 'error' ? '✕'
    : ipStatus.type === 'warn'  ? '⚠'
    : '●';

  const ipDotClass =
    !device.ip              ? 'device-ip-dot device-ip-dot-none'
    : ipStatus.type === 'error' ? 'device-ip-dot device-ip-dot-error'
    : ipStatus.type === 'warn'  ? 'device-ip-dot device-ip-dot-warn'
    : 'device-ip-dot device-ip-dot-ok';

  const ipTitle = !device.ip
    ? '未設定 IP'
    : `${device.ip}${device.port ? `:${device.port}` : ''}${
        ipStatus.type === 'error' ? ` (與 ${ipStatus.deviceName} 衝突)`
        : ipStatus.type === 'warn'  ? ` (與 ${ipStatus.deviceName} 同 IP)`
        : ''
      }`;

  const connStatus = connectionStatus[device.id] ?? 'idle';
  const isMonitoring = monitoringDevices.has(device.id);

  const handlePing = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!device.ip) return;
    const port = device.port ? parseInt(device.port, 10) : undefined;
    setConnectionStatus(device.id, 'testing');
    invoke<string>('test_connection', { ip: device.ip, port })
      .then((status) => setConnectionStatus(device.id, status as ConnectionStatus))
      .catch(() => setConnectionStatus(device.id, 'offline'));
  };

  const handleClone = (e: React.MouseEvent) => {
    e.stopPropagation();
    cloneDevice(device.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`確定要刪除「${device.name}」及其所有 IO 資料嗎？`)) {
      deleteDevice(device.id);
    }
  };

  const enterEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(device.name);
    setIsEditing(true);
  };

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== device.name) renameDevice(device.id, trimmed);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setIsEditing(false);
  };

  return (
    <div
      className={[
        'device-item',
        isSelected ? 'selected' : '',
        isDragging ? 'device-item-dragging' : '',
        isDragOver ? 'device-item-drag-over' : '',
        isMonitoring ? 'device-item--monitoring' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => { if (!isEditing) { selectDevice(device.id); setViewMode('device'); } }}
      onPointerEnter={(e) => { if (e.buttons > 0) onDragOver(device.id); }}
      onPointerUp={() => onDrop(device.id)}
    >
      <span
        className="device-drag-handle"
        title="拖曳排序"
        onPointerDown={(e) => { if (!isEditing) { e.preventDefault(); onDragStart(device.id); } }}
        onClick={(e) => e.stopPropagation()}
      >⠿</span>

      <div className="device-item-body">
        <div className="device-item-row1">
          {isTauri() && device.ip && (
            <span
              className={`device-conn-dot device-conn-dot--${connStatus}`}
              title={
                connStatus === 'online'   ? 'IP 可達，Port 連線成功' :
                connStatus === 'ip-only'  ? 'IP 可達，但 Port 無回應（請確認 Port 設定）' :
                connStatus === 'offline'  ? 'IP 無回應' :
                connStatus === 'testing'  ? '測試中…' :
                '尚未測試（點擊 🔌 開始）'
              }
            />
          )}
          {isEditing ? (
            <input
              className="device-rename-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="device-name" onDoubleClick={enterEdit} title="雙擊重新命名">
              {device.name}
            </span>
          )}
          <span className={ipDotClass} title={ipTitle}>{ipDot}</span>
        </div>

        {totalRows > 0 && (
          <div className="device-item-row2">
            <div className="device-progress-bar">
              <div className="device-progress-fill" style={{ width: `${completePct}%` }} />
            </div>
            <span className="device-complete-count">{completeRows}/{totalRows}</span>
          </div>
        )}
      </div>

      {isTauri() && device.plcBrand && (
        <button
          className={`device-monitor-btn${isMonitoring ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); isMonitoring ? stopMonitoring(device.id) : startMonitoring(device.id); }}
          title={isMonitoring ? '停止監控' : '開始監控 PLC 值'}
        >📡</button>
      )}
      {isTauri() && (
        <button
          className="device-ping-btn"
          onClick={handlePing}
          disabled={!device.ip || connStatus === 'testing'}
          title={device.ip ? `Ping ${device.ip}:${device.port ?? '502'}` : '請先設定 IP'}
        >🔌</button>
      )}
      <button className="device-clone-btn" onClick={handleClone} title="複製設備">⧉</button>
      <button className="device-delete-btn" onClick={handleDelete} title="刪除設備">✕</button>
    </div>
  );
}
