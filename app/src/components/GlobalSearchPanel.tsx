import { useEffect, useMemo, useRef } from 'react';
import type { Device } from '../types';

interface SearchResult {
  deviceId: string;
  deviceName: string;
  rowId: string;
  ioType: 'send' | 'receive';
  deviceAddress: string;
  signalName: string;
  mainSystemAddress: string;
  remark: string;
}

interface Props {
  keyword: string;
  onKeywordChange: (v: string) => void;
  onClose: () => void;
  onNavigate: (deviceId: string, rowId: string, ioType: 'send' | 'receive') => void;
  devices: Device[];
}

function highlight(text: string, kw: string) {
  if (!kw || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + kw.length)}</mark>
      {text.slice(idx + kw.length)}
    </>
  );
}

export function GlobalSearchPanel({ keyword, onKeywordChange, onClose, onNavigate, devices }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo<SearchResult[]>(() => {
    if (keyword.length < 2) return [];
    const kw = keyword.toLowerCase();
    const out: SearchResult[] = [];
    for (const device of devices) {
      for (const row of device.sendIO) {
        if (
          row.deviceAddress.toLowerCase().includes(kw) ||
          row.signalName.toLowerCase().includes(kw) ||
          row.mainSystemAddress.toLowerCase().includes(kw) ||
          row.remark.toLowerCase().includes(kw)
        ) {
          out.push({ deviceId: device.id, deviceName: device.name, rowId: row.id, ioType: 'send', ...row });
        }
      }
      for (const row of device.receiveIO) {
        if (
          row.deviceAddress.toLowerCase().includes(kw) ||
          row.signalName.toLowerCase().includes(kw) ||
          row.mainSystemAddress.toLowerCase().includes(kw) ||
          row.remark.toLowerCase().includes(kw)
        ) {
          out.push({ deviceId: device.id, deviceName: device.name, rowId: row.id, ioType: 'receive', ...row });
        }
      }
    }
    return out;
  }, [keyword, devices]);

  const grouped = useMemo(() => {
    const map = new Map<string, { deviceName: string; results: SearchResult[] }>();
    for (const r of results) {
      if (!map.has(r.deviceId)) map.set(r.deviceId, { deviceName: r.deviceName, results: [] });
      map.get(r.deviceId)!.results.push(r);
    }
    return map;
  }, [results]);

  return (
    <>
      <div className="global-search-overlay" onClick={onClose} />
      <div className="global-search-panel">
        <div className="global-search-input-row">
          <input
            ref={inputRef}
            className="global-search-input"
            placeholder="搜尋 IO 點位、訊號名稱、位址…"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
          />
          <button className="global-search-close" onClick={onClose}>✕</button>
        </div>
        {keyword.length > 0 && keyword.length < 2 && (
          <div className="global-search-hint">請輸入至少 2 個字元</div>
        )}
        {keyword.length >= 2 && results.length === 0 && (
          <div className="global-search-hint">找不到符合的 IO 點位</div>
        )}
        {results.length > 0 && (
          <div className="global-search-results">
            <div className="global-search-count">{results.length} 筆結果</div>
            {[...grouped.entries()].map(([deviceId, { deviceName, results: group }]) => (
              <div key={deviceId}>
                <div className="global-search-group-title">
                  {deviceName}（{group.length} 筆）
                </div>
                {group.map((r) => (
                  <button
                    key={r.rowId}
                    className="global-search-result-row"
                    onClick={() => { onNavigate(r.deviceId, r.rowId, r.ioType); onClose(); }}
                  >
                    <span className="global-search-result-signal">{highlight(r.signalName, keyword) || '—'}</span>
                    <span className="global-search-result-addrs">
                      {r.deviceAddress && <span>{highlight(r.deviceAddress, keyword)}</span>}
                      {r.mainSystemAddress && <span>→ {highlight(r.mainSystemAddress, keyword)}</span>}
                    </span>
                    <span className={`direction-badge direction-${r.ioType === 'send' ? 'send' : 'recv'} global-search-result-type`}>
                      {r.ioType === 'send' ? '→ 發送' : '← 接收'}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
