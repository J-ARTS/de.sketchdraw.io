import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import { APP_DISPLAY_NAME } from './branding';
import type { AgentSkillService } from './agent-skill-service';

/**
 * The one question about the agent skill (#265): the folders belong to other programs, so the app asks before it
 * writes into them. It asks once, in the installed app, and only when at least one of the agents is on this computer.
 * Either answer is remembered; the settings change it later.
 */
export interface AgentSkillQuestionOptions {
  service: Pick<AgentSkillService, 'shouldAsk' | 'status' | 'setAutomatic'>;
  showMessage(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  text(german: string, params?: Readonly<Record<string, string>>): string;
}

export async function askForAgentSkill(options: AgentSkillQuestionOptions): Promise<'asked' | 'skipped'> {
  const { service, text } = options;
  if (!(await service.shouldAsk())) return 'skipped';
  const folders = (await service.status()).clients.filter((client) => client.state !== 'absent').map((client) => `${client.name}: ${client.folder}`).join('\n');
  const answer = await options.showMessage({
    type: 'question',
    title: APP_DISPLAY_NAME,
    message: text('Skill für KI-Agenten einrichten?'),
    detail: `${text('Sketchdraw kann seine Anleitung für KI-Agenten in deren Skill-Ordner legen und bei jedem Update erneuern. Es schreibt nur in den eigenen Ordner „sketchdraw-desktop“:')}\n\n${folders}\n\n${text('In den Einstellungen lässt sich das jederzeit ändern.')}`,
    buttons: [text('Einrichten'), text('Nicht einrichten')],
    defaultId: 0,
    cancelId: 1,
  });
  await service.setAutomatic(answer.response === 0);
  return 'asked';
}
