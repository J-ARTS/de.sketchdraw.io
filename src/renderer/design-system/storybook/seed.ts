import type { WhiteboardStore } from '@/renderer/state/contract';
import { diagramTemplate } from '@/renderer/lib/diagram-libraries';

/** Puts a diagram from the libraries on the page of a story's store and selects it. */
export async function seedDiagram(store: WhiteboardStore, templateId = 'sequence.example'): Promise<void> {
  await store.insertElements(diagramTemplate(templateId)!.build(), { x: 420, y: 260 });
}

/** A few tasks in different states for the task views. */
export async function seedTasks(store: WhiteboardStore): Promise<void> {
  await store.createTask({ title: 'Zahlungsdienst an die Bank anbinden', description: 'Autorisierung und Rückmeldung an den Shop.', status: 'doing', assignee: 'Mira', dueDate: '2026-11-20' });
  await store.createTask({ title: 'Lasttest für den Checkout', status: 'todo', assignee: 'Jonas' });
  await store.createTask({ title: 'Architekturdiagramm abnehmen', status: 'review' });
  await store.createTask({ title: 'Sequenzdiagramm für den Login', status: 'done' });
}
