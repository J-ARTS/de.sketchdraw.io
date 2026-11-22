import { ref, type Ref } from 'vue';
import type { AgentSkillBridge, AgentSkillClientId, AgentSkillStatus } from '@/domain';
import { getDesktopBridge } from '@/platform';

/**
 * Where the skill of the app stands in the skill folders of the agents, and the actions on it (#265). `status` stays
 * null in the browser, where there is nothing to set up, so a view shows its section only when it has a value.
 */
export function useAgentSkill(bridge: AgentSkillBridge | undefined = getDesktopBridge().agentSkill): {
  status: Ref<AgentSkillStatus | null>;
  /** Reads the status again, for example when a dialog opens: the folders may have changed outside the app. */
  refresh(): void;
  setAutomatic(enabled: boolean): void;
  replace(client: AgentSkillClientId): void;
} {
  const status = ref<AgentSkillStatus | null>(null);
  // A failed call leaves the last known status in place.
  const take = (answer: Promise<AgentSkillStatus> | undefined): void => {
    void answer?.then((value) => { status.value = value; }).catch(() => undefined);
  };
  take(bridge?.getStatus());
  return {
    status,
    refresh: () => take(bridge?.getStatus()),
    setAutomatic: (enabled) => take(bridge?.setAutomatic(enabled)),
    replace: (client) => take(bridge?.replace(client)),
  };
}
