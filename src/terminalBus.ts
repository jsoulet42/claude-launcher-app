import { listen } from '@tauri-apps/api/event';
import type {
  TerminalOutputEvent,
  TerminalExitEvent,
  TerminalErrorEvent,
} from './types/ipc';

// Bus d'événements terminal — un SEUL listener Tauri par type d'événement,
// routé vers le handler du terminal concerné via une Map.
//
// Avant : chaque composant Terminal enregistrait 3 listeners Tauri qui
// recevaient les événements de TOUS les terminaux et filtraient par id.
// Coût O(terminaux × débit), et la résolution asynchrone de listen() au
// montage perdait les premiers chunks de sortie.
//
// Les listeners globaux (status, activité) restent dans App.tsx — ils sont
// uniques et indépendants du cycle de vie des composants Terminal.

export interface TerminalHandlers {
  onOutput: (e: TerminalOutputEvent) => void;
  onExit: (e: TerminalExitEvent) => void;
  onError: (e: TerminalErrorEvent) => void;
}

const handlers = new Map<string, TerminalHandlers>();

// Les listeners sont enregistrés au chargement du module (avant tout
// create_terminal possible) — aucune fenêtre de perte d'événement.
listen<TerminalOutputEvent>('terminal:output', (e) => {
  handlers.get(e.payload.id)?.onOutput(e.payload);
});
listen<TerminalExitEvent>('terminal:exit', (e) => {
  handlers.get(e.payload.id)?.onExit(e.payload);
});
listen<TerminalErrorEvent>('terminal:error', (e) => {
  handlers.get(e.payload.id)?.onError(e.payload);
});

export function registerTerminalHandlers(
  terminalId: string,
  h: TerminalHandlers
): () => void {
  handlers.set(terminalId, h);
  return () => {
    // Ne désenregistre que si le handler n'a pas été remplacé entre-temps
    // (remount React : le nouveau register peut précéder l'ancien cleanup).
    if (handlers.get(terminalId) === h) {
      handlers.delete(terminalId);
    }
  };
}
