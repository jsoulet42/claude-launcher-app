import type { Terminal } from '@xterm/xterm';

// Global registry mapping terminalId → xterm instance
// Used by useHotkeys to call term.focus() after keyboard navigation
export const terminalRefs = new Map<string, Terminal>();
