import { describe, expect, it } from 'vitest';
import {
  AWS_GROUPS,
  AWS_GROUP_SET_ID,
  GROUP_METADATA_KEY,
  awsGroupByDrawioIcon,
  awsGroupById,
  awsGroupOf,
  createAwsGroupComponentSet,
  groupChrome,
  groupPreviewSvg,
  groupTileSvg,
  instantiateComponent,
  parseSafeIconSvg,
  searchCatalogComponents,
  validateComponentSet,
  withAwsGroupSet,
} from '../../../src/catalog';
import aws from '../../../src/catalog/official/aws.json';
import { toOfficialComponentSets, type RawOfficialLibrary } from '../../../src/catalog/official-sets';
import { createDocument, validateDocument } from '../../../src/domain';

// Names, order and colors are those of draw.io's "AWS / Groups" palette (Sidebar-AWS4.js, addAWS4GroupsPalette).
const DRAWIO_ORDER = [
  'AWS Cloud', 'AWS Cloud (Logo)', 'Region', 'Availability Zone', 'Security group', 'Auto Scaling group', 'VPC', 'Private subnet', 'Public subnet',
  'Server contents', 'Corporate data center', 'Elastic Beanstalk container', 'EC2 instance contents', 'Spot Fleet', 'AWS Step Functions workflow',
  'AWS Account', 'AWS IoT Greengrass Deployment', 'AWS IoT Greengrass', 'Generic group', 'Generic group (filled)',
];

function document() {
  return validateDocument({ ...createDocument('Groups'), id: 'doc-groups' });
}

describe('AWS group frames', () => {
  it('lists the twenty draw.io groups in draw.io order with unique ids', () => {
    expect(AWS_GROUPS.map((group) => group.name)).toEqual(DRAWIO_ORDER);
    expect(new Set(AWS_GROUPS.map((group) => group.id)).size).toBe(20);
  });

  it('uses the draw.io colors and line styles', () => {
    const group = (name: string) => AWS_GROUPS.find((entry) => entry.name === name)!;
    expect(group('VPC')).toMatchObject({ stroke: '#8C4FFF', labelColor: '#AAB7B8', dashed: false, frame: true, fill: 'transparent', layout: 'start' });
    expect(group('Private subnet')).toMatchObject({ stroke: '#00A4A6', fill: '#E6F6F7', labelColor: '#147EBA', frame: false });
    expect(group('Public subnet')).toMatchObject({ stroke: '#7AA116', fill: '#F2F6E8', labelColor: '#248814', frame: false });
    expect(group('Region')).toMatchObject({ stroke: '#00A4A6', dashed: true, labelColor: '#147EBA' });
    expect(group('Availability Zone')).toMatchObject({ stroke: '#147EBA', dashed: true, layout: 'plain', drawioIcon: null });
    expect(group('Security group')).toMatchObject({ stroke: '#DD3522', dashed: false, layout: 'plain' });
    expect(group('Auto Scaling group')).toMatchObject({ stroke: '#D86613', dashed: true, layout: 'center' });
    expect(group('Generic group')).toMatchObject({ stroke: '#5A6C86', dashed: true, layout: 'plain' });
    expect(group('Generic group (filled)')).toMatchObject({ fill: '#EFF0F3', frame: false, labelColor: '#232F3D' });
    for (const name of ['Elastic Beanstalk container', 'EC2 instance contents', 'Spot Fleet']) expect(group(name)).toMatchObject({ stroke: '#D86613', labelColor: '#D86613' });
    for (const name of ['AWS Step Functions workflow', 'AWS Account']) expect(group(name)).toMatchObject({ stroke: '#CD2264', labelColor: '#CD2264' });
  });

  it('maps every icon group to its draw.io shape and back', () => {
    for (const group of AWS_GROUPS) if (group.drawioIcon) expect(awsGroupByDrawioIcon(group.drawioIcon)?.layout === group.layout).toBe(true);
    expect(awsGroupByDrawioIcon('mxgraph.aws4.group_vpc2')?.id).toBe('aws.group.vpc');
    // Both subnets use the same icon; the frame color tells them apart.
    expect(awsGroupByDrawioIcon('mxgraph.aws4.group_security_group', '#7aa116')?.id).toBe('aws.group.public-subnet');
    expect(awsGroupByDrawioIcon('mxgraph.aws4.group_security_group', '#00A4A6')?.id).toBe('aws.group.private-subnet');
    expect(awsGroupByDrawioIcon('mxgraph.aws4.group_security_group')?.id).toBe('aws.group.private-subnet');
    expect(awsGroupByDrawioIcon('mxgraph.aws4.group_unknown')).toBeUndefined();
  });

  it('draws the header chrome like draw.io: 25 px tile and 30 px indent at 12 px text', () => {
    const vpc = awsGroupById('aws.group.vpc')!;
    const base = groupChrome(vpc, 130, 12);
    expect(base.icon).toEqual({ x: 0, y: 0, size: 25 });
    expect(base.label.left).toBe(32);
    expect(base.label.top).toBeCloseTo(6.5);
    const scaled = groupChrome(vpc, 360, 24);
    expect(scaled.icon?.size).toBe(50);
    expect(scaled.label.left).toBe(64);
    const center = groupChrome(awsGroupById('aws.group.auto-scaling-group')!, 130, 12);
    expect(center.icon).toEqual({ x: 52.5, y: 0, size: 25 });
    expect(center.label.top).toBeCloseTo(31.5);
    expect(groupChrome(awsGroupById('aws.group.generic-dashed')!, 130, 12).icon).toBeNull();
  });

  it('builds tiles and previews the icon parser accepts', () => {
    for (const group of AWS_GROUPS) {
      expect(parseSafeIconSvg(groupPreviewSvg(group)).ok, group.name).toBe(true);
      if (group.layout !== 'plain') expect(parseSafeIconSvg(groupTileSvg(group, group.stroke)).ok, group.name).toBe(true);
      else expect(groupTileSvg(group, group.stroke)).not.toContain('<path');
    }
  });

  it('forms a valid component set that the AWS library shows before the group icons', () => {
    const set = createAwsGroupComponentSet();
    expect(set.id).toBe(AWS_GROUP_SET_ID);
    expect(() => validateComponentSet(set)).not.toThrow();
    const library = withAwsGroupSet(toOfficialComponentSets(aws as unknown as RawOfficialLibrary));
    const ids = library.map((entry) => entry.id);
    expect(ids.indexOf(AWS_GROUP_SET_ID)).toBe(ids.indexOf('sketchdraw.aws.gruppen') - 1);
    expect(ids.indexOf(AWS_GROUP_SET_ID)).toBeGreaterThan(-1);
  });

  it('can be found by name and by German terms', () => {
    const set = createAwsGroupComponentSet();
    expect(searchCatalogComponents([set], 'vpc').map((hit) => hit.component.name)).toContain('VPC');
    expect(searchCatalogComponents([set], 'subnetz').map((hit) => hit.component.name)).toEqual(['Private subnet', 'Public subnet']);
    expect(searchCatalogComponents([set], 'rahmen')).toHaveLength(20);
  });

  it('places a group as a container with its look in the metadata', () => {
    const set = createAwsGroupComponentSet();
    const doc = document();
    const { element, command } = instantiateComponent(doc, { set, type: 'aws.group.vpc', id: 'group:1', at: { x: 40, y: 50 } });
    expect(element).toMatchObject({
      kind: 'container', x: 40, y: 50, text: 'VPC', label: 'VPC',
      style: { stroke: '#8C4FFF', fill: 'transparent', textColor: '#AAB7B8', strokeWidth: 1, strokeDash: 'solid', textAlign: 'left', fontSize: 16 },
      metadata: { [GROUP_METADATA_KEY]: 'aws.group.vpc' },
    });
    expect(element.componentType).toBeUndefined();
    expect(command.type).toBe('add');
    expect(awsGroupOf(element)?.id).toBe('aws.group.vpc');
  });

  it('keeps a custom label and nests a group in another group', () => {
    const set = createAwsGroupComponentSet();
    const outer = instantiateComponent(document(), { set, type: 'aws.group.region', id: 'group:region', at: { x: 0, y: 0 }, label: 'eu-central-1' });
    expect(outer.element.text).toBe('eu-central-1');
    const withOuter = validateDocument({ ...document(), elements: [outer.element] });
    const inner = instantiateComponent(withOuter, { set, type: 'aws.group.private-subnet', id: 'group:subnet', at: { x: 20, y: 40 }, parentId: 'group:region' });
    expect(inner.element.parentId).toBe('group:region');
    expect(inner.element.style).toMatchObject({ fill: '#E6F6F7', strokeWidth: 0 });
    expect(inner.element.text).toBe('Private subnet');
  });

  it('does not recognize an ordinary container or an unknown group id', () => {
    expect(awsGroupOf({ kind: 'container', metadata: { [GROUP_METADATA_KEY]: 'aws.group.unknown' } })).toBeUndefined();
    expect(awsGroupOf({ kind: 'container' })).toBeUndefined();
    expect(awsGroupOf({ kind: 'rectangle', metadata: { [GROUP_METADATA_KEY]: 'aws.group.vpc' } })).toBeUndefined();
  });
});
