// Types TypeScript miroir des structs Rust serialisees
// Source de verite cote frontend pour les types IPC

export interface ConfigData {
  version?: string;
  projects: Record<string, Project>;
  presets: Record<string, Preset>;
  layouts: Record<string, Layout>;
}

export interface Project {
  name: string;
  path: string;
  color?: string;
  icon?: string;
  default_command?: string;
  initial_command?: string | null;
}

export interface Preset {
  name: string;
  description?: string;
  layout: string;
  panels: Panel[];
}

export interface Panel {
  project?: string;
  command?: string;
}

export interface Layout {
  splits: string[];
}

// === Terminal IPC types (P16 — conpty-engine) ===

export type TerminalStatus = 'running' | 'exited' | 'error';

export interface TerminalInfo {
  id: string;
  shell: string;
  cwd: string | null;
  cols: number;
  rows: number;
  status: TerminalStatus;
}

// Command params
export interface CreateTerminalParams {
  shell?: string;
  cwd?: string;
  cols: number;
  rows: number;
}

export interface CreateTerminalResult {
  id: string;
}

export interface WriteTerminalParams {
  id: string;
  data: string;
}

export interface ResizeTerminalParams {
  id: string;
  cols: number;
  rows: number;
}

export interface CloseTerminalParams {
  id: string;
}

// Event payloads
export interface TerminalOutputEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number;
}

export interface TerminalErrorEvent {
  id: string;
  error: string;
}
