export interface XmlTag {
  qualifiedName: string;
  localName: string;
  namespaceUri?: string;
  attributes: Record<string, string>;
  attributeNamespaceUris: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  depth: number;
}

export interface XmlScanResult {
  malformed: boolean;
  rootLocalName?: string;
  rootNamespaceUri?: string;
}

type XmlTagVisitor = (tag: XmlTag) => void;

const XML_NAME_STOP = /[\s=/>]/;

interface NamespaceChange {
  prefix: string;
  previous: string | undefined;
  hadPrevious: boolean;
}

interface OpenElement {
  qualifiedName: string;
  namespaceChanges: NamespaceChange[];
}

function localName(qualifiedName: string): string {
  const separator = qualifiedName.lastIndexOf(':');
  return separator >= 0 ? qualifiedName.slice(separator + 1) : qualifiedName;
}

function namespacePrefix(qualifiedName: string): string {
  const separator = qualifiedName.indexOf(':');
  return separator >= 0 ? qualifiedName.slice(0, separator) : '';
}

function applyNamespaceDeclarations(
  attributes: Readonly<Record<string, string>>,
  namespaces: Map<string, string>,
): NamespaceChange[] {
  const changes: NamespaceChange[] = [];
  for (const [qualifiedName, value] of Object.entries(attributes)) {
    const prefix =
      qualifiedName === 'xmlns'
        ? ''
        : qualifiedName.startsWith('xmlns:')
          ? qualifiedName.slice('xmlns:'.length)
          : undefined;
    if (prefix === undefined) continue;
    changes.push({
      prefix,
      previous: namespaces.get(prefix),
      hadPrevious: namespaces.has(prefix),
    });
    if (value) namespaces.set(prefix, value);
    else namespaces.delete(prefix);
  }
  return changes;
}

function undoNamespaceChanges(
  namespaces: Map<string, string>,
  changes: readonly NamespaceChange[],
): void {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (!change) continue;
    if (change.hadPrevious && change.previous !== undefined) {
      namespaces.set(change.prefix, change.previous);
    } else {
      namespaces.delete(change.prefix);
    }
  }
}

function attributeNamespaces(
  attributes: Readonly<Record<string, string>>,
  namespaces: ReadonlyMap<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const qualifiedName of Object.keys(attributes)) {
    if (qualifiedName === 'xmlns' || qualifiedName.startsWith('xmlns:')) continue;
    const prefix = namespacePrefix(qualifiedName);
    if (!prefix) continue;
    const namespaceUri = namespaces.get(prefix);
    if (namespaceUri) result[qualifiedName] = namespaceUri;
  }
  return result;
}

function decodeXmlAttribute(value: string): string {
  return value.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, numeric) => {
    if (numeric) {
      const raw = String(numeric);
      const codePoint =
        raw[0]?.toLowerCase() === 'x'
          ? Number.parseInt(raw.slice(1), 16)
          : Number.parseInt(raw, 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        return String.fromCodePoint(codePoint);
      }
      return entity;
    }
    switch (String(entity).toLowerCase()) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default:
        return entity;
    }
  });
}

function findMarkupEnd(xml: string, start: number, processingInstruction = false): number {
  let quote = '';
  let bracketDepth = 0;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? '';
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') bracketDepth += 1;
    else if (character === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (character === '>' && bracketDepth === 0) {
      if (!processingInstruction || xml[index - 1] === '?') return index;
    }
  }
  return -1;
}

function parseAttributes(
  raw: string,
  offset: number,
): {
  attributes: Record<string, string>;
  malformed: boolean;
} {
  const attributes: Record<string, string> = {};
  let malformed = false;
  let index = offset;
  while (index < raw.length) {
    while (/\s/.test(raw[index] ?? '')) index += 1;
    if (index >= raw.length || raw[index] === '/') break;

    const nameStart = index;
    while (index < raw.length && !XML_NAME_STOP.test(raw[index] ?? '')) index += 1;
    const name = raw.slice(nameStart, index);
    if (!name) {
      malformed = true;
      index += 1;
      continue;
    }
    while (/\s/.test(raw[index] ?? '')) index += 1;
    if (raw[index] !== '=') {
      malformed = true;
      while (index < raw.length && !/\s/.test(raw[index] ?? '')) index += 1;
      continue;
    }
    index += 1;
    while (/\s/.test(raw[index] ?? '')) index += 1;
    const quote = raw[index];
    if (quote !== '"' && quote !== "'") {
      malformed = true;
      while (index < raw.length && !/\s/.test(raw[index] ?? '')) index += 1;
      continue;
    }
    index += 1;
    const valueStart = index;
    const valueEnd = raw.indexOf(quote, valueStart);
    if (valueEnd < 0) {
      malformed = true;
      break;
    }
    if (Object.hasOwn(attributes, name)) malformed = true;
    attributes[name] = decodeXmlAttribute(raw.slice(valueStart, valueEnd));
    index = valueEnd + 1;
  }
  return { attributes, malformed };
}

/**
 * A deliberately small, non-expanding XML scanner. It never resolves DTDs or entities and keeps
 * no document tree, so memory remains proportional to the bounded source string plus tag depth.
 */
export function scanXmlTags(
  xml: string,
  visit: XmlTagVisitor,
  checkDeadline?: () => void,
): XmlScanResult {
  const stack: OpenElement[] = [];
  const namespaces = new Map<string, string>([['xml', 'http://www.w3.org/XML/1998/namespace']]);
  let malformed = false;
  let rootLocalName: string | undefined;
  let rootNamespaceUri: string | undefined;
  let rootClosed = false;
  let cursor = 0;
  let tagsVisited = 0;

  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor);
    if (opening < 0) break;
    if ((tagsVisited & 255) === 0) checkDeadline?.();

    if (xml.startsWith('<!--', opening)) {
      const end = xml.indexOf('-->', opening + 4);
      if (end < 0) {
        malformed = true;
        break;
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', opening)) {
      const end = xml.indexOf(']]>', opening + 9);
      if (end < 0) {
        malformed = true;
        break;
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', opening)) {
      const end = findMarkupEnd(xml, opening + 2, true);
      if (end < 0) {
        malformed = true;
        break;
      }
      cursor = end + 1;
      continue;
    }
    if (xml.startsWith('<!', opening)) {
      const end = findMarkupEnd(xml, opening + 2);
      if (end < 0) {
        malformed = true;
        break;
      }
      cursor = end + 1;
      continue;
    }

    const end = findMarkupEnd(xml, opening + 1);
    if (end < 0) {
      malformed = true;
      break;
    }
    const raw = xml.slice(opening + 1, end);
    let index = 0;
    while (/\s/.test(raw[index] ?? '')) index += 1;
    const closing = raw[index] === '/';
    if (closing) {
      index += 1;
      while (/\s/.test(raw[index] ?? '')) index += 1;
    }
    const nameStart = index;
    while (index < raw.length && !XML_NAME_STOP.test(raw[index] ?? '')) index += 1;
    const qualifiedName = raw.slice(nameStart, index);
    if (!qualifiedName) {
      malformed = true;
      cursor = end + 1;
      continue;
    }
    let tail = raw.length - 1;
    while (tail >= 0 && /\s/.test(raw[tail] ?? '')) tail -= 1;
    const selfClosing = !closing && raw[tail] === '/';
    const parsed = closing ? { attributes: {}, malformed: false } : parseAttributes(raw, index);
    malformed ||= parsed.malformed;

    if (closing) {
      let matchingIndex = -1;
      for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
        if (stack[stackIndex]?.qualifiedName === qualifiedName) {
          matchingIndex = stackIndex;
          break;
        }
      }
      if (matchingIndex < 0) {
        malformed = true;
      } else {
        if (matchingIndex !== stack.length - 1) malformed = true;
        const depth = matchingIndex;
        const namespaceUri = namespaces.get(namespacePrefix(qualifiedName));
        visit({
          qualifiedName,
          localName: localName(qualifiedName),
          ...(namespaceUri ? { namespaceUri } : {}),
          attributes: parsed.attributes,
          attributeNamespaceUris: {},
          closing: true,
          selfClosing: false,
          depth,
        });
        for (let stackIndex = stack.length - 1; stackIndex >= matchingIndex; stackIndex -= 1) {
          const frame = stack[stackIndex];
          if (frame) undoNamespaceChanges(namespaces, frame.namespaceChanges);
        }
        stack.length = matchingIndex;
        if (stack.length === 0) rootClosed = true;
      }
    } else {
      const namespaceChanges = applyNamespaceDeclarations(parsed.attributes, namespaces);
      const namespaceUri = namespaces.get(namespacePrefix(qualifiedName));
      const attributeNamespaceUris = attributeNamespaces(parsed.attributes, namespaces);
      if (stack.length === 0) {
        if (rootClosed) malformed = true;
        rootLocalName ??= localName(qualifiedName);
        rootNamespaceUri ??= namespaceUri;
      }
      visit({
        qualifiedName,
        localName: localName(qualifiedName),
        ...(namespaceUri ? { namespaceUri } : {}),
        attributes: parsed.attributes,
        attributeNamespaceUris,
        closing: false,
        selfClosing,
        depth: stack.length,
      });
      if (!selfClosing) {
        stack.push({ qualifiedName, namespaceChanges });
      } else {
        undoNamespaceChanges(namespaces, namespaceChanges);
        if (stack.length === 0) rootClosed = true;
      }
    }

    tagsVisited += 1;
    cursor = end + 1;
  }

  checkDeadline?.();
  if (stack.length > 0 || !rootLocalName) malformed = true;
  return {
    malformed,
    ...(rootLocalName ? { rootLocalName } : {}),
    ...(rootNamespaceUri ? { rootNamespaceUri } : {}),
  };
}

export function getXmlAttribute(
  attributes: Readonly<Record<string, string>>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const direct = attributes[name];
    if (direct !== undefined) return direct;
  }
  const unqualifiedNames = names.filter((name) => !name.includes(':'));
  for (const [qualifiedName, value] of Object.entries(attributes)) {
    if (!qualifiedName.includes(':') && unqualifiedNames.includes(qualifiedName)) return value;
  }
  return undefined;
}

export function getXmlAttributeByNamespace(
  tag: XmlTag,
  namespaceUris: ReadonlySet<string>,
  name: string,
): string | undefined {
  for (const [qualifiedName, value] of Object.entries(tag.attributes)) {
    if (
      localName(qualifiedName) === name &&
      namespaceUris.has(tag.attributeNamespaceUris[qualifiedName] ?? '')
    ) {
      return value;
    }
  }
  return undefined;
}

export function relationshipPartName(partName: string): string {
  const separator = partName.lastIndexOf('/');
  const directory = separator >= 0 ? partName.slice(0, separator + 1) : '';
  const baseName = separator >= 0 ? partName.slice(separator + 1) : partName;
  return `${directory}_rels/${baseName}.rels`;
}

export function isSafePackagePath(partName: string): boolean {
  if (
    !partName ||
    partName.startsWith('/') ||
    partName.includes('\\') ||
    partName.includes('\0') ||
    partName.includes('?') ||
    partName.includes('#')
  ) {
    return false;
  }
  const segments = partName.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'),
  );
}

export function resolveRelationshipTarget(
  sourcePartName: string,
  target: string,
): string | undefined {
  const trimmed = target.trim();
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return undefined;
  }

  const sourceSegments = sourcePartName.split('/');
  sourceSegments.pop();
  for (const segment of trimmed.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (sourceSegments.length === 0) return undefined;
      sourceSegments.pop();
    } else if (segment.includes(':')) {
      return undefined;
    } else {
      sourceSegments.push(segment);
    }
  }
  const resolved = sourceSegments.join('/');
  return isSafePackagePath(resolved) ? resolved : undefined;
}
