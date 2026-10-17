import type {
  ComponentDefinition,
  ComponentSet,
  ElementStyle,
  Endpoint,
  Point,
  SketchAsset,
  SketchDocument,
  SketchElement,
} from './types';

export function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function resolveAnchorWorldPoint(target: SketchElement, anchor: Point): Point {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const dx = (anchor.x - 0.5) * target.width;
  const dy = (anchor.y - 0.5) * target.height;

  const normalizedAngle = ((target.rotation % 360) + 360) % 360;
  let cos: number;
  let sin: number;
  if (normalizedAngle === 0) {
    cos = 1;
    sin = 0;
  } else if (normalizedAngle === 90) {
    cos = 0;
    sin = 1;
  } else if (normalizedAngle === 180) {
    cos = -1;
    sin = 0;
  } else if (normalizedAngle === 270) {
    cos = 0;
    sin = -1;
  } else {
    const radians = (target.rotation * Math.PI) / 180;
    cos = Math.cos(radians);
    sin = Math.sin(radians);
  }

  return {
    x: normalizeZero(cx + dx * cos - dy * sin),
    y: normalizeZero(cy + dx * sin + dy * cos),
  };
}

export function worldToElementLocalPoint(element: SketchElement, world: Point): Point {
  const normalizedAngle = ((element.rotation % 360) + 360) % 360;
  if (normalizedAngle === 0) {
    return {
      x: normalizeZero(world.x - element.x),
      y: normalizeZero(world.y - element.y),
    };
  }

  const halfW = element.width / 2;
  const halfH = element.height / 2;
  const wx = world.x - (element.x + halfW);
  const wy = world.y - (element.y + halfH);

  let cos: number;
  let sin: number;
  if (normalizedAngle === 90) {
    cos = 0;
    sin = 1;
  } else if (normalizedAngle === 180) {
    cos = -1;
    sin = 0;
  } else if (normalizedAngle === 270) {
    cos = 0;
    sin = -1;
  } else {
    const radians = (element.rotation * Math.PI) / 180;
    cos = Math.cos(radians);
    sin = Math.sin(radians);
  }

  return {
    x: normalizeZero(halfW + wx * cos + wy * sin),
    y: normalizeZero(halfH - wx * sin + wy * cos),
  };
}

export function syncConnectorEndpoints(
  connector: SketchElement,
  elementMap: ReadonlyMap<string, SketchElement>,
): SketchElement {
  if (
    connector.kind !== 'connector' ||
    !Array.isArray(connector.points) ||
    connector.points.length < 2
  ) {
    return connector;
  }

  let updatedPoints: Point[] | undefined;

  if (connector.from) {
    const fromTarget = elementMap.get(connector.from.elementId);
    if (fromTarget) {
      const world = resolveAnchorWorldPoint(fromTarget, connector.from.anchor);
      const local = worldToElementLocalPoint(connector, world);
      const firstPoint = connector.points[0];
      if (!firstPoint || firstPoint.x !== local.x || firstPoint.y !== local.y) {
        updatedPoints = connector.points.map(clonePoint);
        updatedPoints[0] = local;
      }
    }
  }

  if (connector.to) {
    const toTarget = elementMap.get(connector.to.elementId);
    if (toTarget) {
      const world = resolveAnchorWorldPoint(toTarget, connector.to.anchor);
      const local = worldToElementLocalPoint(connector, world);
      const lastIndex = connector.points.length - 1;
      const currentPoints = updatedPoints ?? connector.points;
      const lastPoint = currentPoints[lastIndex];
      if (!lastPoint || lastPoint.x !== local.x || lastPoint.y !== local.y) {
        if (!updatedPoints) {
          updatedPoints = connector.points.map(clonePoint);
        }
        updatedPoints[lastIndex] = local;
      }
    }
  }

  if (!updatedPoints) {
    return connector;
  }

  return {
    ...connector,
    points: updatedPoints,
  };
}

export function collectDescendantIds(
  elements: readonly SketchElement[],
  rootIds: Iterable<string>,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const el of elements) {
    if (el.parentId !== undefined) {
      let list = childrenByParent.get(el.parentId);
      if (!list) {
        list = [];
        childrenByParent.set(el.parentId, list);
      }
      list.push(el.id);
    }
  }

  const descendants = new Set<string>();
  const queue: string[] = [];
  for (const id of rootIds) {
    const children = childrenByParent.get(id);
    if (children) {
      for (const childId of children) {
        if (!descendants.has(childId)) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenByParent.get(current);
    if (children) {
      for (const childId of children) {
        if (!descendants.has(childId)) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  return descendants;
}

export function clonePoint(point: Point): Point {
  return {
    x: normalizeZero(point.x),
    y: normalizeZero(point.y),
  };
}

export function cloneEndpoint(endpoint: Endpoint): Endpoint {
  return {
    elementId: endpoint.elementId,
    anchor: clonePoint(endpoint.anchor),
  };
}

export function cloneStyle(style: ElementStyle): ElementStyle {
  const cloned: ElementStyle = {
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: normalizeZero(style.strokeWidth),
    opacity: normalizeZero(style.opacity),
    fontSize: normalizeZero(style.fontSize),
    textAlign: style.textAlign,
    strokeDash: style.strokeDash,
  };
  if (style.fontFamily !== undefined) {
    cloned.fontFamily = style.fontFamily;
  }
  return cloned;
}

export function clonePartialStyle(style: Partial<ElementStyle>): Partial<ElementStyle> {
  const cloned: Partial<ElementStyle> = {};
  if (style.stroke !== undefined) cloned.stroke = style.stroke;
  if (style.fill !== undefined) cloned.fill = style.fill;
  if (style.strokeWidth !== undefined) cloned.strokeWidth = normalizeZero(style.strokeWidth);
  if (style.opacity !== undefined) cloned.opacity = normalizeZero(style.opacity);
  if (style.fontSize !== undefined) cloned.fontSize = normalizeZero(style.fontSize);
  if (style.textAlign !== undefined) cloned.textAlign = style.textAlign;
  if (style.strokeDash !== undefined) cloned.strokeDash = style.strokeDash;
  if (style.fontFamily !== undefined) cloned.fontFamily = style.fontFamily;
  return cloned;
}

export function cloneStringRecord(record: Record<string, string>): Record<string, string> {
  const cloned: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value !== undefined) {
      cloned[key] = value;
    }
  }
  return cloned;
}

export function cloneElement(element: SketchElement): SketchElement {
  const cloned: SketchElement = {
    id: element.id,
    kind: element.kind,
    x: normalizeZero(element.x),
    y: normalizeZero(element.y),
    width: normalizeZero(element.width),
    height: normalizeZero(element.height),
    rotation: normalizeZero(element.rotation),
    style: cloneStyle(element.style),
  };
  if (element.label !== undefined) cloned.label = element.label;
  if (element.description !== undefined) cloned.description = element.description;
  if (element.text !== undefined) cloned.text = element.text;
  if (element.points !== undefined) cloned.points = element.points.map(clonePoint);
  if (element.assetId !== undefined) cloned.assetId = element.assetId;
  if (element.from !== undefined) cloned.from = cloneEndpoint(element.from);
  if (element.to !== undefined) cloned.to = cloneEndpoint(element.to);
  if (element.parentId !== undefined) cloned.parentId = element.parentId;
  if (element.componentType !== undefined) cloned.componentType = element.componentType;
  if (element.metadata !== undefined) cloned.metadata = cloneStringRecord(element.metadata);
  if (element.documentationUrl !== undefined) cloned.documentationUrl = element.documentationUrl;
  return cloned;
}

export function cloneAsset(asset: SketchAsset): SketchAsset {
  return {
    id: asset.id,
    mimeType: asset.mimeType,
    dataUrl: asset.dataUrl,
    name: asset.name,
  };
}

export function cloneComponentDefinition(def: ComponentDefinition): ComponentDefinition {
  const cloned: ComponentDefinition = {
    type: def.type,
    name: def.name,
    provider: def.provider,
    category: def.category,
    defaultWidth: normalizeZero(def.defaultWidth),
    defaultHeight: normalizeZero(def.defaultHeight),
    style: clonePartialStyle(def.style),
  };
  if (def.aliases !== undefined) cloned.aliases = [...def.aliases];
  if (def.metadata !== undefined) cloned.metadata = cloneStringRecord(def.metadata);
  if (def.documentationUrl !== undefined) cloned.documentationUrl = def.documentationUrl;
  if (def.iconSvg !== undefined) cloned.iconSvg = def.iconSvg;
  if (def.widgets !== undefined) {
    cloned.widgets = def.widgets.map((widget) => {
      const clonedWidget: {
        key: string;
        label: string;
        kind: 'text' | 'number' | 'select';
        options?: string[];
      } = {
        key: widget.key,
        label: widget.label,
        kind: widget.kind,
      };
      if (widget.options !== undefined) {
        clonedWidget.options = [...widget.options];
      }
      return clonedWidget;
    });
  }
  return cloned;
}

export function cloneComponentSet(set: ComponentSet): ComponentSet {
  return {
    id: set.id,
    name: set.name,
    version: set.version,
    components: set.components.map(cloneComponentDefinition),
  };
}

export function cloneDocument(doc: SketchDocument): SketchDocument {
  const assets: Record<string, SketchAsset> = {};
  for (const key of Object.keys(doc.assets)) {
    const asset = doc.assets[key];
    if (asset !== undefined) {
      assets[key] = cloneAsset(asset);
    }
  }
  return {
    schemaVersion: 1,
    id: doc.id,
    title: doc.title,
    elements: doc.elements.map(cloneElement),
    assets,
    componentSets: doc.componentSets.map(cloneComponentSet),
    metadata: cloneStringRecord(doc.metadata),
  };
}

export function arePointsEqual(a: readonly Point[] | undefined, b: readonly Point[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (pa.x !== pb.x || pa.y !== pb.y) return false;
  }
  return true;
}

export function areEndpointsEqual(a: Endpoint | undefined, b: Endpoint | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.elementId === b.elementId &&
    a.anchor.x === b.anchor.x &&
    a.anchor.y === b.anchor.y
  );
}

export function areStylesEqual(a: Partial<ElementStyle>, b: Partial<ElementStyle>): boolean {
  return (
    a.stroke === b.stroke &&
    a.fill === b.fill &&
    a.strokeWidth === b.strokeWidth &&
    a.opacity === b.opacity &&
    a.fontSize === b.fontSize &&
    a.textAlign === b.textAlign &&
    a.strokeDash === b.strokeDash &&
    a.fontFamily === b.fontFamily
  );
}

export function areStringRecordsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

export function areElementsEqual(a: SketchElement, b: SketchElement): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    areStylesEqual(a.style, b.style) &&
    a.label === b.label &&
    a.description === b.description &&
    a.text === b.text &&
    arePointsEqual(a.points, b.points) &&
    a.assetId === b.assetId &&
    areEndpointsEqual(a.from, b.from) &&
    areEndpointsEqual(a.to, b.to) &&
    a.parentId === b.parentId &&
    a.componentType === b.componentType &&
    areStringRecordsEqual(a.metadata, b.metadata) &&
    a.documentationUrl === b.documentationUrl
  );
}

export function areAssetsEqual(a: SketchAsset | undefined, b: SketchAsset | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.mimeType === b.mimeType &&
    a.name === b.name &&
    a.dataUrl === b.dataUrl
  );
}

export function areComponentSetsEqual(
  a: readonly ComponentSet[],
  b: readonly ComponentSet[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const sa = a[i]!;
    const sb = b[i]!;
    if (
      sa.id !== sb.id ||
      sa.name !== sb.name ||
      sa.version !== sb.version ||
      sa.components.length !== sb.components.length
    ) {
      return false;
    }
    for (let j = 0; j < sa.components.length; j += 1) {
      const ca = sa.components[j]!;
      const cb = sb.components[j]!;
      if (
        ca.type !== cb.type ||
        ca.name !== cb.name ||
        ca.provider !== cb.provider ||
        ca.category !== cb.category ||
        ca.defaultWidth !== cb.defaultWidth ||
        ca.defaultHeight !== cb.defaultHeight ||
        !areStylesEqual(ca.style, cb.style) ||
        !areStringRecordsEqual(ca.metadata, cb.metadata) ||
        ca.documentationUrl !== cb.documentationUrl ||
        ca.iconSvg !== cb.iconSvg
      ) {
        return false;
      }
      const aliasesA = ca.aliases;
      const aliasesB = cb.aliases;
      if (aliasesA !== aliasesB) {
        if (!aliasesA || !aliasesB || aliasesA.length !== aliasesB.length) return false;
        for (let k = 0; k < aliasesA.length; k += 1) {
          if (aliasesA[k] !== aliasesB[k]) return false;
        }
      }
      const widgetsA = ca.widgets;
      const widgetsB = cb.widgets;
      if (widgetsA !== widgetsB) {
        if (!widgetsA || !widgetsB || widgetsA.length !== widgetsB.length) return false;
        for (let k = 0; k < widgetsA.length; k += 1) {
          const wa = widgetsA[k]!;
          const wb = widgetsB[k]!;
          if (wa.key !== wb.key || wa.label !== wb.label || wa.kind !== wb.kind) return false;
          if (wa.options !== wb.options) {
            if (!wa.options || !wb.options || wa.options.length !== wb.options.length) return false;
            for (let m = 0; m < wa.options.length; m += 1) {
              if (wa.options[m] !== wb.options[m]) return false;
            }
          }
        }
      }
    }
  }
  return true;
}

export function areDocumentsEqual(a: SketchDocument, b: SketchDocument): boolean {
  if (a === b) return true;
  if (
    a.schemaVersion !== b.schemaVersion ||
    a.id !== b.id ||
    a.title !== b.title ||
    a.elements.length !== b.elements.length ||
    !areStringRecordsEqual(a.metadata, b.metadata) ||
    !areComponentSetsEqual(a.componentSets, b.componentSets)
  ) {
    return false;
  }

  const assetKeysA = Object.keys(a.assets);
  const assetKeysB = Object.keys(b.assets);
  if (assetKeysA.length !== assetKeysB.length) return false;
  for (const key of assetKeysA) {
    if (!areAssetsEqual(a.assets[key], b.assets[key])) {
      return false;
    }
  }

  for (let i = 0; i < a.elements.length; i += 1) {
    if (!areElementsEqual(a.elements[i]!, b.elements[i]!)) {
      return false;
    }
  }

  return true;
}
