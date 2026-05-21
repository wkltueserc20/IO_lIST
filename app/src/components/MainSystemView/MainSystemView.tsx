import { useMemo } from 'react';
import { buildMainSystemRows } from '../../utils/naturalSort';
import type { Device } from '../../types';

interface Props {
  devices: Device[];
  onNavigate: (deviceId: string, rowId: string, ioType: 'send' | 'receive') => void;
}

export function MainSystemView({ devices, onNavigate }: Props) {
  const rows = useMemo(() => buildMainSystemRows(devices), [devices]);

  if (rows.length === 0) {
    return (
      <main className="main-content main-content-empty">
        <div className="empty-hint">尚無完整的主系統點位資料<br />（需同時填寫主系統點位、設備點位、訊號名稱）</div>
      </main>
    );
  }

  return (
    <main className="main-content main-system-view">
      <div className="main-system-header">
        <h2>主系統視角</h2>
        <span className="main-system-count">共 {rows.length} 筆</span>
        {rows.some((r) => r.isDuplicate) && (
          <span className="main-system-dup-warning">⚠ 有重複的主系統點位</span>
        )}
      </div>
      <div className="main-system-table-wrap">
        <table className="main-system-table">
          <thead>
            <tr>
              <th>主系統點位</th>
              <th>方向</th>
              <th>設備名稱</th>
              <th>設備點位</th>
              <th>訊號名稱</th>
              <th>資料類型</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={row.isDuplicate ? 'main-system-row-duplicate' : ''}
                onClick={() => onNavigate(row.deviceId, row.rowId, row.ioType)}
                style={{ cursor: 'pointer' }}
                title={`點擊導航至 ${row.deviceName}`}
              >
                <td className="main-system-addr">{row.mainSystemAddress}</td>
                <td>
                  <span className={row.direction === 'recv' ? 'direction-badge direction-recv' : 'direction-badge direction-send'}>
                    {row.direction === 'recv' ? '← 接收' : '→ 發送'}
                  </span>
                </td>
                <td>{row.deviceName}</td>
                <td>{row.deviceAddress}</td>
                <td>{row.signalName}</td>
                <td>{row.dataType}</td>
                <td className="main-system-remark">{row.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
