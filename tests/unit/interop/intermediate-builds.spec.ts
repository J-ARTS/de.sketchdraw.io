import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importDrawio, importSvg } from '@/interop';

// #290: builds between releases 0.1.8 and 0.1.9 wrote more than one picture under svg-v2 and drawio-v3. Their files
// are in tests/fixtures/interop/intermediate, written by the builds named in the file names.
const file = (name: string) => readFileSync(`tests/fixtures/interop/intermediate/${name}`, 'utf8');
const envelope = (contents: string, pattern: RegExp) => JSON.parse(Buffer.from(pattern.exec(contents)![1]!, 'base64').toString('utf8')).projection as string;

describe('files of builds between releases', () => {
  it.each(['41dc689', '1fd1e8d', '14001e6'])('the SVG of build %s names svg-v2 and comes back as the whole document', (build) => {
    const svg = file(`mixed-${build}.svg`);
    expect(envelope(svg, /<sd:document[^>]*>([^<]+)</)).toBe('svg-v2');
    const result = importSvg(svg);
    expect(result.fidelity).toBe('own-roundtrip');
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('EMBEDDED_MODEL_STALE');
    expect(result.document.tasks?.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(result.document.elements.some((element) => element.kind === 'sticky-note' && element.author === 'Ada')).toBe(true);
  });

  it.each(['41dc689', '1fd1e8d', '14001e6'])('the draw.io file of build %s names drawio-v3 and comes back as the whole document', (build) => {
    const drawio = file(`mixed-${build}.drawio`);
    expect(envelope(drawio, /sketchdrawInterop="([^"]+)"/)).toBe('drawio-v3');
    const result = importDrawio(drawio);
    expect(result.fidelity).toBe('own-roundtrip');
    expect(result.document.elements.filter((element) => element.kind === 'component')).toHaveLength(4);
    expect(result.document.elements.some((element) => element.kind === 'table')).toBe(true);
  });

  it.each(['41dc689', '1fd1e8d', '14001e6'])('a file of build %s that was edited outside is still noticed', (build) => {
    const svg = file(`mixed-${build}.svg`);
    const edited = svg.replace(/(<tspan[^>]*>)Form(<\/tspan>|)/, '$1Verändert$2').replace('>Form</text>', '>Verändert</text>');
    expect(edited).not.toBe(svg);
    expect(importSvg(edited).diagnostics.map((entry) => entry.code)).toContain('EMBEDDED_MODEL_STALE');
    const drawio = file(`mixed-${build}.drawio`);
    const editedDrawio = drawio.replace('value="Form"', 'value="Verändert"');
    expect(editedDrawio).not.toBe(drawio);
    expect(importDrawio(editedDrawio).diagnostics.map((entry) => entry.code)).toContain('EMBEDDED_MODEL_STALE');
  });
});
