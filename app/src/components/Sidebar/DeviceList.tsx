import { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { DeviceItem } from './DeviceItem';

interface Props {
  filterKeyword: string;
}

export function DeviceList({ filterKeyword }: Props) {
  const devices = useProjectStore((s) => s.devices);
  const reorderDevices = useProjectStore((s) => s.reorderDevices);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const filteredDevices = useMemo(
    () => filterKeyword
      ? devices.filter((d) => d.name.toLowerCase().includes(filterKeyword.toLowerCase()))
      : devices,
    [devices, filterKeyword],
  );

  if (devices.length === 0) {
    return <div className="device-list-empty">尚無設備，請點擊下方新增</div>;
  }

  if (filteredDevices.length === 0) {
    return <div className="device-list-empty">找不到符合的設備</div>;
  }

  const handleDragStart = (id: string) => setDraggedId(id);
  const handleDragOver = (id: string) => { if (id !== draggedId) setDragOverId(id); };
  const handleDrop = (toId: string) => {
    if (draggedId && draggedId !== toId) reorderDevices(draggedId, toId);
    setDraggedId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  return (
    <div className="device-list">
      {filteredDevices.map((d) => (
        <DeviceItem
          key={d.id}
          device={d}
          isDragging={draggedId === d.id}
          isDragOver={dragOverId === d.id}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}
