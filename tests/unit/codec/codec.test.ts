import { describe, expect, it } from 'vitest';
import {
  CODEC_LIMITS,
  formatDiagram,
  parseDiagram,
  SCRIPT_V1_DEFAULT_STYLE,
} from '../../../src/codec';
import {
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../../../src/domain';
import type { SketchDocument, SketchElement } from '../../../src/domain/types';

const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

function buildFullSketchDocument(): SketchDocument {
  return {
    schemaVersion: 1,
    id: 'doc-full-roundtrip',
    title: 'Full Roundtrip Architecture\nWith Multiline & "Quotes" \\ Backslash',
    metadata: {
      author: 'Antigravity',
      description: 'Line 1\nLine 2\tTabbed "quoted" 😀',
    },
    assets: {
      'logo-png': {
        id: 'logo-png',
        name: 'Team Logo',
        mimeType: 'image/png',
        dataUrl: VALID_PNG_DATA_URL,
      },
    },
    componentSets: [
      {
        id: 'sketchdraw.aws',
        name: 'AWS Architecture (Starter)',
        version: '1.0.0',
        components: [
          {
            type: 'aws.compute.instance',
            name: 'Compute Instance',
            provider: 'aws',
            category: 'Compute',
            aliases: ['Compute', 'EC2', 'VM'],
            defaultWidth: 160,
            defaultHeight: 80,
            style: {
              stroke: '#b45309',
              fill: '#fffbeb',
            },
            metadata: {
              'widget:aws.compute.instance:region': 'eu-central-1',
            },
            documentationUrl: 'https://docs.aws.amazon.com/ec2/',
            iconSvg:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 4L13 20" stroke="#b45309" stroke-width="2" fill="none"/></svg>',
            widgets: [
              {
                key: 'region',
                label: 'Region',
                kind: 'select',
                options: ['eu-central-1', 'us-east-1'],
              },
              {
                key: 'vcpu',
                label: 'vCPU',
                kind: 'number',
              },
            ],
          },
        ],
      },
    ],
    elements: [
      {
        id: 'vpc-main',
        kind: 'container',
        x: 20,
        y: 30,
        width: 700,
        height: 420,
        rotation: 0,
        label: 'Production VPC',
        description: 'Main network boundary',
        style: {
          ...SCRIPT_V1_DEFAULT_STYLE,
          stroke: '#334155',
          strokeDash: 'dashed',
        },
        metadata: { env: 'prod' },
      },
      {
        id: 'rect-1',
        kind: 'rectangle',
        x: 40.125,
        y: 60.875,
        width: 140,
        height: 80,
        rotation: 15,
        parentId: 'vpc-main',
        label: 'Ingress\nGateway',
        style: {
          ...SCRIPT_V1_DEFAULT_STYLE,
          fill: '#e0f2fe',
          fontFamily: 'sans',
        },
        metadata: { tier: 'edge' },
      },
      {
        id: 'ellipse-1',
        kind: 'ellipse',
        x: 220,
        y: 60,
        width: 120,
        height: 80,
        rotation: 0,
        parentId: 'vpc-main',
        label: 'Queue',
        style: { ...SCRIPT_V1_DEFAULT_STYLE },
      },
      {
        id: 'diamond-1',
        kind: 'diamond',
        x: 380,
        y: 60,
        width: 100,
        height: 100,
        rotation: 45,
        parentId: 'vpc-main',
        label: 'Route?',
        style: { ...SCRIPT_V1_DEFAULT_STYLE },
      },
      {
        id: 'text-1',
        kind: 'text',
        x: 40,
        y: 180,
        width: 200,
        height: 40,
        rotation: 0,
        text: 'Note: "Latency < 10ms"\nSecond line',
        style: {
          ...SCRIPT_V1_DEFAULT_STYLE,
          fontSize: 14,
          textAlign: 'center',
          fontFamily: 'mono',
        },
      },
      {
        id: 'path-1',
        kind: 'path',
        x: 40,
        y: 250,
        width: 100,
        height: 50,
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: 50.5, y: 50.25 },
          { x: 100, y: 10 },
        ],
        style: {
          ...SCRIPT_V1_DEFAULT_STYLE,
          strokeDash: 'dotted',
        },
      },
      {
        id: 'img-1',
        kind: 'image',
        x: 200,
        y: 240,
        width: 120,
        height: 60,
        rotation: 0,
        assetId: 'logo-png',
        label: 'Brand Banner',
        style: { ...SCRIPT_V1_DEFAULT_STYLE },
      },
      {
        id: 'comp-ec2',
        kind: 'component',
        x: 520,
        y: 70,
        width: 160,
        height: 80,
        rotation: 0,
        parentId: 'vpc-main',
        componentType: 'aws.compute.instance',
        text: 'Compute Instance',
        label: 'Order Handler',
        documentationUrl: 'https://docs.aws.amazon.com/ec2/',
        style: {
          ...SCRIPT_V1_DEFAULT_STYLE,
          stroke: '#b45309',
          fill: '#fffbeb',
        },
        metadata: {
          'widget:aws.compute.instance:region': 'eu-central-1',
          'widget:aws.compute.instance:vcpu': '4',
          customKey: 'customVal',
        },
      },
      {
        id: 'conn-1',
        kind: 'connector',
        x: 180,
        y: 100,
        width: 340,
        height: 10,
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: 340, y: 10 },
        ],
        from: {
          elementId: 'rect-1',
          anchor: { x: 1, y: 0.5 },
        },
        to: {
          elementId: 'comp-ec2',
          anchor: { x: 0, y: 0.5 },
        },
        label: 'HTTPS',
        style: { ...SCRIPT_V1_DEFAULT_STYLE },
      },
    ],
  };
}

describe('Diagram as Code Codec (src/codec)', () => {
  describe('S2-C01 & S2-C02: Roundtrip, determinism, and canonical formatting', () => {
    it('roundtrips a complete document with all 9 element kinds, assets, componentSets, widgets, and metadata', () => {
      const original = buildFullSketchDocument();
      const script1 = formatDiagram(original);
      expect(script1.startsWith('sketchdraw 1\n')).toBe(true);
      expect(script1.endsWith('\n')).toBe(true);

      const parsed1 = parseDiagram(script1);
      expect(parsed1.ok).toBe(true);
      if (!parsed1.ok) return;

      expect(serializeDocument(parsed1.document)).toBe(serializeDocument(original));

      const script2 = formatDiagram(parsed1.document);
      expect(script2).toBe(script1);

      const parsed2 = parseDiagram(script2);
      expect(parsed2.ok).toBe(true);
      if (!parsed2.ok) return;
      expect(parsed2.document).toEqual(parsed1.document);
    });

    it('preserves exact element z-order, sorted asset output, and componentSet array order', () => {
      const doc = buildFullSketchDocument();
      const reversedElements = [...doc.elements].reverse();
      const modified: SketchDocument = {
        ...doc,
        elements: reversedElements,
      };

      const script = formatDiagram(modified);
      const parsed = parseDiagram(script);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      expect(parsed.document.elements.map((el) => el.id)).toEqual(
        reversedElements.map((el) => el.id),
      );
    });

    it('preserves high-precision floats and normalizes -0 to 0', () => {
      const doc: SketchDocument = {
        schemaVersion: 1,
        id: 'doc-precision',
        title: 'Precision Test',
        assets: {},
        componentSets: [],
        metadata: {},
        elements: [
          {
            id: 'r-float',
            kind: 'rectangle',
            x: -0,
            y: 123.4567890123456,
            width: 300.00000000000006,
            height: 99.99999999999999,
            rotation: -0,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          },
        ],
      };

      const script = formatDiagram(doc);
      expect(script).not.toContain('-0');

      const parsed = parseDiagram(script);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const el = parsed.document.elements[0];
      expect(el).toBeDefined();
      if (!el) return;
      expect(Object.is(el.x, 0)).toBe(true);
      expect(Object.is(el.rotation, 0)).toBe(true);
      expect(el.y).toBe(123.4567890123456);
      expect(el.width).toBe(300.00000000000006);
      expect(el.height).toBe(99.99999999999999);
    });

    it('preserves lone UTF-16 surrogates in strings across format and parse (S2-C14)', () => {
      const loneHigh = 'prefix-\uD800-suffix';
      const loneLow = 'prefix-\uDC00-suffix';
      const doc: SketchDocument = {
        schemaVersion: 1,
        id: 'doc-surrogate',
        title: loneHigh,
        assets: {},
        componentSets: [],
        metadata: {
          note: loneLow,
        },
        elements: [
          {
            id: 'txt-surrogate',
            kind: 'text',
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            rotation: 0,
            text: `${loneHigh}|${loneLow}`,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          },
        ],
      };

      const script = formatDiagram(doc);
      expect(script).toContain('\\ud800');
      expect(script).toContain('\\udc00');

      const parsed = parseDiagram(script);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      expect(parsed.document.title).toBe(loneHigh);
      expect(parsed.document.metadata['note']).toBe(loneLow);
      expect(parsed.document.elements[0]?.text).toBe(`${loneHigh}|${loneLow}`);
    });
  });

  describe('S2-C03: Comments, line endings, BOM, defaults, and declaration order', () => {
    it('supports UTF-8 BOM, CRLF line endings, # comments, blank lines, and partial style defaults', () => {
      const script = [
        '\uFEFF# Leading comment',
        '  # Indented comment',
        '',
        'sketchdraw 1',
        '# Document metadata',
        'document {"id":"doc-1","title":"Demo"}',
        '',
        'rectangle "box-1" {"x":10,"y":20,"width":100,"height":50,"style":{"stroke":"#ff0000"}}',
        '',
      ].join('\r\n');

      const result = parseDiagram(script);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.document.id).toBe('doc-1');
      expect(result.document.metadata).toEqual({});
      expect(result.document.elements).toHaveLength(1);
      const box = result.document.elements[0];
      expect(box?.rotation).toBe(0);
      expect(box?.style).toEqual({
        ...SCRIPT_V1_DEFAULT_STYLE,
        stroke: '#ff0000',
      });
      // Optional fontFamily must not be injected by Script v1 defaults when omitted
      expect(Object.prototype.hasOwnProperty.call(box?.style ?? {}, 'fontFamily')).toBe(false);
    });

    it('allows elements to appear before asset and set declarations in the script', () => {
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-order","title":"Forward Refs"}',
        'image "img-1" {"assetId":"asset-1","height":32,"width":32,"x":0,"y":0}',
        'component "comp-1" {"componentType":"custom.acme.node","height":80,"width":120,"x":50,"y":50}',
        `asset "asset-1" {"dataUrl":${JSON.stringify(VALID_PNG_DATA_URL)},"mimeType":"image/png","name":"Icon"}`,
        'set "custom.set" {"components":[{"category":"General","defaultHeight":80,"defaultWidth":120,"name":"Node","provider":"custom","style":{"fill":"transparent","fontSize":16,"opacity":1,"stroke":"#1f2937","strokeDash":"solid","strokeWidth":2,"textAlign":"left"},"type":"custom.acme.node"}],"name":"Custom","version":"1.0.0"}',
      ].join('\n');

      const parsed = parseDiagram(script);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.document.elements).toHaveLength(2);
      expect(Object.keys(parsed.document.assets)).toEqual(['asset-1']);
      expect(parsed.document.componentSets).toHaveLength(1);

      // Canonical format outputs header+document, blank line, assets, blank line, sets, blank line, elements
      const formatted = formatDiagram(parsed.document);
      const groups = formatted.trim().split('\n\n');
      expect(groups).toHaveLength(4);
      expect(groups[0]?.startsWith('sketchdraw 1\ndocument ')).toBe(true);
      expect(groups[1]?.startsWith('asset "asset-1"')).toBe(true);
      expect(groups[2]?.startsWith('set "custom.set"')).toBe(true);
      expect(groups[3]?.startsWith('image "img-1"\n')).toBe(false);
      expect(groups[3]?.startsWith('image "img-1" ')).toBe(true);
    });

    it('parses all four Section 5 contract example scripts cleanly', () => {
      // Example 1: Two elements and a bound connector
      const example1 = [
        'sketchdraw 1',
        'document {"id":"demo.architecture","title":"Web und API","metadata":{"owner":"Team"}}',
        '',
        'rectangle "web" {"x":40,"y":80,"width":140,"height":70,"text":"Web","label":"Web-Anwendung"}',
        'rectangle "api" {"x":320,"y":80,"width":140,"height":70,"text":"API","description":"Bearbeitet Anfragen"}',
        'connector "request" {"x":180,"y":115,"width":140,"height":0,"points":[{"x":0,"y":0},{"x":140,"y":0}],"from":{"elementId":"web","anchor":{"x":1,"y":0.5}},"to":{"elementId":"api","anchor":{"x":0,"y":0.5}},"text":"HTTPS"}',
      ].join('\n');
      const res1 = parseDiagram(example1);
      expect(res1.ok).toBe(true);

      // Example 2: Custom set, widget, and persistent style override
      const example2 = [
        'sketchdraw 1',
        'document {"id":"demo.queue","title":"Arbeitswarteschlange"}',
        '',
        'set "acme.core" {"name":"Acme-Komponenten","version":"1.0.0","components":[{"type":"custom.acme.queue","name":"Queue","provider":"custom","category":"Messaging","aliases":["Warteschlange"],"defaultWidth":160,"defaultHeight":80,"style":{"fill":"#e0f2fe"},"widgets":[{"key":"capacity","label":"Kapazität","kind":"number"}]}]}',
        '',
        'component "jobs" {"x":80,"y":80,"width":160,"height":80,"componentType":"custom.acme.queue","text":"Jobs","label":"Job-Warteschlange","style":{"fill":"#e0f2fe","strokeDash":"dashed"},"metadata":{"widget:custom.acme.queue:capacity":"100","team":"Platform"}}',
      ].join('\n');
      const res2 = parseDiagram(example2);
      expect(res2.ok).toBe(true);

      // Context snapshot for Examples 3 & 4
      const demoAssetsContext: SketchDocument = {
        schemaVersion: 1,
        id: 'demo.assets',
        title: 'Demo Assets',
        metadata: {},
        assets: {
          logo: {
            id: 'logo',
            name: 'Logo',
            mimeType: 'image/png',
            dataUrl: VALID_PNG_DATA_URL,
          },
        },
        componentSets: [
          {
            id: 'sketchdraw.generic',
            name: 'Generic',
            version: '1.0.0',
            components: [
              {
                type: 'generic.service',
                name: 'Service',
                provider: 'generic',
                category: 'Compute',
                defaultWidth: 160,
                defaultHeight: 80,
                style: { stroke: '#334155', fill: '#f8fafc' },
              },
            ],
          },
        ],
        elements: [],
      };

      // Example 3: Short draft with explicitly referenced context resources
      const example3 = [
        'sketchdraw 1',
        'document {"title":"Lokale Ressourcen"}',
        'asset-ref "logo"',
        'set-ref "sketchdraw.generic" {"version":"1.0.0"}',
        '',
        'image "brand" {"x":40,"y":40,"width":120,"height":80,"assetId":"logo","label":"Projektlogo"}',
        'component "service" {"x":240,"y":40,"width":160,"height":80,"componentType":"generic.service","text":"Dienst"}',
      ].join('\n');
      const res3 = parseDiagram(example3, demoAssetsContext);
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.document.id).toBe('demo.assets');
      }

      // Example 4: Explicit resource removal via drop
      const example4 = [
        'sketchdraw 1',
        'document {"id":"demo.assets","title":"Bereinigte Skizze","metadata":{}}',
        'drop asset "logo"',
        'drop set "sketchdraw.generic"',
        'text "note" {"x":40,"y":40,"width":260,"height":60,"text":"Ressourcen ausdrücklich entfernt."}',
      ].join('\n');
      const res4 = parseDiagram(example4, demoAssetsContext);
      expect(res4.ok).toBe(true);
      if (res4.ok) {
        expect(res4.document.assets).toEqual({});
        expect(res4.document.componentSets).toEqual([]);
      }
    });
  });

  describe('S2-C04: Structured diagnostics, strict JSON, and no input mutation', () => {
    it('rejects empty input, wrong header version, and missing document declaration', () => {
      const emptyRes = parseDiagram('   \n  # comment only \n ');
      expect(emptyRes.ok).toBe(false);
      if (!emptyRes.ok) {
        expect(emptyRes.diagnostics[0]?.code).toBe('EXPECTED_HEADER');
      }

      const badVer = parseDiagram('sketchdraw 2\ndocument {"id":"d","title":"t"}');
      expect(badVer.ok).toBe(false);
      if (!badVer.ok) {
        expect(badVer.diagnostics[0]?.code).toBe('FORMAT_VERSION');
        expect(badVer.diagnostics[0]?.line).toBe(1);
        expect(badVer.diagnostics[0]?.column).toBe(12);
      }

      const noHeader = parseDiagram('document {"id":"d","title":"t"}');
      expect(noHeader.ok).toBe(false);
      if (!noHeader.ok) {
        expect(noHeader.diagnostics[0]?.code).toBe('EXPECTED_HEADER');
      }

      const noDoc = parseDiagram(
        'sketchdraw 1\nrectangle "r1" {"x":0,"y":0,"width":10,"height":10}',
      );
      expect(noDoc.ok).toBe(false);
      if (!noDoc.ok) {
        expect(noDoc.diagnostics.some((d) => d.code === 'EXPECTED_DOCUMENT')).toBe(true);
      }
    });

    it('rejects duplicate JSON keys, JSON comments, trailing commas, and single quotes', () => {
      const dupKeyScript = [
        'sketchdraw 1',
        'document {"id":"doc-1","title":"A","title":"B"}',
      ].join('\n');
      const dupRes = parseDiagram(dupKeyScript);
      expect(dupRes.ok).toBe(false);
      if (!dupRes.ok) {
        const diag = dupRes.diagnostics.find((d) => d.code === 'DUPLICATE_JSON_KEY');
        expect(diag).toBeDefined();
        expect(diag?.line).toBe(2);
      }

      const trailingCommaScript = [
        'sketchdraw 1',
        'document {"id":"doc-1","title":"A",}',
      ].join('\n');
      const commaRes = parseDiagram(trailingCommaScript);
      expect(commaRes.ok).toBe(false);
      if (!commaRes.ok) {
        expect(commaRes.diagnostics[0]?.code).toBe('JSON_SYNTAX');
      }

      const commentInJsonScript = [
        'sketchdraw 1',
        'document {"id":"doc-1", /* inline */ "title":"A"}',
      ].join('\n');
      const commentRes = parseDiagram(commentInJsonScript);
      expect(commentRes.ok).toBe(false);
      if (!commentRes.ok) {
        expect(commentRes.diagnostics[0]?.code).toBe('JSON_SYNTAX');
      }

      const singleQuoteIdScript = [
        'sketchdraw 1',
        'document {"id":"doc-1","title":"A"}',
        "rectangle 'r1' {\"x\":0,\"y\":0,\"width\":10,\"height\":10}",
      ].join('\n');
      const singleQuoteRes = parseDiagram(singleQuoteIdScript);
      expect(singleQuoteRes.ok).toBe(false);
      if (!singleQuoteRes.ok) {
        expect(singleQuoteRes.diagnostics[0]?.code).toBe('JSON_SYNTAX');
        expect(singleQuoteRes.diagnostics[0]?.line).toBe(3);
        expect(singleQuoteRes.diagnostics[0]?.column).toBe(11);
      }
    });

    it('computes 1-based UTF-16 code unit columns accurately after surrogate pairs (emojis)', () => {
      // '😀' is 2 UTF-16 code units.
      const line2 = 'document {"id":"doc-1","title":"😀","unknownKey":123}';
      const script = `sketchdraw 1\n${line2}`;
      const res = parseDiagram(script);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        const diag = res.diagnostics.find((d) => d.code === 'UNKNOWN_FIELD');
        expect(diag).toBeDefined();
        const expectedCol = line2.indexOf('"unknownKey"') + 1;
        expect(diag?.line).toBe(2);
        expect(diag?.column).toBe(expectedCol);
        expect(diag?.endColumn).toBe(expectedCol + '"unknownKey"'.length);
      }
    });

    it('rejects unknown fields, forbidden prototype keys, repeated inline id/kind, and duplicate declarations', () => {
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-1","title":"Test"}',
        'rectangle "r1" {"id":"r2","x":0,"y":0,"width":10,"height":10,"extra":true}',
        'rectangle "r1" {"x":10,"y":10,"width":10,"height":10}',
        'ellipse "e1" {"x":0,"y":0,"width":10,"height":10,"metadata":{"__proto__":"polluted"}}',
      ].join('\n');

      const res = parseDiagram(script);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        const codes = res.diagnostics.map((d) => d.code);
        expect(codes).toContain('DUPLICATE_DECLARATION');
        expect(codes).toContain('UNKNOWN_FIELD');
        expect(codes).toContain('FORBIDDEN_KEY');
      }
    });

    it('maps domain validation errors (cyclic containers, dangling connectors) to source lines and columns', () => {
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-cycle","title":"Cycle"}',
        'container "c1" {"x":0,"y":0,"width":200,"height":200,"parentId":"c2"}',
        'container "c2" {"x":10,"y":10,"width":100,"height":100,"parentId":"c1"}',
        'connector "conn-bad" {"x":0,"y":0,"width":10,"height":10,"points":[{"x":0,"y":0},{"x":10,"y":10}],"from":{"elementId":"missing-node","anchor":{"x":0.5,"y":0.5}}}',
      ].join('\n');

      const res = parseDiagram(script);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        const cycleDiag = res.diagnostics.find((d) => d.code === 'CONTAINER_CYCLE');
        expect(cycleDiag).toBeDefined();
        expect(cycleDiag?.line).toBe(3);

        const missingEndpointDiag = res.diagnostics.find(
          (d) => d.code === 'DANGLING_CONNECTOR_REFERENCE',
        );
        expect(missingEndpointDiag).toBeDefined();
        expect(missingEndpointDiag?.line).toBe(5);
      }
    });
  });

  describe('S2-C05 & S2-C06: Context resources (asset-ref, set-ref, drop) and safety', () => {
    it('resolves asset-ref and set-ref from contextDocument and clones resources without mutating contextDocument', () => {
      const contextDoc = buildFullSketchDocument();
      const contextSnapshot = structuredClone(contextDoc);

      const script = [
        'sketchdraw 1',
        'document {"id":"doc-full-roundtrip","title":"Updated via Context"}',
        'asset-ref "logo-png"',
        'set-ref "sketchdraw.aws" {"version":"1.0.0"}',
        'image "img-new" {"assetId":"logo-png","height":60,"width":120,"x":10,"y":10}',
        'component "comp-new" {"componentType":"aws.compute.instance","height":80,"width":160,"x":200,"y":10}',
      ].join('\n');

      const res = parseDiagram(script, contextDoc);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(Object.keys(res.document.assets)).toEqual(['logo-png']);
      expect(res.document.componentSets).toHaveLength(1);
      expect(res.document.assets['logo-png']).not.toBe(contextDoc.assets['logo-png']);
      expect(res.document.componentSets[0]).not.toBe(contextDoc.componentSets[0]);

      // Mutating parsed result must not affect contextDoc
      if (res.document.assets['logo-png']) {
        res.document.assets['logo-png'].name = 'Mutated';
      }
      expect(contextDoc).toEqual(contextSnapshot);
    });

    it('supports explicit drop asset and drop set when unreferenced', () => {
      const contextDoc = buildFullSketchDocument();
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-full-roundtrip","title":"Dropped Resources"}',
        'drop asset "logo-png"',
        'drop set "sketchdraw.aws"',
        'rectangle "r1" {"x":0,"y":0,"width":100,"height":80}',
      ].join('\n');

      const res = parseDiagram(script, contextDoc);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.document.assets).toEqual({});
      expect(res.document.componentSets).toEqual([]);
    });

    it('rejects omitted context resources (RESOURCE_OMITTED), wrong set-ref version (RESOURCE_VERSION_CONFLICT), and context ID mismatch (CONTEXT_ID_MISMATCH)', () => {
      const contextDoc = buildFullSketchDocument();

      // Omitted both logo-png and sketchdraw.aws
      const omittedScript = [
        'sketchdraw 1',
        'document {"id":"doc-full-roundtrip","title":"Omitted"}',
      ].join('\n');
      const omittedRes = parseDiagram(omittedScript, contextDoc);
      expect(omittedRes.ok).toBe(false);
      if (!omittedRes.ok) {
        const omittedCodes = omittedRes.diagnostics.filter((d) => d.code === 'RESOURCE_OMITTED');
        expect(omittedCodes).toHaveLength(2);
      }

      // Wrong version in set-ref
      const wrongVerScript = [
        'sketchdraw 1',
        'document {"id":"doc-full-roundtrip","title":"Wrong Version"}',
        'asset-ref "logo-png"',
        'set-ref "sketchdraw.aws" {"version":"2.0.0"}',
      ].join('\n');
      const wrongVerRes = parseDiagram(wrongVerScript, contextDoc);
      expect(wrongVerRes.ok).toBe(false);
      if (!wrongVerRes.ok) {
        expect(
          wrongVerRes.diagnostics.some((d) => d.code === 'RESOURCE_VERSION_CONFLICT'),
        ).toBe(true);
      }

      // Context ID mismatch
      const idMismatchScript = [
        'sketchdraw 1',
        'document {"id":"different-doc-id","title":"Mismatch"}',
        'asset-ref "logo-png"',
        'set-ref "sketchdraw.aws" {"version":"1.0.0"}',
      ].join('\n');
      const idMismatchRes = parseDiagram(idMismatchScript, contextDoc);
      expect(idMismatchRes.ok).toBe(false);
      if (!idMismatchRes.ok) {
        expect(idMismatchRes.diagnostics.some((d) => d.code === 'CONTEXT_ID_MISMATCH')).toBe(
          true,
        );
      }

      // Context required when no contextDocument is provided
      const noContextRes = parseDiagram(wrongVerScript);
      expect(noContextRes.ok).toBe(false);
      if (!noContextRes.ok) {
        expect(noContextRes.diagnostics.some((d) => d.code === 'CONTEXT_REQUIRED')).toBe(true);
      }
    });

    it('rejects dangling references when a dropped resource is still used by an element', () => {
      const contextDoc = buildFullSketchDocument();
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-full-roundtrip","title":"Dangling Drop"}',
        'drop asset "logo-png"',
        'drop set "sketchdraw.aws"',
        'image "img-1" {"assetId":"logo-png","height":60,"width":120,"x":0,"y":0}',
      ].join('\n');

      const res = parseDiagram(script, contextDoc);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.diagnostics.some((d) => d.code === 'MISSING_ASSET_REFERENCE')).toBe(true);
      }
    });
  });

  describe('S2-C07 & S2-C14: Resource limits and Legacy Schema-1 preservation', () => {
    it('rejects JSON payloads exceeding MAX_JSON_DEPTH (64) without stack overflow', () => {
      const deepOpen = '{"a":'.repeat(65);
      const deepClose = '}'.repeat(65);
      const script = [
        'sketchdraw 1',
        `document {"id":"doc-deep","title":"Deep","metadata":${deepOpen}"val"${deepClose}}`,
      ].join('\n');

      const res = parseDiagram(script);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.diagnostics[0]?.code).toBe('LIMIT_EXCEEDED');
      }
    });

    it('caps diagnostics at CODEC_LIMITS.MAX_DIAGNOSTICS (100) with a concluding LIMIT_EXCEEDED notice', () => {
      const badLines = Array.from({ length: 120 }, (_, i) => `unknown_stmt_${i}`);
      const script = [
        'sketchdraw 1',
        'document {"id":"doc-1","title":"Many Errors"}',
        ...badLines,
      ].join('\n');

      const res = parseDiagram(script);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.diagnostics).toHaveLength(CODEC_LIMITS.MAX_DIAGNOSTICS);
        expect(res.diagnostics[99]?.code).toBe('LIMIT_EXCEEDED');
      }
    });

    it('preserves valid Schema-1 legacy documents (unprefixed componentType, arbitrary widget:* metadata, decorative SVG)', () => {
      const legacyDoc: SketchDocument = {
        schemaVersion: 1,
        id: 'doc-legacy-s1',
        title: 'Legacy Schema-1 Document',
        assets: {},
        metadata: {},
        componentSets: [
          {
            id: 'legacy-set',
            name: 'Legacy Set',
            version: 'v1-beta',
            components: [
              {
                type: 'unprefixed-worker',
                name: 'Legacy Worker',
                provider: 'custom',
                category: 'Legacy',
                defaultWidth: 120,
                defaultHeight: 80,
                style: { ...SCRIPT_V1_DEFAULT_STYLE },
                metadata: {
                  'widget:arbitrary-unvalidated': 'not-a-json-number-001',
                },
                // Valid under Schema-1 domain validation (<svg> without <script>/onload/javascript:)
                // even though S2 catalog icon parser treats <defs> as unsupported decorative tag
                iconSvg:
                  '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><rect x="2" y="2" width="20" height="20"/></svg>',
              },
            ],
          },
        ],
        elements: [
          {
            id: 'el-legacy',
            kind: 'component',
            x: 10,
            y: 20,
            width: 120,
            height: 80,
            rotation: 0,
            componentType: 'unprefixed-worker',
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
            metadata: {
              'widget:custom:freeform': '0123-leading-zero',
            },
          },
        ],
      };

      const script = formatDiagram(legacyDoc);
      const parsed = parseDiagram(script);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      expect(parsed.document).toEqual(validateDocument(legacyDoc));
    });

    it('throws DomainValidationError when formatDiagram is given an invalid SketchDocument', () => {
      const invalidDoc: SketchDocument = {
        schemaVersion: 1,
        id: 'bad id with spaces',
        title: 'Invalid',
        assets: {},
        componentSets: [],
        metadata: {},
        elements: [] as SketchElement[],
      };

      expect(() => formatDiagram(invalidDoc)).toThrow(DomainValidationError);
    });
  });
});
