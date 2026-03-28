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
