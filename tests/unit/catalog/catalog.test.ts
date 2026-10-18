import { describe, expect, it } from 'vitest';
import {
  builtInComponentSets,
  CATALOG_LIMITS,
  formatWidgetMetadataKey,
  GENERIC_FALLBACK_ICON_TREE,
  ICON_LIMITS,
  instantiateComponent,
  parseComponentSet,
  parseSafeIconSvg,
  parseWidgetMetadataKey,
  prepareComponentSetImport,
  resolveCatalogIcon,
  searchCatalogComponents,
  SVG_NAMESPACE,
  validateComponentSet,
  validateSafeIconSvg,
  validateWidgetValue,
} from '../../../src/catalog';
import { SCRIPT_V1_DEFAULT_STYLE } from '../../../src/codec';
import {
  applyCommand,
  createDocument,
  createElement,
  DomainValidationError,
  validateDocument,
} from '../../../src/domain';
import type { ComponentDefinition, ComponentSet, SketchDocument } from '../../../src/domain/types';

function createEmptyDocument(): SketchDocument {
  const doc = createDocument('Catalog Test Document');
  return validateDocument({
    ...doc,
    id: 'doc-catalog-test',
  });
}

function getBuiltInSet(id: string): ComponentSet {
  const found = builtInComponentSets.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Missing built-in set ${id}`);
  }
  return found;
}

describe('Architecture Component Catalog & Safe Icon Tree (src/catalog)', () => {
  describe('Built-in component sets & search', () => {
    it('provides generic and four official provider starter sets with valid definitions and icons', () => {
      expect(builtInComponentSets.map((s) => s.id)).toEqual([
        'sketchdraw.generic',
        'sketchdraw.aws',
        'sketchdraw.azure',
        'sketchdraw.gcp',
        'sketchdraw.kubernetes',
      ]);

      for (const set of builtInComponentSets) {
        expect(set.version.length).toBeGreaterThan(0);
        expect(set.components.length).toBeGreaterThanOrEqual(3);

        const validated = validateComponentSet(set);
        expect(validated).toEqual(set);

        for (const comp of set.components) {
          expect(comp.type.startsWith(`${comp.provider}.`)).toBe(true);
          expect(comp.iconSvg).toBeDefined();
          if (comp.iconSvg) {
            const iconRes = parseSafeIconSvg(comp.iconSvg);
            expect(iconRes.ok).toBe(true);
          }
        }
      }
    });

    it('deep-freezes builtInComponentSets so mutation attempts fail in strict mode', () => {
      expect(Object.isFrozen(builtInComponentSets)).toBe(true);
      const awsSet = getBuiltInSet('sketchdraw.aws');
      expect(Object.isFrozen(awsSet)).toBe(true);
      expect(Object.isFrozen(awsSet.components)).toBe(true);
      const firstComp = awsSet.components[0];
      expect(firstComp).toBeDefined();
      if (!firstComp) return;
      expect(Object.isFrozen(firstComp)).toBe(true);
      expect(Object.isFrozen(firstComp.style)).toBe(true);

      expect(() => {
        (awsSet as { name: string }).name = 'Mutated';
      }).toThrow(TypeError);

      expect(() => {
        (firstComp.style as { stroke: string }).stroke = '#000000';
      }).toThrow(TypeError);
    });

    it('searches catalog components by name, type, provider, category, and multi-word/hyphenated aliases', () => {
      const ec2Hits = searchCatalogComponents(builtInComponentSets, 'EC2');
      expect(ec2Hits.some((r) => r.component.type === 'aws.compute.instance')).toBe(true);

      const vmHits = searchCatalogComponents(builtInComponentSets, 'Virtual Machine');
      expect(vmHits.some((r) => r.component.type === 'azure.compute.vm')).toBe(true);

      const vmHyphenHits = searchCatalogComponents(builtInComponentSets, 'Virtual-Machine');
      expect(vmHyphenHits.some((r) => r.component.type === 'azure.compute.vm')).toBe(true);

      const gceHits = searchCatalogComponents(builtInComponentSets, 'GCE');
      expect(gceHits.some((r) => r.component.type === 'gcp.compute.instance')).toBe(true);

      const computeHits = searchCatalogComponents(builtInComponentSets, 'Compute');
      expect(computeHits.length).toBeGreaterThanOrEqual(4);

      const awsOnlyHits = searchCatalogComponents(builtInComponentSets, 'Compute', 'aws');
      expect(awsOnlyHits.length).toBeGreaterThanOrEqual(1);
      expect(awsOnlyHits.every((r) => r.component.provider === 'aws')).toBe(true);

      const allHits = searchCatalogComponents();
      expect(allHits.length).toBe(37);

      const kubernetesHits = searchCatalogComponents(builtInComponentSets, 'Pod', 'kubernetes');
      expect(kubernetesHits.some((result) => result.component.type === 'kubernetes.workload.pod')).toBe(true);
    });
  });

  describe('S2-C08: Component instantiation & atomic command batching', () => {
    it('creates a batch command (set-component-sets + add) on first instantiation and a single add command on second instantiation', () => {
      const doc0 = createEmptyDocument();
      const doc0Snapshot = structuredClone(doc0);
      const awsSet = getBuiltInSet('sketchdraw.aws');

      const inst1 = instantiateComponent(doc0, {
        set: awsSet,
        type: 'aws.compute.instance',
        id: 'fn-1',
        at: { x: 100, y: 150 },
        label: 'Checkout Handler',
        metadata: {
          'widget:aws.compute.instance:region': 'eu-central-1',
          'widget:aws.compute.instance:vcpu': '4',
          owner: 'payments',
        },
      });

      // Input document must not be mutated
      expect(doc0).toEqual(doc0Snapshot);

      expect(inst1.command.type).toBe('batch');
      if (inst1.command.type === 'batch') {
        expect(inst1.command.commands).toHaveLength(2);
        expect(inst1.command.commands[0]?.type).toBe('set-component-sets');
        expect(inst1.command.commands[1]?.type).toBe('add');
      }

      expect(inst1.element.id).toBe('fn-1');
      expect(inst1.element.kind).toBe('component');
      expect(inst1.element.x).toBe(100);
      expect(inst1.element.y).toBe(150);
      expect(inst1.element.width).toBe(160);
      expect(inst1.element.height).toBe(80);
      expect(inst1.element.label).toBe('Checkout Handler');
      expect(inst1.element.text).toBe('Amazon EC2');
      expect(inst1.element.metadata).toEqual({
        provenance: 'official-architecture-icon',
        source: 'https://aws.amazon.com/architecture/icons/',
        terms: 'AWS Architecture Icons terms and AWS trademarks apply.',
        'widget:aws.compute.instance:region': 'eu-central-1',
        'widget:aws.compute.instance:vcpu': '4',
        owner: 'payments',
      });

      const doc1 = applyCommand(doc0, inst1.command);
      expect(doc1.componentSets).toHaveLength(1);
      expect(doc1.elements).toHaveLength(1);

      // Second instantiation from the same set uses a single 'add' command
      const inst2 = instantiateComponent(doc1, {
        set: awsSet,
        type: 'aws.storage.object',
        id: 'bucket-1',
        at: { x: 340, y: 150 },
      });

      expect(inst2.command.type).toBe('add');
      const doc2 = applyCommand(doc1, inst2.command);
      expect(doc2.componentSets).toHaveLength(1);
      expect(doc2.elements).toHaveLength(2);
      expect(validateDocument(doc2)).toEqual(doc2);

      // Mutating returned element must not affect applied document or builtInComponentSets
      inst2.element.label = 'Mutated Label';
      expect(doc2.elements[1]?.label).toBe('Amazon S3');
    });

    it('supports instantiation inside an existing container and rejects missing or non-container parentId', () => {
      const genericSet = getBuiltInSet('sketchdraw.generic');
      const baseDoc: SketchDocument = validateDocument({
        ...createDocument('Parents'),
        id: 'doc-parents',
        elements: [
          createElement('container', {
            id: 'vpc-1',
            x: 10,
            y: 10,
            width: 500,
            height: 400,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          }),
          createElement('rectangle', {
            id: 'rect-1',
            x: 20,
            y: 20,
            width: 100,
            height: 80,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          }),
        ],
      });

      const validChild = instantiateComponent(baseDoc, {
        set: genericSet,
        type: 'generic.service',
        id: 'svc-1',
        at: { x: 40, y: 50 },
        parentId: 'vpc-1',
      });
      expect(validChild.element.parentId).toBe('vpc-1');

      expect(() =>
        instantiateComponent(baseDoc, {
          set: genericSet,
          type: 'generic.service',
          id: 'svc-missing-parent',
          at: { x: 40, y: 50 },
          parentId: 'non-existent',
        }),
      ).toThrowError(DomainValidationError);

      try {
        instantiateComponent(baseDoc, {
          set: genericSet,
          type: 'generic.service',
          id: 'svc-bad-parent',
          at: { x: 40, y: 50 },
          parentId: 'rect-1',
        });
        expect.unreachable('Should have rejected non-container parentId');
      } catch (err) {
        expect(err).toBeInstanceOf(DomainValidationError);
        expect((err as DomainValidationError).issues[0]?.code).toBe('INVALID_PARENT_KIND');
      }

      try {
        instantiateComponent(baseDoc, {
          set: genericSet,
          type: 'generic.service',
          id: 'vpc-1', // duplicate ID
          at: { x: 40, y: 50 },
        });
        expect.unreachable('Should have rejected duplicate element ID');
      } catch (err) {
        expect(err).toBeInstanceOf(DomainValidationError);
        expect((err as DomainValidationError).issues[0]?.code).toBe('DUPLICATE_ELEMENT_ID');
      }
    });
  });

  describe('S2-C09: Set version conflicts, content conflicts, and type collisions', () => {
    it('rejects SET_VERSION_CONFLICT, SET_CONTENT_CONFLICT, and COMPONENT_TYPE_COLLISION without mutating inputs', () => {
      const awsSet = getBuiltInSet('sketchdraw.aws');
      const docWithAws = applyCommand(createEmptyDocument(), {
        type: 'set-component-sets',
        sets: [awsSet],
      });
      const snapshot = structuredClone(docWithAws);

      // 1. Different version for same set ID -> SET_VERSION_CONFLICT
      const awsV2: ComponentSet = {
        ...structuredClone(awsSet),
        version: '2.0.0',
      };
      expect(() => prepareComponentSetImport(docWithAws, awsV2)).toThrowError(
        DomainValidationError,
      );
      try {
        prepareComponentSetImport(docWithAws, awsV2);
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('SET_VERSION_CONFLICT');
      }

      // 2. Same version for same set ID, but modified content -> SET_CONTENT_CONFLICT
      const awsModifiedContent: ComponentSet = {
        ...structuredClone(awsSet),
        name: 'Modified AWS Name',
      };
      try {
        prepareComponentSetImport(docWithAws, awsModifiedContent);
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('SET_CONTENT_CONFLICT');
      }

      // 3. Cross-set componentType collision in document -> COMPONENT_TYPE_COLLISION
      const docWithExistingType: SketchDocument = validateDocument({
        ...createDocument('Collision'),
        id: 'doc-collision',
        componentSets: [
          {
            id: 'legacy.set',
            name: 'Legacy Set',
            version: '1.0.0',
            components: [
              {
                type: 'custom.acme.worker',
                name: 'Worker',
                provider: 'custom',
                category: 'Compute',
                defaultWidth: 120,
                defaultHeight: 80,
                style: { ...SCRIPT_V1_DEFAULT_STYLE },
              },
            ],
          },
        ],
      });

      const collidingNewSet: ComponentSet = {
        id: 'acme.set',
        name: 'Custom Set',
        version: '1.0.0',
        components: [
          {
            type: 'custom.acme.worker',
            name: 'Worker',
            provider: 'custom',
            category: 'Compute',
            defaultWidth: 120,
            defaultHeight: 80,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          },
        ],
      };

      try {
        prepareComponentSetImport(docWithExistingType, collidingNewSet);
        expect.unreachable('Should have thrown COMPONENT_TYPE_COLLISION');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('COMPONENT_TYPE_COLLISION');
      }

      expect(docWithAws).toEqual(snapshot);
    });
  });

  describe('S2-C10: Custom component sets, strict JSON parsing, and widget validation', () => {
    it('validates text, number, and select widgets strictly including canonical finite number strings', () => {
      expect(formatWidgetMetadataKey('custom.acme.db', 'replicas')).toBe(
        'widget:custom.acme.db:replicas',
      );
      expect(parseWidgetMetadataKey('widget:custom.acme.db:replicas')).toEqual({
        componentType: 'custom.acme.db',
        widgetKey: 'replicas',
      });
      expect(parseWidgetMetadataKey('regularKey')).toBeNull();

      const numberWidget = {
        key: 'replicas',
        label: 'Replicas',
        kind: 'number' as const,
      };
      expect(validateWidgetValue(numberWidget, '0')).toBe('0');
      expect(validateWidgetValue(numberWidget, '-42')).toBe('-42');
      expect(validateWidgetValue(numberWidget, '3.14159')).toBe('3.14159');
      expect(validateWidgetValue(numberWidget, '1e+21')).toBe('1e+21');

      // Non-canonical or non-finite numbers must throw DomainValidationError
      for (const invalidNum of ['-0', '01', '1.0', '+1', '1e5', 'NaN', 'Infinity', ' 42 ']) {
        expect(() => validateWidgetValue(numberWidget, invalidNum)).toThrow(DomainValidationError);
      }

      const selectWidget = {
        key: 'tier',
        label: 'Tier',
        kind: 'select' as const,
        options: ['dev', 'prod'],
      };
      expect(validateWidgetValue(selectWidget, 'dev')).toBe('dev');
      expect(() => validateWidgetValue(selectWidget, 'staging')).toThrow(DomainValidationError);
    });

    it('rejects invalid widget definitions, foreign widget namespaces, and invalid widget values in validateComponentSet and instantiateComponent', () => {
      const baseDef: ComponentDefinition = {
        type: 'custom.acme.service',
        name: 'Service',
        provider: 'custom',
        category: 'App',
        defaultWidth: 140,
        defaultHeight: 80,
        style: { ...SCRIPT_V1_DEFAULT_STYLE },
        widgets: [
          { key: 'port', label: 'Port', kind: 'number' },
          { key: 'env', label: 'Env', kind: 'select', options: ['dev', 'prod'] },
        ],
      };

      // Foreign widget namespace in default metadata
      const badNamespaceSet: ComponentSet = {
        id: 'acme.custom',
        name: 'Custom',
        version: '1.0.0',
        components: [
          {
            ...baseDef,
            metadata: {
              'widget:custom.other.service:port': '8080',
            },
          },
        ],
      };
      try {
        validateComponentSet(badNamespaceSet);
        expect.unreachable('Should have rejected foreign widget namespace');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('INVALID_WIDGET_NAMESPACE');
      }

      // Unknown widget key in default metadata
      const unknownWidgetKeySet: ComponentSet = {
        id: 'acme.custom',
        name: 'Custom',
        version: '1.0.0',
        components: [
          {
            ...baseDef,
            metadata: {
              'widget:custom.acme.service:nonexistent': '8080',
            },
          },
        ],
      };
      try {
        validateComponentSet(unknownWidgetKeySet);
        expect.unreachable('Should have rejected unknown widget key');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('UNKNOWN_WIDGET_KEY');
      }

      // Invalid widget value during instantiateComponent
      const validCustomSet: ComponentSet = {
        id: 'acme.custom',
        name: 'Custom',
        version: '1.0.0',
        components: [baseDef],
      };
      try {
        instantiateComponent(createEmptyDocument(), {
          set: validCustomSet,
          type: 'custom.acme.service',
          id: 'svc-1',
          at: { x: 0, y: 0 },
          metadata: {
            'widget:custom.acme.service:port': '08080', // leading zero
          },
        });
        expect.unreachable('Should have rejected non-canonical number widget value');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('INVALID_WIDGET_VALUE');
      }
    });

    it('parses custom component sets with parseComponentSet and rejects duplicate keys, comments, and non-namespaced types', () => {
      const validJson = JSON.stringify({
        id: 'acme.cloud',
        name: 'Acme Cloud',
        version: '1.0.0',
        components: [
          {
            type: 'custom.acme.gateway',
            name: 'Gateway',
            provider: 'custom',
            category: 'Networking',
            defaultWidth: 150,
            defaultHeight: 90,
            style: SCRIPT_V1_DEFAULT_STYLE,
          },
        ],
      });

      const parsed = parseComponentSet(validJson);
      expect(parsed.id).toBe('acme.cloud');

      // Duplicate JSON key
      const dupJson =
        '{"id":"acme.cloud","id":"dup","name":"Acme","version":"1.0.0","components":[]}';
      try {
        parseComponentSet(dupJson);
        expect.unreachable('Should have rejected duplicate JSON key');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('DUPLICATE_JSON_KEY');
      }

      // Comments in JSON
      try {
        parseComponentSet('{"id":"acme.cloud", /* comment */ "name":"Acme","version":"1.0.0","components":[]}');
        expect.unreachable('Should have rejected comments in ComponentSet JSON');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('JSON_SYNTAX');
      }

      // Non-namespaced or colon-namespaced component types
      for (const badType of ['gateway', 'acme.cloud:gateway', 'custom.onlyone']) {
        const badTypeJson = JSON.stringify({
          id: 'acme.cloud',
          name: 'Acme Cloud',
          version: '1.0.0',
          components: [
            {
              type: badType,
              name: 'Gateway',
              provider: 'custom',
              category: 'Networking',
              defaultWidth: 150,
              defaultHeight: 90,
              style: SCRIPT_V1_DEFAULT_STYLE,
            },
          ],
        });
        try {
          parseComponentSet(badTypeJson);
          expect.unreachable(`Should have rejected invalid component.type "${badType}"`);
        } catch (err) {
          expect((err as DomainValidationError).issues[0]?.code).toBe(
            'INVALID_COMPONENT_TYPE_NAMESPACE',
          );
        }
      }
    });
  });

  describe('S2-C07 & S2-C14: Safe SVG Icon Tree parser and fallback resolver', () => {
    it('parses valid safe SVG icons with all allowed tags, path commands, and standard XML/numeric entities', () => {
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="&#35;1f2937" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">',
        '  <g fill="none" stroke="currentColor">',
        '    <rect x="2" y="2" width="20" height="20" rx="3" ry="3"/>',
        '    <circle cx="12" cy="12" r="4"/>',
        '    <ellipse cx="12" cy="12" rx="6" ry="3"/>',
        '    <line x1="2" y1="12" x2="22" y2="12"/>',
        '    <polyline points="4,8 12,4 20,8"/>',
        '    <polygon points="12,6 16,18 8,18" fill-rule="evenodd"/>',
        '    <path d="M4 12 L8 12 H12 V16 C12 18 14 18 16 16 Q18 14 20 12 Z" fill-rule="nonzero"/>',
        '  </g>',
        '</svg>',
      ].join('\n');

      const res = parseSafeIconSvg(svg);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.tree.tag).toBe('svg');
      expect(res.tree.xmlns).toBe(SVG_NAMESPACE);
      expect(res.tree.viewBox).toBe('0 0 24 24');
      expect(res.tree.parsedViewBox).toEqual({
        minX: 0,
        minY: 0,
        width: 24,
        height: 24,
      });
      expect(res.tree.attributes['stroke']).toBe('#1f2937');
      expect(res.tree.children).toHaveLength(1);
      expect(res.tree.children[0]?.children).toHaveLength(7);

      const validatedTree = validateSafeIconSvg(svg);
      expect(validatedTree).toEqual(res.tree);
    });

    it('rejects XSS, external refs, malformed transforms, unsupported tags and entity-encoded external url()', () => {
      const forbiddenCases: Array<{ name: string; svg: string; expectedCode: string }> = [
        {
          name: 'script tag',
          svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
          expectedCode: 'ICON_TAG_FORBIDDEN',
        },
        {
          name: 'event handler attribute',
          svg: '<svg viewBox="0 0 24 24" onload="alert(1)"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'style attribute',
          svg: '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10" style="fill:red"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'malformed transform attribute',
          svg: '<svg viewBox="0 0 24 24"><g transform="rotate(calc(45))"><rect x="0" y="0" width="10" height="10"/></g></svg>',
          expectedCode: 'ICON_ATTRIBUTE_VALUE_INVALID',
        },
        {
          name: 'href / xlink:href',
          svg: '<svg viewBox="0 0 24 24"><path d="M0 0L10 10" href="https://evil.example/x.svg"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'root width/height attributes outside policy',
          svg: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'stroke-dasharray attribute outside policy',
          svg: '<svg viewBox="0 0 24 24"><g stroke-dasharray="2, 2"><rect x="0" y="0" width="10" height="10"/></g></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'clip-rule attribute outside policy',
          svg: '<svg viewBox="0 0 24 24"><path d="M0 0L10 10" clip-rule="nonzero"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_FORBIDDEN',
        },
        {
          name: 'named color transparent outside policy',
          svg: '<svg viewBox="0 0 24 24"><g fill="transparent"><rect x="0" y="0" width="10" height="10"/></g></svg>',
          expectedCode: 'ICON_ATTRIBUTE_VALUE_INVALID',
        },
        {
          name: 'nested svg tag',
          svg: '<svg viewBox="0 0 24 24"><svg viewBox="0 0 10 10"><rect x="0" y="0" width="5" height="5"/></svg></svg>',
          expectedCode: 'ICON_NESTED_SVG_FORBIDDEN',
        },
        {
          name: 'DOCTYPE declaration',
          svg: '<!DOCTYPE svg><svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_DOCTYPE_FORBIDDEN',
        },
        {
          name: 'ENTITY declaration',
          svg: '<!DOCTYPE svg [<!ENTITY xxe "boom">]><svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_DOCTYPE_FORBIDDEN',
        },
        {
          name: 'XML declaration / processing instruction',
          svg: '<?xml version="1.0"?><svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_PI_FORBIDDEN',
        },
        {
          name: 'unknown namespace prefix',
          svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_NAMESPACE_FORBIDDEN',
        },
        {
          name: 'entity-encoded url() in paint attribute',
          svg: '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10" fill="&#117;rl(https://evil.example/a)"/></svg>',
          expectedCode: 'ICON_ATTRIBUTE_VALUE_INVALID',
        },
        {
          name: 'invalid path arc flag',
          svg: '<svg viewBox="0 0 24 24"><path d="M4 12 A 4 4 0 2 1 12 12"/></svg>',
          expectedCode: 'ICON_INVALID_PATH',
        },
        {
          name: 'non-whitespace text content',
          svg: '<svg viewBox="0 0 24 24"><g>Hello</g></svg>',
          expectedCode: 'ICON_TEXT_FORBIDDEN',
        },
        {
          name: 'non-positive viewBox width',
          svg: '<svg viewBox="0 0 0 24"><rect x="0" y="0" width="10" height="10"/></svg>',
          expectedCode: 'ICON_INVALID_VIEWBOX',
        },
      ];

      for (const tc of forbiddenCases) {
        const res = parseSafeIconSvg(tc.svg);
        expect(res.ok, `Expected ${tc.name} to fail`).toBe(false);
        if (!res.ok) {
          expect(res.code, `Mismatch code for ${tc.name}`).toBe(tc.expectedCode);
        }
      }
    });

    it('enforces element count, nesting depth, and numeric value limits on SVG icons', () => {
      // Depth > 16 (root svg is depth 1, 16 nested <g> reaches depth 17)
      const openG = '<g>'.repeat(ICON_LIMITS.MAX_ICON_DEPTH);
      const closeG = '</g>'.repeat(ICON_LIMITS.MAX_ICON_DEPTH);
      const deepSvg = `<svg viewBox="0 0 24 24">${openG}<rect x="0" y="0" width="10" height="10"/>${closeG}</svg>`;
      const deepRes = parseSafeIconSvg(deepSvg);
      expect(deepRes.ok).toBe(false);
      if (!deepRes.ok) {
        expect(deepRes.code).toBe('LIMIT_EXCEEDED');
      }

      // Element count > 256
      const manyRects = '<rect x="1" y="1" width="2" height="2"/>'.repeat(
        ICON_LIMITS.MAX_ICON_ELEMENTS,
      );
      const manyElemSvg = `<svg viewBox="0 0 24 24">${manyRects}</svg>`;
      const manyElemRes = parseSafeIconSvg(manyElemSvg);
      expect(manyElemRes.ok).toBe(false);
      if (!manyElemRes.ok) {
        expect(manyElemRes.code).toBe('LIMIT_EXCEEDED');
      }

      // Coordinate magnitude > 1,000,000
      const hugeCoordSvg =
        '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="2000000" height="10"/></svg>';
      const hugeCoordRes = parseSafeIconSvg(hugeCoordSvg);
      expect(hugeCoordRes.ok).toBe(false);
      if (!hugeCoordRes.ok) {
        expect(hugeCoordRes.code).toBe('ICON_ATTRIBUTE_VALUE_INVALID');
      }
    });

    it('returns GENERIC_FALLBACK_ICON_TREE with a structured warning when resolveCatalogIcon encounters unsupported decorative SVG', () => {
      const decorativeSvg =
        '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="url(#missing)"/></svg>';

      const resolved = resolveCatalogIcon(decorativeSvg);
      expect(resolved.isFallback).toBe(true);
      expect(resolved.tree).toEqual(GENERIC_FALLBACK_ICON_TREE);
      expect(resolved.warning).toBeDefined();
      expect(resolved.warning?.code).toBe('ICON_REFERENCE_INVALID');

      // Missing/empty iconSvg resolves to generic fallback without warning
      const resolvedEmpty = resolveCatalogIcon(undefined);
      expect(resolvedEmpty.isFallback).toBe(true);
      expect(resolvedEmpty.tree).toEqual(GENERIC_FALLBACK_ICON_TREE);
      expect(resolvedEmpty.warning).toBeUndefined();
    });

    it('enforces CATALOG_LIMITS on custom component sets (aliases, widgets, select options)', () => {
      const tooManyAliases = Array.from(
        { length: CATALOG_LIMITS.MAX_ALIASES_PER_DEFINITION + 1 },
        (_, i) => `alias-${i}`,
      );

      const badSet: ComponentSet = {
        id: 'custom.limits',
        name: 'Limits',
        version: '1.0.0',
        components: [
          {
            type: 'custom.limits.node',
            name: 'Node',
            provider: 'custom',
            category: 'Test',
            aliases: tooManyAliases,
            defaultWidth: 100,
            defaultHeight: 80,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
          },
        ],
      };

      try {
        validateComponentSet(badSet);
        expect.unreachable('Should have rejected excessive aliases');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('LIMIT_EXCEEDED');
      }

      const tooManyOptions = Array.from(
        { length: CATALOG_LIMITS.MAX_OPTIONS_PER_SELECT_WIDGET + 1 },
        (_, i) => `opt-${i}`,
      );
      const badOptionsSet: ComponentSet = {
        id: 'custom.limits',
        name: 'Limits',
        version: '1.0.0',
        components: [
          {
            type: 'custom.limits.node',
            name: 'Node',
            provider: 'custom',
            category: 'Test',
            defaultWidth: 100,
            defaultHeight: 80,
            style: { ...SCRIPT_V1_DEFAULT_STYLE },
            widgets: [
              {
                key: 'mode',
                label: 'Mode',
                kind: 'select',
                options: tooManyOptions,
              },
            ],
          },
        ],
      };

      try {
        validateComponentSet(badOptionsSet);
        expect.unreachable('Should have rejected excessive select options');
      } catch (err) {
        expect((err as DomainValidationError).issues[0]?.code).toBe('LIMIT_EXCEEDED');
      }
    });
  });
});
