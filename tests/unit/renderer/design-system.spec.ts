import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain Node script without type declarations
import { buildManifest } from '../../../scripts/design-system-manifest.mjs';

/**
 * The rules of the design system (docs/design-system/README.md), checked on the files themselves. The project
 * has no linter; these tests are what keeps the structure from eroding.
 */
const RENDERER = 'src/renderer';
const BASE = `${RENDERER}/design-system`;
const LEVELS = ['atoms', 'molecules', 'organisms', 'templates', 'pages'] as const;
/** A level may use the ones before it; composables and the storybook helpers serve all of them. */
const RANK: Record<string, number> = { composables: 0, atoms: 1, molecules: 2, organisms: 3, templates: 4, pages: 5, storybook: 6 };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path.replaceAll('\\', '/')];
  });
}
const files = walk(BASE);
const components = files.filter((file) => file.endsWith('.vue'));
const stories = files.filter((file) => file.endsWith('.stories.ts'));
const read = (file: string): string => readFileSync(file, 'utf8');
const level = (file: string): string => relative(BASE, file).replaceAll('\\', '/').split('/')[0]!;
const name = (file: string): string => file.split('/').pop()!.replace(/\.vue$/, '');
/** The template of a component without comments, where raw HTML primitives would be written. */
const template = (file: string): string => (/<template>([\s\S]*)<\/template>/.exec(read(file))?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '');
const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

describe('design system: structure', () => {
  it('keeps every component of the renderer in one level of the design system', () => {
    const outside = walk(RENDERER).filter((file) => file.endsWith('.vue') && !file.startsWith(`${BASE}/`));
    expect(outside, 'only App.vue lives outside src/renderer/design-system').toEqual([`${RENDERER}/App.vue`]);
    expect(components.filter((file) => !(LEVELS as readonly string[]).includes(level(file)) || relative(BASE, file).split(/[\\/]/).length !== 2)).toEqual([]);
    expect(new Set(components.map(name)).size, 'component names are unique across the levels').toBe(components.length);
  });

  it('exports every component from the index, and nothing that does not exist', () => {
    const index = read(`${BASE}/index.ts`);
    const exported = [...index.matchAll(/export \{ default as (\w+) \} from '\.\/([\w/]+\.vue)';/g)].map((match) => `${BASE}/${match[2]}::${match[1]}`);
    expect(exported.sort()).toEqual(components.map((file) => `${file}::${name(file)}`).sort());
  });

  it('describes every component in its first line', () => {
    expect(components.filter((file) => !/^<!--\s*@component\s+\S[\s\S]*?-->/.test(read(file)))).toEqual([]);
  });

  it('lets a level use only the levels before it', () => {
    const upward: string[] = [];
    for (const file of files.filter((entry) => /\.(vue|ts)$/.test(entry) && entry !== `${BASE}/index.ts`)) {
      const own = RANK[level(file)]!;
      const isStory = file.endsWith('.stories.ts');
      for (const match of read(file).matchAll(/@\/renderer\/design-system\/(\w+)\/[\w.-]+/g)) {
        const target = match[1]!;
        // Stories may show a component in its context and use the storybook helpers; product code may not.
        if (isStory ? false : target === 'storybook' || RANK[target]! > own) upward.push(`${relative(BASE, file)} -> ${match[0]}`);
      }
      if (!isStory && /from '@\/renderer\/design-system'/.test(read(file))) upward.push(`${relative(BASE, file)} imports the index; import the file of the component instead`);
    }
    expect(upward).toEqual([]);
  });

  it('keeps atoms and molecules free of application state', () => {
    const stateful = components.filter((file) => ['atoms', 'molecules'].includes(level(file)) && /use-whiteboard|@\/renderer\/state\//.test(read(file)));
    expect(stateful, 'a component that reads the store is an organism').toEqual([]);
  });
});

describe('design system: catalogue', () => {
  const shown = new Set(stories.flatMap((file) => [...read(file).matchAll(/from '@\/renderer\/design-system\/\w+\/(\w+)\.vue'/g)].map((match) => match[1]!)));

  it('keeps a story file beside what it shows', () => {
    for (const file of stories) {
      const own = level(file);
      const subject = file.replace(/\.stories\.ts$/, '.vue');
      if (existsSync(subject)) continue;
      // A file for several components belongs to the level of the components it is named after.
      expect((LEVELS as readonly string[]).includes(own), file).toBe(true);
    }
  });

  it('shows every atom, molecule, template and page in Storybook', () => {
    const missing = components.filter((file) => level(file) !== 'organisms' && !shown.has(name(file))).map((file) => relative(BASE, file));
    expect(missing).toEqual([]);
  });

  /**
   * Organisms that are not yet in Storybook. They need a document state that a story cannot set up with one
   * call. The list may only shrink: a new organism gets a story, and a story for one of these removes it here.
   */
  const ORGANISMS_WITHOUT_STORY = [
    'AnnotationEditor', 'CommentsLayer', 'CustomComponentsTab', 'FramePreview', 'HdhtSession', 'ImageFileInput', 'LaserPointerOverlay',
    'PresenterMode', 'QuickConnect', 'ResourceCardEditor', 'TableOverlay', 'WebEmbedDialog',
  ];
  it('shows every organism in Storybook, apart from the known rest', () => {
    const missing = components.filter((file) => level(file) === 'organisms' && !shown.has(name(file))).map(name).sort();
    expect(missing).toEqual(ORGANISMS_WITHOUT_STORY);
  });

  it('has an up-to-date manifest for agents', () => {
    const { text, missing } = buildManifest() as { text: string; missing: string[] };
    expect(missing).toEqual([]);
    expect(read('docs/design-system/manifest.md'), 'run: npm run design-system:manifest').toBe(text);
  }, 120_000);
});

describe('design system: primitives', () => {
  const outsideAtoms = components.filter((file) => level(file) !== 'atoms');

  it('uses AppSelect instead of native select and datalist', () => {
    expect(outsideAtoms.filter((file) => /<(select|datalist)[\s>]/.test(template(file)))).toEqual([]);
  });

  /**
   * Hand-written primitives that are older than the atoms. New code uses AppButton, AppIconButton, AppTextField
   * and AppTextarea. The numbers may only go down: lower them when a component is moved to the atoms.
   */
  const RAW_BASELINE = { 'sd-btn': 15, 'sd-icon-btn': 34, 'sd-input': 5, 'sd-textarea': 2 } as const;
  it.each(Object.entries(RAW_BASELINE))('does not add hand-written %s elements', (cls, baseline) => {
    const pattern = new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`, 'g');
    const perFile = outsideAtoms.map((file) => [relative(BASE, file), count(template(file), pattern)] as const).filter(([, found]) => found > 0);
    const total = perFile.reduce((sum, [, found]) => sum + found, 0);
    expect(total, `${cls} outside the atoms: ${perFile.map(([file, found]) => `${file} ${found}`).join(', ')}`).toBe(baseline);
  });
});
