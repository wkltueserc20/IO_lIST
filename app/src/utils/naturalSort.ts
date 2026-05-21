import type { Device, MainSystemRow } from '../types';

function segments(s: string): (string | number)[] {
  return s.split(/(\d+)/).map((p, i) => (i % 2 === 1 ? parseInt(p, 10) : p));
}

export function naturalCompare(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const pa = sa[i] ?? '';
    const pb = sb[i] ?? '';
    if (pa === pb) continue;
    if (typeof pa === 'number' && typeof pb === 'number') return pa - pb;
    return String(pa) < String(pb) ? -1 : 1;
  }
  return 0;
}

export function buildMainSystemRows(devices: Device[]): MainSystemRow[] {
  const rows: MainSystemRow[] = [];

  for (const device of devices) {
    for (const row of device.sendIO) {
      if (row.mainSystemAddress.trim() && row.deviceAddress.trim() && row.signalName.trim()) {
        rows.push({
          mainSystemAddress: row.mainSystemAddress,
          direction: 'recv',
          deviceId: device.id,
          deviceName: device.name,
          deviceAddress: row.deviceAddress,
          signalName: row.signalName,
          dataType: row.dataType,
          remark: row.remark,
          isDuplicate: false,
          rowId: row.id,
          ioType: 'send',
        });
      }
    }
    for (const row of device.receiveIO) {
      if (row.mainSystemAddress.trim() && row.deviceAddress.trim() && row.signalName.trim()) {
        rows.push({
          mainSystemAddress: row.mainSystemAddress,
          direction: 'send',
          deviceId: device.id,
          deviceName: device.name,
          deviceAddress: row.deviceAddress,
          signalName: row.signalName,
          dataType: row.dataType,
          remark: row.remark,
          isDuplicate: false,
          rowId: row.id,
          ioType: 'receive',
        });
      }
    }
  }

  rows.sort((a, b) => naturalCompare(a.mainSystemAddress, b.mainSystemAddress));

  const freq = new Map<string, number>();
  for (const row of rows) freq.set(row.mainSystemAddress, (freq.get(row.mainSystemAddress) ?? 0) + 1);
  for (const row of rows) row.isDuplicate = (freq.get(row.mainSystemAddress) ?? 0) > 1;

  return rows;
}
