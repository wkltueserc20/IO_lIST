import { useState } from 'react';
import type { MainSystemBrand } from '../types';
import type { ParsedResult } from '../utils/excelImport';

const BRANDS: { value: MainSystemBrand; label: string }[] = [
  { value: 'KEYENCE', label: 'KEYENCE KV' },
  { value: 'Mitsubishi', label: '三菱 (Mitsubishi)' },
  { value: 'Siemens', label: '西門子 (Siemens)' },
  { value: 'Omron', label: '歐姆龍 (Omron)' },
  { value: 'Modbus', label: 'Modbus Generic' },
  { value: 'Custom', label: '自訂 (Custom)' },
];

interface Props {
  result: ParsedResult;
  onConfirm: (mainSystem: MainSystemBrand) => void;
  onCancel: () => void;
}

export function ImportExcelModal({ result, onConfirm, onCancel }: Props) {
  const [mainSystem, setMainSystem] = useState<MainSystemBrand>('KEYENCE');

  return (
    <>
      <div className="shortcut-overlay" onClick={onCancel} />
      <div className="import-modal">
        <div className="import-modal-header">匯入 Excel</div>

        <div className="import-modal-body">
          <div className="import-field">
            <span className="import-label">專案名稱</span>
            <span className="import-value">{result.projectName}</span>
          </div>

          <div className="import-field">
            <span className="import-label">主系統品牌</span>
            <select
              className="brand-select"
              value={mainSystem}
              onChange={(e) => setMainSystem(e.target.value as MainSystemBrand)}
            >
              {BRANDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          <div className="import-devices-label">偵測到的設備（{result.devices.length} 台）</div>

          {result.devices.length === 0 ? (
            <div className="import-warning">未偵測到有效設備資料</div>
          ) : (
            <div className="import-device-list">
              {result.devices.map((d) => (
                <div key={d.name} className="import-device-row">
                  <span className="import-device-name">{d.name}</span>
                  <span className="import-device-io">發送 {d.sendIO.length} / 接受 {d.receiveIO.length}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="import-modal-footer">
          <button className="import-btn-cancel" onClick={onCancel}>取消</button>
          <button className="import-btn-load" onClick={() => onConfirm(mainSystem)}>載入</button>
        </div>
      </div>
    </>
  );
}
