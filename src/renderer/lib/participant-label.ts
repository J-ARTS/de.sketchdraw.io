import type { SessionParticipant } from '@/collaboration/presence';
import { t } from '@/renderer/i18n';

/** The name of a person in a session as it is shown everywhere: the chosen one, otherwise a neutral label. */
export function participantLabel(person: Pick<SessionParticipant, 'name' | 'role' | 'number'>): string {
  return person.name || (person.role === 'owner' ? t('Gastgeber') : t('Gast {number}', { number: person.number }));
}
