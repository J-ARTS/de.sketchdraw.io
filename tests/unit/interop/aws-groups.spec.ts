import { describe, expect, test } from 'vitest';
import { AWS_GROUPS, GROUP_METADATA_KEY, awsGroupOf, awsGroupStyle } from '@/catalog';
import { applyCommand, createDocument, createElement } from '@/domain';
import { importDrawio, prepareDrawioExport, prepareSvgExport } from '@/interop';

function groupElement(id: string, groupId: string, extra: Record<string, unknown> = {}) {
  const group = AWS_GROUPS.find((entry) => entry.id === groupId)!;
  return createElement('container', { id, x: 100, y: 80, width: 360, height: 320, text: group.label, style: awsGroupStyle(group), metadata: { [GROUP_METADATA_KEY]: group.id }, ...extra });
}

function documentWith(...elements: ReturnType<typeof createElement>[]) {
  return applyCommand(createDocument('Netz'), { type: 'add', elements });
}

describe('AWS group frames in draw.io and SVG', () => {
  test('exports icon groups as draw.io `mxgraph.aws4.group` containers with their child inside', () => {
    const doc = documentWith(
      groupElement('vpc', 'aws.group.vpc'),
      createElement('rectangle', { id: 'server', parentId: 'vpc', x: 140, y: 140, width: 80, height: 40, text: 'Web' }),
    );
    const xml = prepareDrawioExport(doc, { embedDocument: false }).contents;
    const cell = xml.match(/<mxCell[^>]*value="VPC"[^>]*>/)![0];
    for (const token of ['container=1', 'shape=mxgraph.aws4.group;', 'grIcon=mxgraph.aws4.group_vpc2', 'strokeColor=#8c4fff', 'fillColor=transparent', 'fontColor=#aab7b8', 'pointerEvents=0', 'collapsible=0', 'grIconSize=33.33', 'spacingLeft=40']) expect(cell, token).toContain(token);
    expect(cell).toContain('dashed=0');
    expect(xml).toMatch(/<mxCell[^>]*parent="sd-0"[^>]*value="Web"/);
  });

  test('exports the centered Auto Scaling group, dashed frames and fill-only subnets', () => {
    const xml = prepareDrawioExport(documentWith(
      groupElement('asg', 'aws.group.auto-scaling-group'),
      groupElement('subnet', 'aws.group.private-subnet'),
      groupElement('zone', 'aws.group.availability-zone'),
      groupElement('filled', 'aws.group.generic-filled'),
    ), { embedDocument: false }).contents;
    const cell = (text: string) => xml.match(new RegExp(`<mxCell[^>]*value="${text}"[^>]*>`))![0];
    expect(cell('Auto Scaling group')).toContain('shape=mxgraph.aws4.groupCenter');
    expect(cell('Auto Scaling group')).toContain('dashed=1');
    expect(cell('Auto Scaling group')).toContain('dashPattern=3 3');
    expect(cell('Auto Scaling group')).toContain('spacingTop=33.33');
    expect(cell('Private subnet')).toContain('grStroke=0');
    expect(cell('Private subnet')).toContain('fillColor=#e6f6f7');
    expect(cell('Availability Zone')).not.toContain('shape=');
    expect(cell('Availability Zone')).toContain('sketchdrawGroup=aws.group.availability-zone');
    expect(cell('Generic group')).toContain('strokeColor=none');
  });

  test('every group survives a portable draw.io export and import without the embedded model', () => {
    const doc = documentWith(...AWS_GROUPS.map((group, index) => groupElement(`g${index}`, group.id, { x: index * 20, y: index * 20 })));
    const result = importDrawio(prepareDrawioExport(doc, { embedDocument: false }).contents);
    expect(result.document.elements).toHaveLength(20);
    result.document.elements.forEach((element, index) => {
      const group = AWS_GROUPS[index]!;
      expect(awsGroupOf(element)?.id, group.name).toBe(group.id);
      expect(element.kind).toBe('container');
      const expected = awsGroupStyle(group);
      expect(element.style, group.name).toMatchObject({ stroke: group.layout === 'plain' && !group.frame ? 'transparent' : group.stroke.toLowerCase(), fill: expected.fill.toLowerCase(), strokeWidth: expected.strokeWidth, textColor: group.labelColor.toLowerCase(), strokeDash: expected.strokeDash, fontSize: 16 });
    });
    expect(result.diagnostics.filter((diag) => diag.code === 'STYLE_APPROXIMATED' || diag.code === 'UNSUPPORTED_SHAPE')).toEqual([]);
  });

  test('imports a group copied from draw.io exactly as draw.io draws it', () => {
    const xml = `<mxfile><diagram id="p" name="Netz"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="2" value="VPC" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#AAB7B8;dashed=0;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="260" height="200" as="geometry"/></mxCell>
<mxCell id="3" value="Private subnet" style="outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#00A4A6;fillColor=#E6F6F7;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=0;" vertex="1" parent="2"><mxGeometry x="20" y="40" width="120" height="120" as="geometry"/></mxCell>
<mxCell id="4" value="Region" style="outlineConnect=0;html=1;fontSize=12;container=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;strokeColor=#00A4A6;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=1;" vertex="1" parent="1"><mxGeometry x="400" y="80" width="130" height="130" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;
    const { document: doc, diagnostics } = importDrawio(xml);
    const [vpc, subnet, region] = doc.elements;
    expect(vpc).toMatchObject({ kind: 'container', x: 80, y: 80, width: 260, height: 200, text: 'VPC', metadata: { [GROUP_METADATA_KEY]: 'aws.group.vpc' }, style: { stroke: '#8c4fff', fill: 'transparent', textColor: '#aab7b8', fontSize: 12, strokeWidth: 1, strokeDash: 'solid', textAlign: 'left' } });
    expect(subnet).toMatchObject({ parentId: vpc!.id, x: 100, y: 120, metadata: { [GROUP_METADATA_KEY]: 'aws.group.private-subnet' }, style: { stroke: '#00a4a6', fill: '#e6f6f7', strokeWidth: 0, textColor: '#147eba' } });
    expect(region).toMatchObject({ metadata: { [GROUP_METADATA_KEY]: 'aws.group.region' }, style: { strokeDash: 'dashed', stroke: '#00a4a6' } });
    // Only the HTML label of the foreign file is reported; the group-specific styles are understood.
    expect(diagnostics.filter((diag) => diag.code === 'STYLE_APPROXIMATED' || diag.code === 'UNSUPPORTED_SHAPE')).toEqual([]);
  });

  test('an unknown draw.io group icon stays an editable rectangle with a warning', () => {
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="X" style="shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_unknown;strokeColor=#000000;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell></root></mxGraphModel>`;
    const { document: doc, diagnostics } = importDrawio(xml);
    expect(awsGroupOf(doc.elements[0])).toBeUndefined();
    expect(diagnostics.some((diag) => diag.code === 'UNSUPPORTED_SHAPE')).toBe(true);
  });

  test('the SVG shows the header tile and puts the label next to it', () => {
    const svg = prepareSvgExport(documentWith(groupElement('vpc', 'aws.group.vpc')), { embedDocument: false }).contents;
    expect(svg).toContain('fill="#8c4fff"');
    expect(svg).toMatch(/<svg[^>]*width="33\.33[^>]*height="33\.33/);
    expect(svg).toMatch(/<tspan x="42\.66[^>]*>VPC<\/tspan>/);
    const plain = prepareSvgExport(documentWith(groupElement('zone', 'aws.group.availability-zone')), { embedDocument: false }).contents;
    expect(plain).not.toMatch(/<svg[^>]*width="33/);
  });
});
