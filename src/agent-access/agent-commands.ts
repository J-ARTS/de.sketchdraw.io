import { applyCommand, createElement, isConnectorTarget, routeBoundConnector } from '../domain';
import { DomainConflictError, DomainValidationError } from '../domain/errors';
import type { DocumentCommand, ElementKind, SketchDocument, SketchElement, ValidationIssue } from '../domain';

/**
 * Agent-facing leniency for `sketchdraw_apply_commands` (#176). The domain stays the only authority: this module only
 * completes what an agent may leave out when adding elements, and explains a rejection in the domain's own words.
 */
export const MAX_REPORTED_ISSUES = 20;
const CENTERED_KINDS: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'diamond']);

type Box = Pick<SketchElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function completeElement(raw: unknown, path: string, known: Map<string, Box>, issues: ValidationIssue[]): unknown {
  if (!isRecord(raw)) return raw;
  if (typeof raw.id !== 'string' || !raw.id) { issues.push({ path: `${path}.id`, code: 'MISSING_ID', message: 'Every added element needs an "id" you choose, for example "box:api".' }); return raw; }
  if (raw.kind === 'web-embed' && raw.embedUrl === undefined) { issues.push({ path: `${path}.embedUrl`, code: 'MISSING_EMBED_URL', message: 'A web-embed needs "embedUrl".' }); return raw; }
  if (raw.kind === 'image' && raw.assetId === undefined) { issues.push({ path: `${path}.assetId`, code: 'MISSING_ASSET', message: 'An image needs "assetId" of an asset in the document or in this command\'s "assets".' }); return raw; }
  const routed = routeBoundConnector(raw, id => known.get(id));
  if (routed === raw && raw.kind === 'connector' && !Array.isArray(raw.points)) {
    // Bound ends without a route, but nothing to compute it from: say which element is missing instead of "points required".
    for (const side of ['from', 'to'] as const) {
      const end = raw[side];
      if (isRecord(end) && typeof end.elementId === 'string' && !known.has(end.elementId)) issues.push({ path: `${path}.${side}.elementId`, code: 'UNKNOWN_CONNECTOR_TARGET', message: `Cannot attach to "${end.elementId}": no such shape in the document or in this command.` });
    }
    if (issues.some(issue => issue.path.startsWith(`${path}.`))) return raw;
  }
  const style = isRecord(routed.style) ? routed.style : undefined;
  const input = typeof routed.kind === 'string' && CENTERED_KINDS.has(routed.kind) && (routed.style === undefined || (style && style.textAlign === undefined))
    ? { ...routed, style: { ...style, textAlign: 'center' } } : routed;
  try {
    const element = createElement(input.kind as ElementKind, input as Partial<SketchElement>);
    if (element.kind !== 'connector') known.set(element.id, element);
    // The page stays the domain's decision: it uses the command's page or the only page, and refuses to guess otherwise.
    if (raw.pageId === undefined) { const { pageId: _page, ...withoutPage } = element; return withoutPage; }
    return element;
  } catch (error) {
    if (!(error instanceof DomainValidationError)) throw error;
    for (const issue of error.issues) {
      const local = issue.path.replace(/^overrides\.?/, '');
      issues.push({ ...issue, path: local ? `${path}.${local}` : path });
    }
    return raw;
  }
}
function completeCommand(command: unknown, path: string, known: Map<string, Box>, issues: ValidationIssue[]): unknown {
  if (!isRecord(command)) return command;
  if (command.type === 'batch' && Array.isArray(command.commands)) {
    return { ...command, commands: command.commands.map((entry, index) => completeCommand(entry, `${path}commands[${index}].`, known, issues)) };
  }
  if (command.type === 'update' && Array.isArray(command.changes)) {
    // Later lean connectors in a batch choose anchors from the geometry after earlier updates.
    // The domain still validates the complete command and applies all changes atomically.
    for (const change of command.changes) {
      if (!isRecord(change) || typeof change.id !== 'string' || !isRecord(change.patch)) continue;
      const current = known.get(change.id);
      if (!current) continue;
      const next = { ...current };
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
        const value = change.patch[key];
        if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
      }
      known.set(change.id, next);
    }
  }
  if ((command.type === 'add' || command.type === 'add-page') && Array.isArray(command.elements)) {
    // Shapes first, so a connector may name an element that follows it in the same command.
    const elements = [...command.elements];
    const order = [...elements.keys()].sort((a, b) => Number(isRecord(elements[a]) && elements[a].kind === 'connector') - Number(isRecord(elements[b]) && elements[b].kind === 'connector'));
    for (const index of order) elements[index] = completeElement(elements[index], `${path}elements[${index}]`, known, issues);
    return { ...command, elements };
  }
  return command;
}

/**
 * Fills what an agent may omit in `add` commands: rotation, style, default size, structured content of tables and
 * annotations, and the geometry of a connector bound at both ends. Returns issues instead of a command when an
 * element cannot be completed; all other commands pass through unchanged.
 */
export function prepareAgentCommand(command: DocumentCommand, document: SketchDocument): { command: DocumentCommand; issues: ValidationIssue[] } {
  const known = new Map<string, Box>();
  for (const element of document.elements) if (element.kind !== 'connector' && isConnectorTarget(element)) known.set(element.id, element);
  const issues: ValidationIssue[] = [];
  const completed = completeCommand(command, '', known, issues) as DocumentCommand;
  return { command: issues.length ? command : completed, issues: issues.slice(0, MAX_REPORTED_ISSUES) };
}

/** Why the domain refuses `command` on `document`, in its own validation issues; empty when it would be accepted. */
export function explainCommandRejection(document: SketchDocument, command: DocumentCommand): ValidationIssue[] {
  try { applyCommand(document, command); return []; }
  catch (error) {
    if (error instanceof DomainValidationError) return error.issues.slice(0, MAX_REPORTED_ISSUES);
    if (error instanceof DomainConflictError) return [{ path: '', code: error.code, message: error.message }];
    return [];
  }
}

/** One line for the error message; the full list travels in `issues`. */
export function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const first = issues[0];
  if (!first) return 'Change was rejected by the shared document authority.';
  const more = issues.length > 1 ? ` (+${issues.length - 1} more in "issues")` : '';
  return `Command rejected: ${first.path ? `${first.path}: ` : ''}${first.message}${more}`;
}
