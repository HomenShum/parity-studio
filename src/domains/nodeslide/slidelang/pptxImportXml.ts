import { type XmlTag, scanXmlTags } from '../signature/xml';

export interface PptxXmlNode {
  tag: XmlTag;
  text: string;
  children: PptxXmlNode[];
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(?:#(x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos);/gi,
    (entity: string, numeric: string | undefined) => {
      if (numeric) {
        const codePoint =
          numeric[0]?.toLowerCase() === 'x'
            ? Number.parseInt(numeric.slice(1), 16)
            : Number.parseInt(numeric, 10);
        if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
          return String.fromCodePoint(codePoint);
        }
        return entity;
      }
      const named: Record<string, string> = {
        '&amp;': '&',
        '&apos;': "'",
        '&gt;': '>',
        '&lt;': '<',
        '&quot;': '"',
      };
      return named[entity.toLowerCase()] ?? entity;
    },
  );
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

/**
 * Builds a small tree from the namespace-aware, non-expanding signature scanner. The lexical pass
 * only attaches text to the already validated tag stream; it never interprets DTDs or entities.
 */
export function parsePptxXml(
  xml: string,
  checkDeadline: () => void,
): { root?: PptxXmlNode; malformed: boolean } {
  const tags: XmlTag[] = [];
  const scan = scanXmlTags(xml, (tag) => tags.push(tag), checkDeadline);
  if (scan.malformed) return { malformed: true };

  const roots: PptxXmlNode[] = [];
  const stack: PptxXmlNode[] = [];
  let tagIndex = 0;
  let cursor = 0;
  let malformed = false;

  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor);
    const textEnd = opening < 0 ? xml.length : opening;
    if (textEnd > cursor && stack.length > 0) {
      const current = stack[stack.length - 1];
      if (current) current.text += decodeXmlText(xml.slice(cursor, textEnd));
    }
    if (opening < 0) break;
    if ((tagIndex & 255) === 0) checkDeadline();

    if (xml.startsWith('<!--', opening)) {
      const end = xml.indexOf('-->', opening + 4);
      if (end < 0) return { malformed: true };
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', opening)) {
      const end = xml.indexOf(']]>', opening + 9);
      if (end < 0) return { malformed: true };
      const current = stack[stack.length - 1];
      if (current) current.text += xml.slice(opening + 9, end);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', opening)) {
      const end = findMarkupEnd(xml, opening + 2, true);
      if (end < 0) return { malformed: true };
      cursor = end + 1;
      continue;
    }
    if (xml.startsWith('<!', opening)) {
      const end = findMarkupEnd(xml, opening + 2);
      if (end < 0) return { malformed: true };
      cursor = end + 1;
      continue;
    }

    const end = findMarkupEnd(xml, opening + 1);
    if (end < 0) return { malformed: true };
    const tag = tags[tagIndex];
    if (!tag) return { malformed: true };
    tagIndex += 1;

    if (tag.closing) {
      const current = stack.pop();
      if (!current || current.tag.qualifiedName !== tag.qualifiedName) malformed = true;
    } else {
      const node: PptxXmlNode = { tag, text: '', children: [] };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else roots.push(node);
      if (!tag.selfClosing) stack.push(node);
    }
    cursor = end + 1;
  }

  checkDeadline();
  return {
    ...(roots.length === 1 ? { root: roots[0] } : {}),
    malformed: malformed || stack.length > 0 || roots.length !== 1 || tagIndex !== tags.length,
  };
}

export function childNodes(node: PptxXmlNode, localName: string): PptxXmlNode[] {
  return node.children.filter((child) => child.tag.localName === localName);
}

export function firstChild(node: PptxXmlNode, localName: string): PptxXmlNode | undefined {
  return node.children.find((child) => child.tag.localName === localName);
}

export function descendants(node: PptxXmlNode, localName: string): PptxXmlNode[] {
  const matches: PptxXmlNode[] = [];
  const pending = [...node.children];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    if (current.tag.localName === localName) matches.push(current);
    pending.unshift(...current.children);
  }
  return matches;
}

export function firstDescendant(node: PptxXmlNode, localName: string): PptxXmlNode | undefined {
  return descendants(node, localName)[0];
}

export function nodeText(node: PptxXmlNode): string {
  let value = node.text;
  for (const child of node.children) value += nodeText(child);
  return value;
}
