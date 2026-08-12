export type StepType = 'launch' | 'cmd' | 'key' | 'sound' | 'obs';

export type ObsAction =
  | 'scene'
  | 'mic-mute'
  | 'mic-unmute'
  | 'mic-toggle'
  | 'start-record'
  | 'stop-record'
  | 'start-stream'
  | 'stop-stream';

export interface PresetStep {
  type: StepType;
  target?: string;
  processName?: string;
  monitor?: number;
  fullscreen?: boolean;
  command?: string;
  key?: string;
  path?: string;
  action?: ObsAction;
  sceneName?: string;
  inputName?: string;
}

export interface Sound {
  id: string;
  name: string;
  path: string | null;
  keybind: string | null;
}

export interface Preset {
  id: string;
  name: string;
  kind?: 'folder' | 'launcher' | 'fs-folder';
  path?: string;
  icon?: string;
  parentId?: string | null;
  pinned?: boolean;
  steps?: PresetStep[];
  triggerProcess?: string | null;
}

export interface Monitor {
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface Program {
  name: string;
  target: string;
  processName?: string;
  source: 'App' | 'Steam' | 'Epic';
  category?: 'game' | 'app';
}

export interface StepResult {
  step?: string;
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}
