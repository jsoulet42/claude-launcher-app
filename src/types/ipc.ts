// Types TypeScript miroir des structs Rust serialisees
// Source de verite cote frontend pour les types IPC

export interface ConfigData {
  version?: string;
  projects: Record<string, Project>;
  presets: Record<string, Preset>;
  layouts: Record<string, Layout>;
  preferences?: Preferences;
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
  initial_command?: string | null;
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
  created_at: number;
  exit_code: number | null;
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

export interface ClaudeDoneEvent {
  id: string;
  title: string;
  timestamp: number;
  last_message: string | null;
}

// === Session IPC types (P25 — session-restore) ===
// Miroir exact des structs Rust dans src-tauri/src/session.rs

export interface SavedSession {
  version: number;
  saved_at: string;
  active_workspace_index: number;
  workspaces: SavedWorkspace[];
}

export interface SavedWorkspace {
  name: string;
  color: string | null;
  project_slug: string | null;
  layout: SavedLayoutNode;
}

export type SavedLayoutNode =
  | { type: 'terminal'; shell: string; cwd: string | null }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      children: [SavedLayoutNode, SavedLayoutNode];
    };

// === Git IPC types (P19 — git-rust) ===
// Miroir exact des structs Rust dans src-tauri/src/git.rs

export interface GitInfo {
  exists: boolean;
  is_git: boolean;
  branch: string;
  dirty_count: number;
  is_dirty: boolean;
  is_mono_repo: boolean;
  repo_root: string;
  recent_commits: CommitInfo[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  time_ago: string;
}

// === Config preferences ===

export interface CustomThemeColors {
  bg_primary: string;
  bg_secondary: string;
  bg_surface: string;
  text_primary: string;
  accent: string;
}

export interface Preferences {
  theme?: string;
  custom_theme?: CustomThemeColors;
  default_preset?: string;
  scan_directories?: string[];
  auto_discover_projects?: boolean;
  daemon?: DaemonPrefs;
  onboarding_completed?: boolean;
}

export interface DaemonPrefs {
  enabled?: boolean;
  watch_interval_ms?: number;
  notify_on_wait?: boolean;
}

// === Validation IPC types (P27 — config-wizard) ===
// Miroir exact des structs Rust dans src-tauri/src/config.rs
// Note: ValidationLevel Rust n'a pas de rename_all → PascalCase

export type ValidationLevel = 'Error' | 'Warning';

export interface ValidationMessage {
  level: ValidationLevel;
  path: string;
  message: string;
}

// === Scanner IPC types (P20 — scanner-rust) ===
// Miroir exact des structs Rust dans src-tauri/src/scanner.rs

export type StackType =
  | 'dolibarr-module' | 'php' | 'node' | 'go'
  | 'rust' | 'dotnet' | 'python' | 'powershell' | 'unknown';

// Noms snake_case — pas de rename_all sur le struct Rust ScanOptions
export interface ScanOptions {
  directories: string[];
  max_depth?: number;
  existing_paths: string[];
}


export interface ScannedProject {
  slug: string;
  name: string;
  path: string;
  color: string;
  default_command: string;
  source: string;
  stack_type: StackType;
  git_branch: string;
  icon: string;
}

// === History IPC types (P26 — history-engine) ===
// Miroir exact des structs Rust dans src-tauri/src/history.rs

export interface HistoryEntry {
  timestamp: string;
  preset: string;
  projects: string[];
  branches: Record<string, string>;
  layout: string;
}

export interface ScoreBreakdown {
  frequency: number;
  recency: number;
  time_of_day: number;
  git_context: number;
}

export interface PresetSuggestion {
  slug: string;
  score: number;
  breakdown: ScoreBreakdown;
  reason: string;
  is_suggested: boolean;
}
