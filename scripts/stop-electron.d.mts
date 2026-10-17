import type { ElectronApplication } from '@playwright/test';

export interface ElectronStopResult {
  pid: number;
  platform: NodeJS.Platform;
  steps: string[];
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}


/** Stop an owned test application before deleting its profile or fixture directory. */
export function stopElectron(app: ElectronApplication): Promise<ElectronStopResult>;
