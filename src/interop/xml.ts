import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes';
import { utf8ByteLength } from '../domain/validation';
import { INTEROP_LIMITS } from './limits';
import { InteropError } from './types';

function xmlError(code: string, message: string, context: { path: string }): InteropError {
  return new InteropError(code, message, [{ code, message, severity: 'error', effect: 'rejected', sourcePath: context.path }]);
}

export interface XmlAttribute {
  name: string;
  local: string;
  prefix: string;
  uri: string;
  value: string;
}

export interface XmlTextNode {
  kind: 'text';
  text: string;
}

export interface XmlElementNode {
  kind: 'element';
  name: string;
  local: string;
  prefix: string;
  uri: string;
  attributes: Record<string, string>;
  attributeList: XmlAttribute[];
  children: XmlChildNode[];
  path: string;
}

export type XmlChildNode = XmlElementNode | XmlTextNode;

export interface ParseXmlOptions {
  maxInputBytes?: number;
  maxNodes?: number;
  maxDepth?: number;
  maxAttributesPerNode?: number;
  basePath?: string;
  nodeBudget?: { used: number };
}

const SAXES_CHUNK_CHARS = 4_096;

const XINCLUDE_NAMESPACES = new Set<string>([
  'http://www.w3.org/2001/XInclude',
  'http://www.w3.org/2003/XInclude',
]);

const TEXT_PRESERVING_LOCAL_NAMES = new Set<string>([
  'text',
  'tspan',
  'title',
  'desc',
]);

function looksLikeForbiddenXmlConstruct(xml: string, approxIndex: number): boolean {
  const start = Math.max(0, approxIndex - 64);
  const end = Math.min(xml.length, approxIndex + 64);
  const windowText = xml.slice(start, end);
  return (
    /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(windowText) ||
    /<\?(?!xml\b)/i.test(windowText)
  );
}

/**
 * Scans XML outside of comments and CDATA sections for forbidden constructs
 * (`<!DOCTYPE`, `<!ENTITY`, `<!ELEMENT`, `<!ATTLIST`, `<!NOTATION`, or non-`xml` PIs `<?target`)
 * before or during chunked parsing so that even malformed or unclosed DTDs abort with
 * `XML_FORBIDDEN_CONSTRUCT`.
 */
function precheckForbiddenXmlConstructs(xml: string): void {
  let i = 0;
  const len = xml.length;
  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      break;
    }
    if (lt + 1 >= len) {
      break;
    }
    const next = xml.charCodeAt(lt + 1);
    // '!' === 0x21
    if (next === 0x21) {
      if (xml.startsWith('!--', lt + 1)) {
        const endComment = xml.indexOf('-->', lt + 4);
        if (endComment === -1) {
          break;
        }
        i = endComment + 3;
        continue;
      }
      if (xml.startsWith('![CDATA[', lt + 1)) {
        const endCdata = xml.indexOf(']]>', lt + 9);
        if (endCdata === -1) {
          break;
        }
        i = endCdata + 3;
        continue;
      }
      const bangSlice = xml.slice(lt, Math.min(len, lt + 24));
      if (/^<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(bangSlice)) {
        throw xmlError(
          'XML_FORBIDDEN_CONSTRUCT',
          `Forbidden XML DTD/entity declaration encountered near offset ${lt}`,
          { path: '/' },
        );
      }
    } else if (next === 0x3f) {
      // '?' === 0x3f
      const piSlice = xml.slice(lt, Math.min(len, lt + 24));
      // Allow only initial `<?xml` followed by whitespace or `?`
      const isInitialXmlDecl =
        lt <= 4 &&
        (lt === 0 || (lt === 1 && xml.charCodeAt(0) === 0xfeff)) &&
        /^<\?xml(?:[\s?]|$)/.test(piSlice);
      if (!isInitialXmlDecl) {
        throw xmlError(
          'XML_FORBIDDEN_CONSTRUCT',
          `Forbidden XML processing instruction encountered near offset ${lt}`,
          { path: '/' },
        );
      }
    }
    i = lt + 1;
  }
}

/**
 * Parses an XML string into a bounded `XmlElementNode` tree using `saxes` in namespace mode.
 */
export function parseXmlDocument(
  xmlInput: string,
  options: ParseXmlOptions = {},
): XmlElementNode {
  if (typeof xmlInput !== 'string') {
    throw xmlError('XML_SYNTAX', 'XML input must be a string', { path: '/' });
  }

  const maxInputBytes = options.maxInputBytes ?? INTEROP_LIMITS.MAX_INPUT_BYTES;
  const maxNodes = options.maxNodes ?? INTEROP_LIMITS.MAX_XML_NODES;
  const maxDepth = options.maxDepth ?? INTEROP_LIMITS.MAX_XML_DEPTH;
  const maxAttributesPerNode =
    options.maxAttributesPerNode ?? INTEROP_LIMITS.MAX_ATTRIBUTES_PER_NODE;
  const basePath = options.basePath ?? '';

  const inputBytes = utf8ByteLength(xmlInput);
  if (inputBytes > maxInputBytes) {
    throw xmlError(
      'LIMIT_EXCEEDED',
      `XML input size (${inputBytes} bytes) exceeds maximum of ${maxInputBytes} bytes`,
      { path: basePath || '/' },
    );
  }

  precheckForbiddenXmlConstructs(xmlInput);

  const parser = new SaxesParser({
    xmlns: true,
    fragment: false,
    position: true,
  });

  let fatalError: InteropError | null = null;
  let totalNodes = options.nodeBudget?.used ?? 0;
  let currentTagAttrCount = 0;
  let rootElement: XmlElementNode | null = null;

  interface StackEntry {
    node: XmlElementNode;
    childTagCounts: Map<string, number>;
  }

  const stack: StackEntry[] = [];
  const rootChildTagCounts = new Map<string, number>();

  const currentPath = (): string => {
    if (stack.length === 0) {
      return basePath || '/';
    }
    return stack[stack.length - 1]!.node.path;
  };

  const setFatal = (err: InteropError): void => {
    if (fatalError === null) {
      fatalError = err;
    }
  };

  parser.on('doctype', () => {
    setFatal(
      xmlError(
        'XML_FORBIDDEN_CONSTRUCT',
        'XML DOCTYPE declarations are forbidden',
        { path: currentPath() },
      ),
    );
  });

  parser.on('processinginstruction', (pi) => {
    setFatal(
      xmlError(
        'XML_FORBIDDEN_CONSTRUCT',
        `XML processing instruction "?${pi.target}" is forbidden`,
        { path: currentPath() },
      ),
    );
  });

  parser.on('opentagstart', (tag) => {
    if (fatalError !== null) {
      return;
    }
    totalNodes += 1;
    if (totalNodes > maxNodes) {
      setFatal(
        xmlError(
          'LIMIT_EXCEEDED',
          `XML node count exceeds maximum of ${maxNodes}`,
          { path: currentPath() },
        ),
      );
      return;
    }
    const nextDepth = stack.length + 1;
    if (nextDepth > maxDepth) {
      setFatal(
        xmlError(
          'LIMIT_EXCEEDED',
          `XML nesting depth (${nextDepth}) exceeds maximum of ${maxDepth}`,
          { path: `${currentPath()}/${tag.name}` },
        ),
      );
      return;
    }
    currentTagAttrCount = 0;
  });

  parser.on('attribute', (attr) => {
    if (fatalError !== null) {
      return;
    }
    currentTagAttrCount += 1;
    if (currentTagAttrCount > maxAttributesPerNode) {
      setFatal(
        xmlError(
          'LIMIT_EXCEEDED',
          `Attribute count on element exceeds maximum of ${maxAttributesPerNode}`,
          { path: currentPath() },
        ),
      );
      return;
    }
    if (
      (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) &&
      XINCLUDE_NAMESPACES.has(attr.value.trim())
    ) {
      setFatal(
        xmlError(
          'XML_FORBIDDEN_CONSTRUCT',
          'XML XInclude namespace is forbidden',
          { path: currentPath() },
        ),
      );
    }
  });

  parser.on('opentag', (tag: SaxesTagNS) => {
    if (fatalError !== null) {
      return;
    }

    if (XINCLUDE_NAMESPACES.has(tag.uri) || tag.local.toLowerCase() === 'include' && tag.prefix.toLowerCase() === 'xi') {
      setFatal(
        xmlError(
          'XML_FORBIDDEN_CONSTRUCT',
          `XML XInclude element "<${tag.name}>" is forbidden`,
          { path: currentPath() },
        ),
      );
      return;
    }

    const parentEntry = stack.length > 0 ? stack[stack.length - 1]! : null;
    const siblingCounts = parentEntry ? parentEntry.childTagCounts : rootChildTagCounts;
    const siblingIndex = (siblingCounts.get(tag.name) ?? 0) + 1;
    siblingCounts.set(tag.name, siblingIndex);

    const parentPath = parentEntry ? parentEntry.node.path : basePath;
    const path = `${parentPath}/${tag.name}[${siblingIndex}]`;

    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    const attributeList: XmlAttribute[] = [];

    const rawAttrs = tag.attributes as Record<string, SaxesAttributeNS>;
    const attrNames = Object.keys(rawAttrs);
    if (attrNames.length > maxAttributesPerNode) {
      setFatal(
        xmlError(
          'LIMIT_EXCEEDED',
          `Attribute count (${attrNames.length}) on <${tag.name}> exceeds maximum of ${maxAttributesPerNode}`,
          { path },
        ),
      );
      return;
    }

    for (const attrName of attrNames) {
      const attrObj = rawAttrs[attrName]!;
      if (XINCLUDE_NAMESPACES.has(attrObj.uri)) {
        setFatal(
          xmlError(
            'XML_FORBIDDEN_CONSTRUCT',
            `Attribute "${attrObj.name}" uses forbidden XInclude namespace`,
            { path },
          ),
        );
        return;
      }
      attributes[attrObj.name] = attrObj.value;
      attributeList.push({
        name: attrObj.name,
        local: attrObj.local,
        prefix: attrObj.prefix,
        uri: attrObj.uri,
        value: attrObj.value,
      });
    }

    const elementNode: XmlElementNode = {
      kind: 'element',
      name: tag.name,
      local: tag.local,
      prefix: tag.prefix,
      uri: tag.uri,
      attributes,
      attributeList,
      children: [],
      path,
    };

    if (parentEntry !== null) {
      parentEntry.node.children.push(elementNode);
    } else {
      rootElement = elementNode;
    }

    stack.push({
      node: elementNode,
      childTagCounts: new Map<string, number>(),
    });
  });

  parser.on('text', (text: string) => {
    if (fatalError !== null || stack.length === 0 || text.length === 0) {
      return;
    }
    const top = stack[stack.length - 1]!.node;
    const lastChild = top.children[top.children.length - 1];
    if (lastChild !== undefined && lastChild.kind === 'text') {
      lastChild.text += text;
    } else {
      if (++totalNodes > maxNodes) { setFatal(xmlError('LIMIT_EXCEEDED', 'XML node budget exceeded', { path: currentPath() })); return; }
      top.children.push({
        kind: 'text',
        text,
      });
    }
  });

  parser.on('cdata', (cdata: string) => {
    if (fatalError !== null || stack.length === 0 || cdata.length === 0) {
      return;
    }
    const top = stack[stack.length - 1]!.node;
    const lastChild = top.children[top.children.length - 1];
    if (lastChild !== undefined && lastChild.kind === 'text') {
      lastChild.text += cdata;
    } else {
      if (++totalNodes > maxNodes) { setFatal(xmlError('LIMIT_EXCEEDED', 'XML node budget exceeded', { path: currentPath() })); return; }
      top.children.push({
        kind: 'text',
        text: cdata,
      });
    }
  });

  parser.on('comment', () => { if (++totalNodes > maxNodes) setFatal(xmlError('LIMIT_EXCEEDED', 'XML node budget exceeded', { path: currentPath() })); });

  parser.on('closetag', () => {
    if (fatalError !== null) {
      return;
    }
    stack.pop();
  });

  parser.on('error', (err: Error) => {
    if (fatalError !== null) {
      return;
    }
    const msg = err.message || 'Malformed XML';
    const approxPos = typeof parser.position === 'number' ? parser.position : 0;
    if (
      msg.includes('doctype') ||
      msg.includes('processing instruction') ||
      msg.includes('undefined entity') ||
      looksLikeForbiddenXmlConstruct(xmlInput, approxPos)
    ) {
      setFatal(
        xmlError('XML_FORBIDDEN_CONSTRUCT', `Forbidden XML construct: ${msg}`, {
          path: currentPath(),
        }),
      );
      return;
    }
    setFatal(
      xmlError('XML_SYNTAX', `Malformed XML (${msg})`, {
        path: currentPath(),
      }),
    );
  });

  for (let offset = 0; offset < xmlInput.length; offset += SAXES_CHUNK_CHARS) {
    const chunk = xmlInput.slice(offset, offset + SAXES_CHUNK_CHARS);
    parser.write(chunk);
    if (fatalError !== null) {
      throw fatalError;
    }
  }
  parser.close();

  if (fatalError !== null) {
    throw fatalError;
  }

  if (rootElement === null) {
    throw xmlError('XML_SYNTAX', 'XML document does not contain a root element', {
      path: basePath || '/',
    });
  }

  if (options.nodeBudget) options.nodeBudget.used = totalNodes;
  return rootElement;
}

/**
 * Returns all child elements of `node` (filtering out text nodes).
 */
export function getElementChildren(node: XmlElementNode): XmlElementNode[] {
  const result: XmlElementNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'element') {
      result.push(child);
    }
  }
  return result;
}

/**
 * Returns concatenated text content of `node` and all its descendants.
 */
export function getElementTextContent(node: XmlElementNode): string {
  let out = '';
  for (const child of node.children) {
    if (child.kind === 'text') {
      out += child.text;
    } else {
      out += getElementTextContent(child);
    }
  }
  return out;
}

/**
 * Looks up an attribute on `node` by exact name or local name.
 */
export function getAttribute(
  node: XmlElementNode,
  name: string,
  localFallback = false,
): string | undefined {
  const direct = node.attributes[name];
  if (direct !== undefined) {
    return direct;
  }
  if (localFallback) {
    for (const attr of node.attributeList) {
      if (attr.local === name) {
        return attr.value;
      }
    }
  }
  return undefined;
}

function isXmlWhitespaceOnly(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
  }
  return true;
}

function isXmlnsAttribute(attr: XmlAttribute): boolean {
  return attr.name === 'xmlns' || attr.prefix === 'xmlns';
}

function getExpandedAttrKey(attr: XmlAttribute): string {
  return attr.uri.length > 0 ? `{${attr.uri}}${attr.local}` : attr.local;
}

function normalizeChildrenForComparison(
  node: XmlElementNode,
  preserveWhitespace: boolean,
): XmlChildNode[] {
  const normalized: XmlChildNode[] = [];
  let textBuffer = '';

  const flushText = (): void => {
    if (textBuffer.length === 0) {
      return;
    }
    if (preserveWhitespace || !isXmlWhitespaceOnly(textBuffer)) {
      normalized.push({ kind: 'text', text: textBuffer });
    }
    textBuffer = '';
  };

  for (const child of node.children) {
    if (child.kind === 'text') {
      textBuffer += child.text;
    } else {
      flushText();
      normalized.push(child);
    }
  }
  flushText();
  return normalized;
}

/**
 * Compares two parsed XML element trees for structural, attribute, namespace, child-order,
 * and text equivalence according to Section 6 of `docs/contracts-interop.md`.
 */
export function areXmlTreesEquivalent(
  a: XmlElementNode,
  b: XmlElementNode,
  insideWhitespacePreservingElement = false,
): boolean {
  if (a.uri !== b.uri || a.local !== b.local) {
    return false;
  }

  const aAttrs = new Map<string, string>();
  for (const attr of a.attributeList) {
    if (isXmlnsAttribute(attr)) {
      continue;
    }
    aAttrs.set(getExpandedAttrKey(attr), attr.value);
  }

  let bNonXmlnsCount = 0;
  for (const attr of b.attributeList) {
    if (isXmlnsAttribute(attr)) {
      continue;
    }
    bNonXmlnsCount += 1;
    const key = getExpandedAttrKey(attr);
    const aVal = aAttrs.get(key);
    if (aVal === undefined || aVal !== attr.value) {
      return false;
    }
  }

  if (aAttrs.size !== bNonXmlnsCount) {
    return false;
  }

  const preserveWhitespace =
    insideWhitespacePreservingElement || TEXT_PRESERVING_LOCAL_NAMES.has(a.local);

  const aChildren = normalizeChildrenForComparison(a, preserveWhitespace);
  const bChildren = normalizeChildrenForComparison(b, preserveWhitespace);

  if (aChildren.length !== bChildren.length) {
    return false;
  }

  for (let i = 0; i < aChildren.length; i += 1) {
    const childA = aChildren[i]!;
    const childB = bChildren[i]!;
    if (childA.kind !== childB.kind) {
      return false;
    }
    if (childA.kind === 'text' && childB.kind === 'text') {
      if (childA.text !== childB.text) {
        return false;
      }
    } else if (childA.kind === 'element' && childB.kind === 'element') {
      if (!areXmlTreesEquivalent(childA, childB, preserveWhitespace)) {
        return false;
      }
    }
  }

  return true;
}

/** Strip only the documented own envelope; all other native attributes remain compared. */
export function stripDrawioEnvelopeFromXmlRoot(node: XmlElementNode): XmlElementNode {
  const rootWrapper = node.attributes['id'] === '0' && getElementChildren(node).some(child => child.uri === '' && child.local === 'mxCell');
  const attributeList = node.attributeList.filter(attr => !rootWrapper || !(attr.uri === '' && attr.local === 'sketchdrawInterop'));
  return { ...node, attributeList, attributes: Object.fromEntries(attributeList.map(attr => [attr.name, attr.value])),
    children: node.children.map(child => child.kind === 'element' ? stripDrawioEnvelopeFromXmlRoot(child) : child) };
}

/** Only root-level metadata is eligible. Additional metadata content must invalidate equality. */
export function stripSvgEnvelopeFromXmlRoot(node: XmlElementNode): XmlElementNode {
  const children = node.children.flatMap<XmlChildNode>(child => {
    if (child.kind !== 'element' || child.uri !== 'http://www.w3.org/2000/svg' || child.local !== 'metadata') return [child];
    const remaining = child.children.filter(item => !(item.kind === 'element' && item.uri === 'https://sketchdraw.io/ns/interop/1'));
    const hasAttributes = child.attributeList.some(attr => attr.uri !== 'http://www.w3.org/2000/xmlns/');
    if (!hasAttributes && remaining.every(item => item.kind === 'text' && !item.text.trim())) return [];
    return [{ ...child, children: remaining }];
  });
  return { ...node, children };
}
