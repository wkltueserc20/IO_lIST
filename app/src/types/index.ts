export type ConnectionStatus = 'idle' | 'testing' | 'online' | 'ip-only' | 'offline';

export type PlcBrand = 'KEYENCE_KV' | 'Mitsubishi_3E' | null;

export interface PlcValue { value: string; ts: number; error?: string; }

export type MainSystemBrand =
  | 'KEYENCE'
  | 'Mitsubishi'
  | 'Siemens'
  | 'Omron'
  | 'Modbus'
  | 'Custom';

export interface IORow {
  id: string;
  deviceAddress: string;
  signalName: string;
  dataType: string;
  mainSystemAddress: string;
  remark: string;
}

export interface Device {
  id: string;
  name: string;
  ip?: string;
  port?: string;
  plcBrand?: PlcBrand;
  sendIO: IORow[];
  receiveIO: IORow[];
}

export interface ProjectData {
  project: string;
  mainSystem: MainSystemBrand;
  dataTypes: string[];
  devices: Device[];
}

export interface MainSystemRow {
  mainSystemAddress: string;
  direction: 'recv' | 'send';
  deviceId: string;
  deviceName: string;
  deviceAddress: string;
  signalName: string;
  dataType: string;
  remark: string;
  isDuplicate: boolean;
  rowId: string;
  ioType: 'send' | 'receive';
}
