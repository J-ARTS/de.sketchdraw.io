import { intlLocale, t } from '@/renderer/i18n';

export type ConfluenceLiveState = 'off' | 'paused' | 'pending' | 'syncing' | 'synced' | 'retrying' | 'error';

/** What the automatic publication of a linked diagram page is doing. */
export interface ConfluenceLiveStatus {
  state: ConfluenceLiveState;
  message: string;
  /** Time of the last publication Confluence confirmed. */
  syncedAt?: string;
  /** The server asked for a pause; nothing is sent before this moment. */
  retryAt?: string;
}

/** What a publication is doing, in one sentence; the message of the publication itself wins when there is one. */
/** `wiki` says where the page goes: Confluence (default) or the wiki of Azure DevOps (#284). */
export function confluenceLiveStatusText(status: ConfluenceLiveStatus, wiki: 'confluence' | 'azure-devops' = 'confluence'): string {
  const azure = wiki === 'azure-devops';
  if (status.message) return status.message;
  switch (status.state) {
    case 'off': return t('Noch nicht übertragen.');
    case 'paused': return t('Übertragung pausiert.');
    case 'pending': return azure ? t('Änderungen werden gleich ins Wiki übertragen.') : t('Änderungen werden gleich nach Confluence übertragen.');
    case 'syncing': return azure ? t('Diagramm wird ins Wiki übertragen …') : t('Diagramm wird nach Confluence übertragen …');
    case 'synced': return azure ? t('Das Wiki ist auf dem aktuellen Stand.') : t('Confluence ist auf dem aktuellen Stand.');
    case 'retrying': return t('Übertragung wird wiederholt.');
    case 'error': return t('Übertragung fehlgeschlagen.');
  }
}

/** A moment as the app language writes it, or an empty text for a missing or unreadable one. */
export function confluenceLiveTime(value: string | undefined): string {
  const time = value ? new Date(value) : null;
  return time && !Number.isNaN(time.getTime()) ? time.toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
