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
