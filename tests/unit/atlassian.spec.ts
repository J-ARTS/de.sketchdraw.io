import { describe, expect, it } from 'vitest';
import { annotationToConfluenceStorage, confluenceStorageToAnnotation, createDocument, deserializeDocument, serializeDocument, validateDocument } from '@/domain';

describe('Atlassian document boundary', () => {
  it('converts Confluence storage markup into safe editable annotation blocks', () => {
    const annotation = confluenceStorageToAnnotation('<h2>Architecture</h2><p>Hello <strong>team</strong></p><script>alert(1)</script>');
    expect(annotation.blocks).toEqual([
      { type: 'heading-2', runs: [{ text: 'Architecture' }] },
      { type: 'paragraph', runs: [{ text: 'Hello team' }] },
    ]);
    expect(annotationToConfluenceStorage(annotation)).toBe('<h2>Architecture</h2><p>Hello team</p>');
  });

  it('round-trips Jira references without allowing credentials in the task contract', () => {
    const document = createDocument('Jira board');
    document.tasks = [{
      id: 'task:jira-1', title: 'Remote task', description: 'Synced', status: 'doing', rank: 0,
      createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:01:00.000Z',
      external: { provider: 'jira', remoteId: '10001', key: 'SK-1', url: 'https://example.atlassian.net/browse/SK-1', remoteStatus: 'In Progress', updatedAt: '2026-10-18T10:01:00.000Z' },
    }];
    const serialized = serializeDocument(validateDocument(document));
    expect(deserializeDocument(serialized).tasks?.[0]?.external?.key).toBe('SK-1');
    expect(serialized).not.toContain('apiToken');
  });
});
