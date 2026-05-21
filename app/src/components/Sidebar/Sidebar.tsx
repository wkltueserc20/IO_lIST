import { useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { DeviceList } from './DeviceList';
import { AddDeviceButton } from './AddDeviceButton';

export function Sidebar() {
  const devices = useProjectStore((s) => s.devices);
  const [filterKeyword, setFilterKeyword] = useState('');

  const filteredCount = filterKeyword
    ? devices.filter((d) => d.name.toLowerCase().includes(filterKeyword.toLowerCase())).length
    : devices.length;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">設備列表（{filteredCount} 台）</div>
      <div className="sidebar-search-wrap">
        <input
          className="sidebar-search"
          type="text"
          placeholder="搜尋設備…"
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setFilterKeyword(''); }}
        />
        {filterKeyword && (
          <button className="sidebar-search-clear" onClick={() => setFilterKeyword('')}>✕</button>
        )}
      </div>
      <DeviceList filterKeyword={filterKeyword} />
      <AddDeviceButton />
    </aside>
  );
}
