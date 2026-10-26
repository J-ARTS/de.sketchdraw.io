import type { ComponentDefinition, ComponentSet, ElementStyle, SketchElement } from '../domain/types';
import { AWS_GROUP_GLYPHS } from './aws-group-glyphs';
import { deepFreezeComponentSet } from './builtin';

/**
 * AWS group frames as in draw.io's "AWS / Groups" palette (`mxgraph.aws4.group`, #143).
 * A group is an ordinary `container` element; the metadata key below selects the look. Without the registry
 * (older app versions) it still renders as a framed container, because stroke, fill and dash live in its style.
 */
export const GROUP_METADATA_KEY = 'sketchdraw.group';
export const AWS_GROUP_SET_ID = 'sketchdraw.aws.gruppen-rahmen';
export const AWS_GROUP_CATEGORY = 'Gruppen';

/** draw.io draws group chrome for 12 px text; sizes scale with the element's font size. */
export const GROUP_BASE_FONT_SIZE = 12;
export const GROUP_DEFAULT_FONT_SIZE = 16;
const ICON_SIZE = 25;
const LABEL_LEFT = 32;
const LABEL_PADDING = 4;
/** Center of the first label line below the top edge (draw.io `verticalAlign=top` with default spacing). */
const LABEL_CENTER_Y = 14;
const LABEL_LINE_HEIGHT = 1.25;

/**
 * start: header tile top left, label next to it. center: tile centered, label below it. plain: no tile, label on top.
 */
export type GroupLayout = 'start' | 'center' | 'plain';

export interface AwsGroup {
  id: string;
  /** Palette name. */
  name: string;
  /** Initial text of a new group. */
  label: string;
  layout: GroupLayout;
  /** Frame and header tile color. */
  stroke: string;
  /** `transparent` for none. */
  fill: string;
  /** draw.io `grStroke`: false leaves out the frame (the fill and the tile remain). */
  frame: boolean;
  dashed: boolean;
  labelColor: string;
  /** draw.io `grIcon` of icon groups; plain rectangles have none. */
  drawioIcon: string | null;
  aliases: readonly string[];
}

const NONE = 'transparent';

/** Aliases are ID-like in the catalog contract: ASCII letters, digits, ".", "_", ":" and "-". */
function aliasId(alias: string): string {
  return alias.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
}

function group(value: Omit<AwsGroup, 'label'> & { label?: string }): AwsGroup {
  return Object.freeze({ ...value, label: value.label ?? value.name, aliases: Object.freeze([...value.aliases]) });
}

/** Same order and colors as draw.io (Sidebar-AWS4.js, `addAWS4GroupsPalette`). */
export const AWS_GROUPS: readonly AwsGroup[] = Object.freeze([
  group({ id: 'aws.group.cloud-alt', name: 'AWS Cloud', layout: 'start', stroke: '#232F3E', fill: NONE, frame: true, dashed: false, labelColor: '#232F3E', drawioIcon: 'mxgraph.aws4.group_aws_cloud_alt', aliases: ['Cloud', 'AWS Cloud Symbol'] }),
  group({ id: 'aws.group.cloud', name: 'AWS Cloud (Logo)', label: 'AWS Cloud', layout: 'start', stroke: '#232F3E', fill: NONE, frame: true, dashed: false, labelColor: '#232F3E', drawioIcon: 'mxgraph.aws4.group_aws_cloud', aliases: ['Cloud', 'AWS Cloud Logo'] }),
  group({ id: 'aws.group.region', name: 'Region', layout: 'start', stroke: '#00A4A6', fill: NONE, frame: true, dashed: true, labelColor: '#147EBA', drawioIcon: 'mxgraph.aws4.group_region', aliases: ['AWS Region'] }),
  group({ id: 'aws.group.availability-zone', name: 'Availability Zone', layout: 'plain', stroke: '#147EBA', fill: NONE, frame: true, dashed: true, labelColor: '#147EBA', drawioIcon: null, aliases: ['AZ', 'Verfügbarkeitszone'] }),
  group({ id: 'aws.group.security-group', name: 'Security group', layout: 'plain', stroke: '#DD3522', fill: NONE, frame: true, dashed: false, labelColor: '#DD3522', drawioIcon: null, aliases: ['Sicherheitsgruppe'] }),
  group({ id: 'aws.group.auto-scaling-group', name: 'Auto Scaling group', layout: 'center', stroke: '#D86613', fill: NONE, frame: true, dashed: true, labelColor: '#D86613', drawioIcon: 'mxgraph.aws4.group_auto_scaling_group', aliases: ['Auto Scaling', 'ASG'] }),
  group({ id: 'aws.group.vpc', name: 'VPC', layout: 'start', stroke: '#8C4FFF', fill: NONE, frame: true, dashed: false, labelColor: '#AAB7B8', drawioIcon: 'mxgraph.aws4.group_vpc2', aliases: ['Virtual private cloud', 'Netzwerk'] }),
  group({ id: 'aws.group.private-subnet', name: 'Private subnet', layout: 'start', stroke: '#00A4A6', fill: '#E6F6F7', frame: false, dashed: false, labelColor: '#147EBA', drawioIcon: 'mxgraph.aws4.group_security_group', aliases: ['Subnet', 'Subnetz'] }),
  group({ id: 'aws.group.public-subnet', name: 'Public subnet', layout: 'start', stroke: '#7AA116', fill: '#F2F6E8', frame: false, dashed: false, labelColor: '#248814', drawioIcon: 'mxgraph.aws4.group_security_group', aliases: ['Subnet', 'Subnetz'] }),
  group({ id: 'aws.group.server-contents', name: 'Server contents', layout: 'start', stroke: '#7D8998', fill: NONE, frame: true, dashed: false, labelColor: '#5A6C86', drawioIcon: 'mxgraph.aws4.group_on_premise', aliases: ['On-premises', 'Server'] }),
  group({ id: 'aws.group.corporate-data-center', name: 'Corporate data center', layout: 'start', stroke: '#7D8998', fill: NONE, frame: true, dashed: false, labelColor: '#5A6C86', drawioIcon: 'mxgraph.aws4.group_corporate_data_center', aliases: ['Rechenzentrum', 'Data center'] }),
  group({ id: 'aws.group.elastic-beanstalk', name: 'Elastic Beanstalk container', layout: 'start', stroke: '#D86613', fill: NONE, frame: true, dashed: false, labelColor: '#D86613', drawioIcon: 'mxgraph.aws4.group_elastic_beanstalk', aliases: ['Beanstalk'] }),
  group({ id: 'aws.group.ec2-instance-contents', name: 'EC2 instance contents', layout: 'start', stroke: '#D86613', fill: NONE, frame: true, dashed: false, labelColor: '#D86613', drawioIcon: 'mxgraph.aws4.group_ec2_instance_contents', aliases: ['EC2', 'Instance'] }),
  group({ id: 'aws.group.spot-fleet', name: 'Spot Fleet', layout: 'start', stroke: '#D86613', fill: NONE, frame: true, dashed: false, labelColor: '#D86613', drawioIcon: 'mxgraph.aws4.group_spot_fleet', aliases: ['Spot'] }),
  group({ id: 'aws.group.step-functions', name: 'AWS Step Functions workflow', layout: 'start', stroke: '#CD2264', fill: NONE, frame: true, dashed: false, labelColor: '#CD2264', drawioIcon: 'mxgraph.aws4.group_aws_step_functions_workflow', aliases: ['Step Functions', 'Workflow'] }),
  group({ id: 'aws.group.account', name: 'AWS Account', layout: 'start', stroke: '#CD2264', fill: NONE, frame: true, dashed: false, labelColor: '#CD2264', drawioIcon: 'mxgraph.aws4.group_account', aliases: ['Account', 'Konto'] }),
  group({ id: 'aws.group.iot-greengrass-deployment', name: 'AWS IoT Greengrass Deployment', layout: 'start', stroke: '#7AA116', fill: NONE, frame: true, dashed: false, labelColor: '#3F8624', drawioIcon: 'mxgraph.aws4.group_iot_greengrass_deployment', aliases: ['Greengrass', 'IoT'] }),
  group({ id: 'aws.group.iot-greengrass', name: 'AWS IoT Greengrass', layout: 'start', stroke: '#7AA116', fill: NONE, frame: true, dashed: false, labelColor: '#3F8624', drawioIcon: 'mxgraph.aws4.group_iot_greengrass', aliases: ['Greengrass', 'IoT'] }),
  group({ id: 'aws.group.generic-dashed', name: 'Generic group', layout: 'plain', stroke: '#5A6C86', fill: NONE, frame: true, dashed: true, labelColor: '#5A6C86', drawioIcon: null, aliases: ['Gruppe', 'Container', 'Rahmen'] }),
  group({ id: 'aws.group.generic-filled', name: 'Generic group (filled)', label: 'Generic group', layout: 'plain', stroke: '#EFF0F3', fill: '#EFF0F3', frame: false, dashed: false, labelColor: '#232F3D', drawioIcon: null, aliases: ['Gruppe', 'Container', 'Fläche'] }),
]);

const BY_ID = new Map(AWS_GROUPS.map((entry) => [entry.id, entry]));
const BY_DRAWIO_ICON = new Map<string, AwsGroup[]>();
for (const entry of AWS_GROUPS) if (entry.drawioIcon) BY_DRAWIO_ICON.set(entry.drawioIcon, [...(BY_DRAWIO_ICON.get(entry.drawioIcon) ?? []), entry]);

export function awsGroupById(id: string | undefined): AwsGroup | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

/** The group a container element represents, if its metadata names a known one. */
export function awsGroupOf(element: Pick<SketchElement, 'kind' | 'metadata'> | undefined): AwsGroup | undefined {
  return element?.kind === 'container' ? awsGroupById(element.metadata?.[GROUP_METADATA_KEY]) : undefined;
}

/** The group for a draw.io `grIcon`. Private and public subnet share one icon, so the frame color decides. */
export function awsGroupByDrawioIcon(icon: string, strokeColor?: string): AwsGroup | undefined {
  const candidates = BY_DRAWIO_ICON.get(icon);
  if (!candidates) return undefined;
  return candidates.find((entry) => entry.stroke.toLowerCase() === strokeColor?.toLowerCase()) ?? candidates[0];
}

/** Style of a new group; the colors are draw.io's, the font size scales the header chrome. */
export function awsGroupStyle(entry: AwsGroup): ElementStyle {
  return {
    stroke: entry.stroke,
    fill: entry.fill,
    textColor: entry.labelColor,
    strokeWidth: entry.frame ? 1 : 0,
    opacity: 1,
    fontSize: GROUP_DEFAULT_FONT_SIZE,
    textAlign: entry.layout === 'start' ? 'left' : 'center',
    strokeDash: entry.dashed ? 'dashed' : 'solid',
    fontFamily: 'sans',
  };
}

export interface GroupChrome {
  /** Header tile in element coordinates, or null for plain rectangles. */
  icon: { x: number; y: number; size: number } | null;
  /** Horizontal extent available to the label and the top of its first line. */
  label: { left: number; right: number; top: number };
}

/** Geometry of the header for a group of the given width and font size. */
export function groupChrome(entry: AwsGroup, width: number, fontSize: number): GroupChrome {
  const k = fontSize / GROUP_BASE_FONT_SIZE;
  const size = ICON_SIZE * k;
  const centerY = (entry.layout === 'center' ? ICON_SIZE : 0) + LABEL_CENTER_Y;
  const left = entry.layout === 'start' ? LABEL_LEFT * k : LABEL_PADDING * k;
  return {
    icon: entry.layout === 'plain' ? null : { x: entry.layout === 'center' ? (width - size) / 2 : 0, y: 0, size },
    label: { left: Math.min(left, width), right: Math.max(Math.min(left, width), width - LABEL_PADDING * k), top: centerY * k - fontSize * LABEL_LINE_HEIGHT / 2 },
  };
}

/** The header tile as a standalone SVG: a square in the group color with the white glyph on it. */
export function groupTileSvg(entry: AwsGroup, tileColor: string): string {
  const glyph = AWS_GROUP_GLYPHS[entry.id] ?? '';
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="40" height="40" fill="${tileColor}"></rect>${glyph}</svg>`;
}

/** Dashed square outline as separate segments, since icons may not use `stroke-dasharray`. */
function dashedOutline(inset: number, size: number, dash: number, gap: number): string {
  const edge = size - inset * 2;
  const parts: string[] = [];
  for (let at = 0; at < edge; at += dash + gap) {
    const length = Math.min(dash, edge - at);
    parts.push(`M${inset + at} ${inset}h${length}`, `M${inset + at} ${inset + edge}h${length}`, `M${inset} ${inset + at}v${length}`, `M${inset + edge} ${inset + at}v${length}`);
  }
  return parts.join('');
}

/** Small picture of a group for the library: frame, fill and header tile. */
export function groupPreviewSvg(entry: AwsGroup): string {
  const fill = entry.fill === NONE ? 'none' : entry.fill;
  const body: string[] = [];
  if (fill !== 'none') body.push(`<rect x="1" y="1" width="38" height="38" fill="${fill}"></rect>`);
  if (entry.frame) {
    body.push(entry.dashed
      ? `<path d="${dashedOutline(1.5, 40, 4, 3)}" fill="none" stroke="${entry.stroke}" stroke-width="3"></path>`
      : `<rect x="1.5" y="1.5" width="37" height="37" fill="none" stroke="${entry.stroke}" stroke-width="3"></rect>`);
  }
  const glyph = AWS_GROUP_GLYPHS[entry.id];
  if (glyph && entry.layout !== 'plain') {
    const x = entry.layout === 'center' ? 12.5 : 0;
    body.push(`<g transform="translate(${x} 0) scale(.375)"><rect x="0" y="0" width="40" height="40" fill="${entry.stroke}"></rect>${glyph}</g>`);
  }
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${body.join('')}</svg>`;
}

export const AWS_GROUP_DEFAULT_SIZE = Object.freeze({ width: 360, height: 320 });

function definitionOf(entry: AwsGroup): ComponentDefinition {
  return {
    type: entry.id,
    name: entry.name,
    provider: 'aws',
    category: AWS_GROUP_CATEGORY,
    aliases: [...new Set([...entry.aliases, 'Gruppe', 'Group', 'Container', 'Rahmen'].map(aliasId).filter(Boolean))],
    defaultWidth: AWS_GROUP_DEFAULT_SIZE.width,
    defaultHeight: AWS_GROUP_DEFAULT_SIZE.height,
    style: awsGroupStyle(entry),
    metadata: { [GROUP_METADATA_KEY]: entry.id, provenance: 'drawio-aws4-group-style' },
    iconSvg: groupPreviewSvg(entry),
  };
}

/** The group frames as a component set for the AWS library; placing one creates a container (see `instantiateComponent`). */
export function createAwsGroupComponentSet(): ComponentSet {
  return deepFreezeComponentSet({ id: AWS_GROUP_SET_ID, name: 'AWS · Gruppen (Rahmen)', version: '1.0.0', components: AWS_GROUPS.map(definitionOf) });
}

/** Inserts the group frames before the AWS "Gruppen" icons, so they lead that category of the library. */
export function withAwsGroupSet(sets: readonly ComponentSet[]): ComponentSet[] {
  const groups = createAwsGroupComponentSet();
  const at = sets.findIndex((set) => set.id === 'sketchdraw.aws.gruppen');
  return at === -1 ? [...sets, groups] : [...sets.slice(0, at), groups, ...sets.slice(at)];
}
