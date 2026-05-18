import { useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import type { Device } from '../../types';

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
  const { selectedDeviceId, selectDevice, deleteDevice, renameDevice, checkDuplicateIP } = useProjectStore();
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
      ].filter(Boolean).join(' ')}
      draggable={!isEditing}
      onClick={() => { if (!isEditing) selectDevice(device.id); }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(device.id); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(device.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(device.id); }}
      onDragEnd={onDragEnd}
    >
      <span className="device-drag-handle" title="拖曳排序">⠿</span>

      <div className="device-item-body">
        <div className="device-item-row1">
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

      <button className="device-delete-btn" onClick={handleDelete} title="刪除設備">✕</button>
    </div>
  );
}
