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
  const { selectedDeviceId, selectDevice, deleteDevice } = useProjectStore();
  const isSelected = selectedDeviceId === device.id;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`確定要刪除「${device.name}」及其所有 IO 資料嗎？`)) {
      deleteDevice(device.id);
    }
  };

  return (
    <div
      className={[
        'device-item',
        isSelected ? 'selected' : '',
        isDragging ? 'device-item-dragging' : '',
        isDragOver ? 'device-item-drag-over' : '',
      ].filter(Boolean).join(' ')}
      draggable
      onClick={() => selectDevice(device.id)}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(device.id); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(device.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(device.id); }}
      onDragEnd={onDragEnd}
    >
      <span className="device-drag-handle" title="拖曳排序">⠿</span>
      <span className="device-name">{device.name}</span>
      <button className="device-delete-btn" onClick={handleDelete} title="刪除設備">✕</button>
    </div>
  );
}
