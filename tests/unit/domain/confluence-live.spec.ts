import { describe, expect, it } from 'vitest';
import {
  confluenceLiveFilePrefix, confluenceLiveFilename, confluenceStorageLoss, isPngImage, managedImageFilenames, planManagedImages,
  annotationToConfluenceStorage, confluenceStorageToAnnotation,
} from '@/domain';

const KEY = 'a1b2c3d4e5f6';
const PREFIX = confluenceLiveFilePrefix(KEY);
const file = (page: string) => confluenceLiveFilename(KEY, page.padEnd(12, '0'));
const image = (page: string, alt = 'Diagramm') => ({ filename: file(page), alt, width: 800 });

/** Rich content of other people: formatting, a link, a numbered list, a table, a macro with CDATA and a foreign image. */
const FOREIGN = '<h2>Architektur</h2><p>Text <strong>fett</strong> und <a href="https://example.com/docs?a=1&amp;b=2">Doku</a>.</p>'
  + '<ol><li><p>Erster Schritt</p></li><li><p>Zweiter Schritt</p></li></ol>'
  + '<table><tbody><tr><th><p>Feld</p></th><td><p>Wert</p></td></tr></tbody></table>'
  + '<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:plain-text-body><![CDATA[<ac:image><ri:attachment ri:filename="sketchdraw-a1b2c3d4e5f6-ffffffffffff.png" /></ac:image> if (a < b) {}]]></ac:plain-text-body></ac:structured-macro>'
  + '<ac:image ac:align="center"><ri:attachment ri:filename="team-photo.png" ri:version-at-save="3" /></ac:image>';

describe('managed diagram images of a Confluence page (#210)', () => {
  it('appends the images of all diagram pages and leaves every foreign character untouched', () => {
    const plan = planManagedImages(FOREIGN, PREFIX, [image('1', 'Plattform – Übersicht'), image('2', 'Plattform – "Netz" & <Zonen>')]);
    expect(plan.status).toBe('changed');
    if (plan.status !== 'changed') return;
    expect(plan.body.startsWith(FOREIGN)).toBe(true);
    expect(plan.added).toEqual([file('1'), file('2')]);
    expect(plan.removed).toEqual([]);
    const section = plan.body.slice(FOREIGN.length);
    expect(section).toBe(
      `<ac:image ac:align="center" ac:layout="center" ac:alt="Plattform – Übersicht" ac:width="800"><ri:attachment ri:filename="${file('1')}" /></ac:image>`
      + `<ac:image ac:align="center" ac:layout="center" ac:alt="Plattform – &quot;Netz&quot; &amp; &lt;Zonen&gt;" ac:width="800"><ri:attachment ri:filename="${file('2')}" /></ac:image>`,
    );
    // The look-alike inside the code macro is text of the page, not an image of ours.
    expect(managedImageFilenames(plan.body, PREFIX)).toEqual([file('1'), file('2')]);
  });

  it('changes nothing once the page shows the diagram, wherever the images were moved and however they were resized', () => {
    const moved = `<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><ac:image ac:width="320" ac:original-width="1600"><ri:attachment ri:filename="${file('2')}" ri:version-at-save="7" /><ac:caption><p>Netz</p></ac:caption></ac:image></ac:layout-cell>`
      + `<ac:layout-cell><p>Notiz</p><ac:image><ri:attachment ri:filename="${file('1')}"></ri:attachment></ac:image></ac:layout-cell></ac:layout-section></ac:layout>`;
    expect(planManagedImages(moved, PREFIX, [image('1'), image('2')])).toEqual({ status: 'unchanged' });
    expect(managedImageFilenames(moved, PREFIX)).toEqual([file('2'), file('1')]);
  });

  it('inserts a new diagram page next to its neighbour and removes the image of a deleted page only', () => {
    const first = `<ac:image ac:width="640"><ri:attachment ri:filename="${file('1')}" /></ac:image>`;
    const third = `<ac:image><ri:attachment ri:filename="${file('3')}" /></ac:image>`;
    const body = `<p>Vorher</p>${first}<p>Dazwischen</p>${third}<p>Nachher</p>`;
    const plan = planManagedImages(body, PREFIX, [image('0'), image('1'), image('2')]);
    expect(plan.status).toBe('changed');
    if (plan.status !== 'changed') return;
    const markup = (page: string) => `<ac:image ac:align="center" ac:layout="center" ac:alt="Diagramm" ac:width="800"><ri:attachment ri:filename="${file(page)}" /></ac:image>`;
    expect(plan.body).toBe(`<p>Vorher</p>${markup('0')}${first}${markup('2')}<p>Dazwischen</p><p>Nachher</p>`);
    expect(plan.added).toEqual([file('0'), file('2')]);
    expect(plan.removed).toEqual([file('3')]);
  });

  it('never touches images of another diagram or foreign attachments', () => {
    const other = confluenceLiveFilename('ffffffffffff', '111111111111');
    const body = `<ac:image><ri:attachment ri:filename="${other}" /></ac:image><p><ac:link><ri:attachment ri:filename="${file('9')}" /></ac:link></p>`;
    const plan = planManagedImages(body, PREFIX, [image('1')]);
    expect(plan.status).toBe('changed');
    if (plan.status !== 'changed') return;
    expect(plan.body.startsWith(body)).toBe(true);
    expect(plan.removed).toEqual([]);
  });

  it('refuses to plan a change for markup it cannot read without doubt', () => {
    for (const broken of ['<p>offen', '<p>a</div>', '<p>1 < 2</p>', '<p title="a<b">x</p>', '<p title=x>y</p>', '<!-- offen', '<![CDATA[ offen', '</p>']) {
      expect(planManagedImages(broken, PREFIX, [image('1')]), broken).toEqual({ status: 'unsafe' });
      expect(managedImageFilenames(broken, PREFIX), broken).toBeNull();
    }
    expect(planManagedImages('', PREFIX, [image('1')]).status).toBe('changed');
  });

  it('accepts only its own safe file names and real PNG data', () => {
    expect(() => planManagedImages('', PREFIX, [{ filename: 'team-photo.png', alt: '', width: 1 }])).toThrow();
    expect(() => planManagedImages('', 'sketchdraw-', [])).toThrow();
    expect(() => confluenceLiveFilename(KEY, '../etc')).toThrow();
    // The same page twice would insert the same image twice.
    expect(() => planManagedImages('', PREFIX, [image('1'), image('1')])).toThrow('Duplicate');
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const header = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0, 0, 0, 0];
    const data = [0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0, 0];
    const end = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    expect(isPngImage(new Uint8Array([...signature, ...header, ...data, ...end]))).toBe(true);
    // A signature alone, a missing header or end, an empty size and other formats are not pictures.
    expect(isPngImage(new Uint8Array([...signature, 0]))).toBe(false);
    expect(isPngImage(new Uint8Array([...signature, ...new TextEncoder().encode('<script>alert(1)</script>'.repeat(3))]))).toBe(false);
    expect(isPngImage(new Uint8Array([...signature, ...header, ...data]))).toBe(false);
    expect(isPngImage(new Uint8Array([...signature, ...header.map((value, index) => index >= 8 && index < 12 ? 0 : value), ...data, ...end]))).toBe(false);
    expect(isPngImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBe(false);
  });
});

describe('ownership of images on the page (#210 review)', () => {
  const own = file('1');
  const elsewhere = (name: string, extra = '') => `<ac:image ac:width="340"${extra}><ri:attachment ri:filename="${name}"><ri:page ri:content-title="External architecture" ri:space-key="DOC" /></ri:attachment></ac:image>`;

  it('treats an attachment of another page with the same file name as foreign: never removed, never counted as shown', () => {
    const body = `<p>Before</p>${elsewhere(own)}<p>After</p>`;
    // The diagram has no page for this name any more: the foreign image stays.
    expect(planManagedImages(body, PREFIX, [])).toEqual({ status: 'unchanged' });
    expect(managedImageFilenames(body, PREFIX)).toEqual([]);
    // The diagram has this page: the image on this page is still missing and is added; the foreign one is untouched.
    const plan = planManagedImages(body, PREFIX, [image('1')]);
    expect(plan.status).toBe('changed');
    if (plan.status !== 'changed') return;
    expect(plan.body.startsWith(body)).toBe(true);
    expect(plan.added).toEqual([own]);
    expect(plan.removed).toEqual([]);
    expect(managedImageFilenames(plan.body, PREFIX)).toEqual([own]);
    // Blog posts, other content and spaces are containers as well.
    for (const container of ['<ri:blog-post ri:content-title="Post" ri:posting-day="2026/11/15" />', '<ri:content-entity ri:content-id="42" />', '<ri:space ri:space-key="OTHER" />', '<unknown-container />']) {
      const other = `<ac:image><ri:attachment ri:filename="${own}">${container}</ri:attachment></ac:image>`;
      expect(planManagedImages(other, PREFIX, []), container).toEqual({ status: 'unchanged' });
    }
  });

  it('recognises its own file name behind XML character references and leaves that markup exactly as it is', () => {
    const dash = own.replace('sketchdraw-', 'sketchdraw&#45;');
    const letter = own.replace(/\.png$/, '&#x2e;&#112;ng');
    for (const encoded of [dash, letter]) {
      const body = `<p>Before</p><ac:image ac:width="340"><ri:attachment ri:filename="${encoded}" /></ac:image><p>After</p>`;
      // Already shown: no duplicate, no move, the given width stays.
      expect(planManagedImages(body, PREFIX, [image('1')]), encoded).toEqual({ status: 'unchanged' });
      expect(managedImageFilenames(body, PREFIX), encoded).toEqual([own]);
      // A neighbour is inserted next to it; the encoded image is not rewritten.
      const plan = planManagedImages(body, PREFIX, [image('1'), image('2')]);
      expect(plan.status).toBe('changed');
      if (plan.status !== 'changed') return;
      expect(plan.body).toContain(`<ac:image ac:width="340"><ri:attachment ri:filename="${encoded}" /></ac:image><ac:image ac:align="center"`);
      expect(plan.added).toEqual([file('2')]);
      // The page of the diagram is gone: the image is ours and is removed, whatever its spelling.
      expect(planManagedImages(body, PREFIX, []), encoded).toEqual({ status: 'changed', body: '<p>Before</p><p>After</p>', added: [], removed: [own] });
    }
    // An escaped ampersand is text, not a reference: this name is somebody else's.
    const literal = `<ac:image><ri:attachment ri:filename="${own.replace('sketchdraw-', 'sketchdraw&amp;#45;')}" /></ac:image>`;
    expect(planManagedImages(literal, PREFIX, [])).toEqual({ status: 'unchanged' });
  });

  it('decides nothing when a file name or its ownership cannot be read with certainty', () => {
    const uncertain = [
      // An entity this scanner cannot resolve, a broken or impossible character reference, a bare ampersand.
      `<ac:image><ri:attachment ri:filename="sketchdraw&hyphen;${KEY}-${'1'.padEnd(12, '0')}.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="sketchdraw&#x;${KEY}.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="sketchdraw&#0;.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="sketchdraw&#xD800;.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="a & b.png" /></ac:image>`,
      // The same attribute twice: which value counts is undefined.
      `<ac:image><ri:attachment ri:filename="foreign.png" ri:filename="${own}" /></ac:image>`,
    ];
    for (const body of uncertain) {
      expect(planManagedImages(body, PREFIX, [image('2')]), body).toEqual({ status: 'unsafe' });
      expect(planManagedImages(body, PREFIX, []), body).toEqual({ status: 'unsafe' });
      expect(managedImageFilenames(body, PREFIX), body).toBeNull();
    }
  });

  it('does not own an image with more than one source, or a name that only starts like its own', () => {
    const foreign = [
      `<ac:image><ri:attachment ri:filename="${own}" /><ri:url ri:value="https://example.com/foreign.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="${own}" /><ri:attachment ri:filename="${file('2')}" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="${PREFIX}notes.png" /></ac:image>`,
      `<ac:image><ri:attachment ri:filename="${own}.bak" /></ac:image>`,
    ];
    for (const body of foreign) {
      expect(planManagedImages(body, PREFIX, []), body).toEqual({ status: 'unchanged' });
      const plan = planManagedImages(body, PREFIX, [image('1')]);
      expect(plan.status, body).toBe('changed');
      if (plan.status === 'changed') { expect(plan.body.startsWith(body), body).toBe(true); expect(plan.removed, body).toEqual([]); }
    }
    // A caption or other non-source content inside the image does not change whose it is.
    expect(planManagedImages(`<ac:image><ri:attachment ri:filename="${own}" /><ac:caption><p>Netz</p></ac:caption></ac:image>`, PREFIX, [image('1')])).toEqual({ status: 'unchanged' });
  });

  it('keeps images where people put them: another page order in the diagram moves nothing, and a copy stays', () => {
    const a = `<ac:image><ri:attachment ri:filename="${file('1')}" /></ac:image>`; const b = `<ac:image><ri:attachment ri:filename="${file('2')}" /></ac:image>`;
    expect(planManagedImages(`${a}<p>Text</p>${b}`, PREFIX, [image('2'), image('1')])).toEqual({ status: 'unchanged' });
    expect(planManagedImages(`<p>${a}</p><p>Text</p><p>${a}</p>`, PREFIX, [image('1')])).toEqual({ status: 'unchanged' });
  });
});

describe('loss guard for sending an annotation back to a page (#209, #210)', () => {
  it('names what the annotation model would remove from a rich page', () => {
    const loss = confluenceStorageLoss(FOREIGN);
    expect(loss).toEqual(expect.arrayContaining(['formatting', 'links', 'numbered-lists', 'tables', 'media-and-macros']));
    // The probe of #208: exactly this page loses bold text, the link target, the numbering and the table.
    const probe = '<h2>Confluence codec probe 208</h2><p>Text <strong>fett</strong> und <a href="https://example.com/docs">Dokumentation</a>.</p><ol><li>Erster Schritt</li><li>Zweiter Schritt</li></ol><table><tbody><tr><th><p>Feld</p></th><th><p>Wert</p></th></tr><tr><td><p>Status</p></td><td><p>Offen</p></td></tr></tbody></table>';
    expect(confluenceStorageLoss(probe).sort()).toEqual(['formatting', 'links', 'numbered-lists', 'tables']);
    expect(annotationToConfluenceStorage(confluenceStorageToAnnotation(probe))).not.toContain('<strong>');
  });

  it('lets a page pass that the annotation model keeps completely', () => {
    expect(confluenceStorageLoss('')).toEqual([]);
    expect(confluenceStorageLoss('<h2 local-id="a1">Titel</h2><p>Ein Absatz &amp; mehr.</p><ul><li><p>Punkt eins</p></li><li>Punkt zwei</li></ul><blockquote><p>Zitat</p></blockquote>')).toEqual([]);
  });

  it('detects the quiet losses: managed diagram images, styles, unknown characters, nested and loose content', () => {
    expect(confluenceStorageLoss(`<p>Text</p><ac:image><ri:attachment ri:filename="${file('1')}" /></ac:image>`)).toContain('media-and-macros');
    expect(confluenceStorageLoss('<p style="text-align: center;">Mitte</p>')).toContain('formatting');
    expect(confluenceStorageLoss('<p>A<br />B</p>')).toContain('formatting');
    expect(confluenceStorageLoss('<p>Gr&uuml;&szlig;e &ndash; hier</p>')).toContain('characters');
    expect(confluenceStorageLoss('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')).toContain('structure');
    expect(confluenceStorageLoss('<blockquote><p>eins</p><p>zwei</p></blockquote>')).toContain('structure');
    expect(confluenceStorageLoss('<p>im Absatz</p>lose Zeile')).toContain('structure');
    expect(confluenceStorageLoss('<p>a</p><!-- Kommentar -->')).toContain('structure');
  });
});
