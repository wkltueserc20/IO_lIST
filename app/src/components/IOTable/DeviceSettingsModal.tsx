import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import type { Device, PlcBrand } from '../../types';

interface Props {
  device: Device;
  onClose: () => void;
}

const IPV4_RE = /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/;

const PORT_CHIPS = [
  { label: 'Modbus', port: '502' },
  { label: 'FINS', port: '9600' },
  { label: 'MC', port: '5007' },
  { label: 'KEYENCE KV', port: '8501' },
];

function validateIP(ip: string): string | null {
  if (!ip) return null;
  return IPV4_RE.test(ip) ? null : 'IP 格式不正確（應為 x.x.x.x，各段 0–255）';
}

function validatePort(port: string): string | null {
  if (!port) return null;
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : 'Port 需為 1–65535 的整數';
}

export function DeviceSettingsModal({ device, onClose }: Props) {
  const { updateDeviceSettings, checkDuplicateIP, updateDevicePlcBrand } = useProjectStore();
  const [activeTab, setActiveTab] = useState<'network' | 'plc'>('network');
  const [ip, setIp] = useState(device.ip ?? '');
  const [port, setPort] = useState(device.port ?? '');
  const [plcBrand, setPlcBrand] = useState<PlcBrand>(device.plcBrand ?? null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const ipError = validateIP(ip);
  const portError = validatePort(port);
  const dupResult = ipError ? { type: 'none' as const } : checkDuplicateIP(ip, port, device.id);

  const canSave = !ipError && !portError && dupResult.type !== 'error';

  const handleSave = () => {
    if (!canSave) return;
    updateDeviceSettings(device.id, ip, port);
    updateDevicePlcBrand(device.id, plcBrand);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-box device-settings-modal">
        <div className="modal-header">
          <span>⚙ {device.name} — 設備設定</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="ds-tab-bar">
          <button
            className={`ds-tab ${activeTab === 'network' ? 'active' : ''}`}
            onClick={() => setActiveTab('network')}
          >
            網路連線
          </button>
          <button
            className={`ds-tab ${activeTab === 'plc' ? 'active' : ''}`}
            onClick={() => setActiveTab('plc')}
          >
            PLC 通訊
          </button>
        </div>

        {activeTab === 'network' && (
          <div className="modal-body">
            <div className="modal-field">
              <label>IP 位址</label>
              <div className="ds-input-group">
                <input
                  className={`modal-input${ipError ? ' input-error' : ''}`}
                  placeholder="192.168.1.100"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  autoFocus
                />
                {ipError && <div className="ds-msg ds-msg-error">{ipError}</div>}
                {!ipError && dupResult.type === 'error' && (
                  <div className="ds-msg ds-msg-error">與「{dupResult.deviceName}」的 IP+Port 完全相同</div>
                )}
                {!ipError && dupResult.type === 'warn' && (
                  <div className="ds-msg ds-msg-warn">⚠ 「{dupResult.deviceName}」也使用此 IP（Port 不同，請確認）</div>
                )}
              </div>
            </div>

            <div className="modal-field">
              <label>通訊埠</label>
              <div className="ds-input-group">
                <input
                  className={`modal-input ds-port-input${portError ? ' input-error' : ''}`}
                  placeholder="502"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
                {portError && <div className="ds-msg ds-msg-error">{portError}</div>}
                <div className="ds-chips">
                  {PORT_CHIPS.map((c) => (
                    <button
                      key={c.port}
                      className={`ds-chip${port === c.port ? ' active' : ''}`}
                      onClick={() => setPort(c.port)}
                      type="button"
                    >
                      {c.label} {c.port}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'plc' && (
          <div className="modal-body">
            <div className="modal-field">
              <label>PLC 品牌 / 通訊協定</label>
              <div className="ds-input-group">
                <select
                  className="modal-input"
                  value={plcBrand ?? ''}
                  onChange={(e) => setPlcBrand((e.target.value as PlcBrand) || null)}
                >
                  <option value="">不設定</option>
                  <option value="KEYENCE_KV">KEYENCE KV</option>
                  <option value="Mitsubishi_3E">三菱 MELSEC 3E（MC 3E ASCII）</option>
                </select>
                <div className="ds-msg" style={{ color: '#888', fontSize: '0.8em', marginTop: 4 }}>
                  選擇後可在側邊欄開啟即時監控，讀取 IO 點位目前值。
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onClose}>取消</button>
          <button
            className="modal-btn-confirm"
            disabled={!canSave}
            onClick={handleSave}
          >
            儲存設定
          </button>
        </div>
      </div>
    </div>
  );
}
