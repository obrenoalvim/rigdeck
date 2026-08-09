export type StepType = 'launch' | 'cmd' | 'key';

export interface PresetStep {
  type: StepType;
  target?: string;
  processName?: string;
  monitor?: number;
  fullscreen?: boolean;
  command?: string;
  key?: string;
}

export interface Preset {
  id: string;
  name: string;
  kind?: 'folder' | 'launcher';
  parentId?: string | null;
  pinned?: boolean;
  steps?: PresetStep[];
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
