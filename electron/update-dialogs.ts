import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import type { UpdateProblem, UpdateStatus } from '../src/domain/updates';
import { APP_DISPLAY_NAME } from './branding';
import type { UpdateService } from './update-service';

/** The native questions of the updater (#237): offer a version, confirm "up to date", explain a failure. */
export interface UpdatePromptOptions {
  service(): Pick<UpdateService, 'check' | 'install' | 'dismissAvailable' | 'shouldPrompt'> | null;
  showMessage(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  openReleasePage(): void;
  text(german: string, params?: Readonly<Record<string, string>>): string;
}

const PROBLEM_TEXT: Readonly<Record<UpdateProblem, string>> = {
  network: 'GitHub war nicht erreichbar. Versuche es später noch einmal.',
  release: 'Das neueste Release ließ sich nicht lesen.',
  checksum: 'Die geladene Datei passt nicht zur Prüfsumme des Releases und wurde verworfen.',
  install: 'Die neue Version ließ sich nicht installieren. Auf der Release-Seite kannst du sie von Hand laden.',
  cancelled: 'Die Installation wurde abgebrochen.',
};

export function createUpdatePrompts(options: UpdatePromptOptions): {
  /** "Check for updates…": always answers, also when there is nothing new. */
  checkFromMenu(): Promise<void>;
  /** The result of an automatic check: only an available version, or an installation that failed after the last quit, speaks up. */
  onAutomaticCheck(status: UpdateStatus): void;
} {
  const { text, showMessage } = options;

  async function showProblem(problem: UpdateProblem): Promise<void> {
    const offersPage = problem === 'install' || problem === 'checksum';
    const answer = await showMessage({
      type: 'warning',
      title: APP_DISPLAY_NAME,
      message: text('Das Update ist fehlgeschlagen'),
      detail: text(PROBLEM_TEXT[problem]),
      buttons: offersPage ? [text('Release-Seite öffnen'), text('Schließen')] : [text('Schließen')],
      defaultId: 0,
      cancelId: offersPage ? 1 : 0,
    });
    if (offersPage && answer.response === 0) options.openReleasePage();
  }

  /** Asks whether the available version should be installed now. "Later" is remembered when the start asked. */
  async function offer(status: UpdateStatus, askedByStart: boolean): Promise<void> {
    const service = options.service();
    if (!service) return;
    const detail = status.canInstall
      ? 'Installiert ist Version {current}. Sketchdraw lädt die neue Version, prüft sie gegen die Prüfsumme des Releases und startet danach neu.'
      : 'Installiert ist Version {current}. Diese Installation kann sich nicht selbst ersetzen; die neue Version liegt auf der Release-Seite.';
    const answer = await showMessage({
      type: 'info',
      title: APP_DISPLAY_NAME,
      message: text('Sketchdraw {version} ist verfügbar', { version: status.latestVersion ?? '' }),
      detail: text(detail, { current: status.currentVersion }),
      buttons: status.canInstall
        ? [text('Jetzt aktualisieren'), text('Später'), text('Versionshinweise')]
        : [text('Release-Seite öffnen'), text('Später')],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 1) {
      if (askedByStart) await service.dismissAvailable();
      return;
    }
    if (answer.response === 2 || !status.canInstall) {
      options.openReleasePage();
      return;
    }
    const result = await service.install();
    if (result.phase === 'error' && result.problem) await showProblem(result.problem);
  }

  return {
    async checkFromMenu(): Promise<void> {
      const service = options.service();
      if (!service) return;
      const status = await service.check({ manual: true });
      if (status.phase === 'available') await offer(status, false);
      else if (status.phase === 'current') {
        await showMessage({
          type: 'info',
          title: APP_DISPLAY_NAME,
          message: text('Sketchdraw ist aktuell'),
          // A start from the sources can be ahead of the newest release; it only says that nothing newer is published.
          detail: status.supported
            ? text('Version {current} ist die neueste veröffentlichte Version.', { current: status.currentVersion })
            : text('Diese Kopie wurde aus den Quellen gestartet (Version {current}). Es gibt keine neuere veröffentlichte Version.', { current: status.currentVersion }),
          buttons: [text('Schließen')],
        });
      } else if (status.phase === 'error' && status.problem) await showProblem(status.problem);
      else if (!status.supported) {
        // No readable version of its own: nothing to compare with, the release page still shows what is published.
        const answer = await showMessage({
          type: 'info',
          title: APP_DISPLAY_NAME,
          message: text('Diese Kopie kann nicht nach Updates suchen'),
          detail: text('Updates gibt es für die installierte App. Die neueste Version liegt auf der Release-Seite.'),
          buttons: [text('Release-Seite öffnen'), text('Schließen')],
          defaultId: 0,
          cancelId: 1,
        });
        if (answer.response === 0) options.openReleasePage();
      }
    },

    onAutomaticCheck(status: UpdateStatus): void {
      if (status.phase === 'error' && status.problem === 'install') void showProblem('install');
      else if (options.service()?.shouldPrompt()) void offer(status, true);
    },
  };
}
