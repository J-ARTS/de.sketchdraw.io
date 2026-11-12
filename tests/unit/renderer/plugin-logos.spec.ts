import { describe, expect, it } from 'vitest';
import { logosById, pluginLogoUrl } from '@/renderer/lib/plugin-logos';

describe('plugin logos', () => {
  it('maps official logo files by plugin id and prefers SVG over PNG', () => {
    const logos = logosById({
      '../assets/plugin-logos/jira.png': '/assets/jira-1.png',
      '../assets/plugin-logos/git.svg': '/assets/git-1.svg',
      '../assets/plugin-logos/git.png': '/assets/git-1.png',
      '../assets/plugin-logos/README.md': '/assets/readme.md',
      '../assets/plugin-logos/Not Valid.svg': '/assets/x.svg',
    });
    expect(Object.fromEntries(logos)).toEqual({ git: '/assets/git-1.svg', jira: '/assets/jira-1.png' });
  });

  it('ships no third-party artwork: without a file the tile keeps its letter', () => {
    expect(pluginLogoUrl('unknown-plugin')).toBeNull();
  });
});
