import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { findConflictingAddresses } from '../utils/addressUtils';

export function StatusBar() {
  const devices = useProjectStore((s) => s.devices);
  const hasUnsavedChanges = useProjectStore((s) => s.hasUnsavedChanges);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);

  const stats = useMemo(() => {
    let totalIO = 0;
    let completeIO = 0;
    const allMainAddresses: string[] = [];
    let ipConflictCount = 0;

    const ipMap = new Map<string, number>();
    for (const d of devices) {
      const allRows = [...d.sendIO, ...d.receiveIO];
      totalIO += allRows.length;
      completeIO += allRows.filter((r) => r.deviceAddress.trim() && r.signalName.trim()).length;
      allMainAddresses.push(...allRows.map((r) => r.mainSystemAddress));

      if (d.ip) {
        const key = `${d.ip}:${d.port ?? ''}`;
        ipMap.set(key, (ipMap.get(key) ?? 0) + 1);
      }
    }

    for (const count of ipMap.values()) {
      if (count > 1) ipConflictCount++;
    }

    const conflictSet = findConflictingAddresses(allMainAddresses);
    const completePct = totalIO > 0 ? Math.round((completeIO / totalIO) * 100) : 0;

    return { totalIO, completeIO, completePct, conflictCount: conflictSet.size, ipConflictCount };
  }, [devices]);

  const savedLabel = hasUnsavedChanges
    ? '未存檔'
    : lastSavedAt
    ? `已儲存 ${lastSavedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
    : '未存檔';

  return (
    <div className="status-bar">
      <span className="status-bar__item">設備 {devices.length} 台</span>
      <span className="status-bar__sep">·</span>
      <span className="status-bar__item">IO {stats.totalIO} 點</span>
      <span className="status-bar__sep">·</span>
      <span className="status-bar__item">完成 {stats.completePct}%</span>
      {stats.conflictCount > 0 && (
        <>
          <span className="status-bar__sep">·</span>
          <span className="status-bar__item status-bar__item--warn">{stats.conflictCount} 個衝突</span>
        </>
      )}
      {stats.ipConflictCount > 0 && (
        <>
          <span className="status-bar__sep">·</span>
          <span className="status-bar__item status-bar__item--warn">{stats.ipConflictCount} 組 IP 衝突</span>
        </>
      )}
      <span className="status-bar__spacer" />
      <span className={`status-bar__item${hasUnsavedChanges ? ' status-bar__item--unsaved' : ''}`}>
        {savedLabel}
      </span>
    </div>
  );
}
