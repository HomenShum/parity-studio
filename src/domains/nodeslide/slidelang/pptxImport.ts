import JSZip, { type JSZipObject } from 'jszip';
import {
  type BoundingBox,
  type ChartData,
  type DeckSnapshot,
  type ElementStyle,
  NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  NODESLIDE_PATCH_OPERATION_LIMIT,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type PatchOperation,
  type Slide,
  type SlideElement,
  type ThemeSpec,
} from '../../../../shared/nodeslide';
import { applyDeckPatch } from '../../../../shared/nodeslidePatch';
import {
  type RelationshipSet,
  type ThemeDefinition,
  parsePresentationMetadata,
  parseRelationships,
  parseTheme,
} from '../signature/parsers';
import { getXmlAttribute, isSafePackagePath, relationshipPartName } from '../signature/xml';
import { type ZipDirectoryEntry, ZipMetadataFailure, readZipDirectory } from '../signature/zip';
import { DEFAULT_PPTX_IMPORT_BOUNDS } from './importBounds';
import type {
  PptxImportBounds,
  PptxImportCandidateResult,
  PptxImportErrorCode,
  PptxImportFeature,
  PptxImportFidelity,
  PptxImportFidelityItem,
  PptxImportFidelityReport,
  PptxImportOptions,
  PptxImportResult,
} from './pptxImportTypes';
export { DEFAULT_PPTX_IMPORT_BOUNDS } from './importBounds';
import {
  type PptxXmlNode,
  childNodes,
  descendants,
  firstChild,
  firstDescendant,
  nodeText,
  parsePptxXml,
} from './pptxImportXml';
import { isStableId, stableHash } from './utils';
import { validateSnapshot } from './validation';

const NODESLIDE_PPTX_SLIDE_ID_PREFIX = 'nodeslide-slide-id:';

const PRESENTATION_NS = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
]);
const DRAWING_NS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);
const CHART_NS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/chart',
  'http://purl.oclc.org/ooxml/drawingml/chart',
]);
const MATH_NS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'http://purl.oclc.org/ooxml/officeDocument/math',
]);
const PACKAGE_RELATIONSHIP_NS = new Set([
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://purl.oclc.org/ooxml/package/relationships',
]);
const OFFICE_RELATIONSHIP_NS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

const DEFAULT_COLOR_MAP: Readonly<Record<string, string>> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
};

const PRESET_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  dkBlue: '#00008B',
  dkGray: '#A9A9A9',
  dkGreen: '#006400',
  dkRed: '#8B0000',
  gold: '#FFD700',
  gray: '#808080',
  green: '#008000',
  ltBlue: '#ADD8E6',
  ltGray: '#D3D3D3',
  ltGreen: '#90EE90',
  magenta: '#FF00FF',
  orange: '#FFA500',
  purple: '#800080',
  red: '#FF0000',
  silver: '#C0C0C0',
  teal: '#008080',
  white: '#FFFFFF',
  yellow: '#FFFF00',
};

class ImportFailure extends Error {
  constructor(
    readonly code: PptxImportErrorCode,
    message: string,
    readonly partName?: string,
  ) {
    super(message);
    this.name = 'PptxImportFailure';
  }
}

interface InternalStreamHelper {
  on(event: 'data', callback: (chunk: Uint8Array) => void): InternalStreamHelper;
  on(event: 'error', callback: (error: unknown) => void): InternalStreamHelper;
  on(event: 'end', callback: () => void): InternalStreamHelper;
  pause(): InternalStreamHelper;
  resume(): InternalStreamHelper;
}

interface StreamableZipObject extends JSZipObject {
  internalStream(type: 'uint8array'): InternalStreamHelper;
}

interface ImportContext {
  bounds: PptxImportBounds;
  checkDeadline: () => void;
  fidelity: FidelityCollector;
  reader: PackageReader;
  theme: ThemeDefinition;
  colorMap: Readonly<Record<string, string>>;
  slideWidthEmu: number;
  slideHeightEmu: number;
  deckId: string;
  usedElementIds: Set<string>;
  totalItems: number;
}

interface GeometryResult {
  bbox: BoundingBox;
  rotation: number;
  approximated: boolean;
}

class FidelityCollector {
  readonly items: PptxImportFidelityItem[] = [];
  #sequence = 0;

  constructor(private readonly limit: number) {}

  add(
    feature: PptxImportFeature,
    fidelity: PptxImportFidelity,
    reason: string,
    context: Omit<PptxImportFidelityItem, 'id' | 'feature' | 'fidelity' | 'reason'> = {},
  ): void {
    if (this.items.length >= this.limit) {
      throw new ImportFailure(
        'too_many_items',
        `The fidelity report exceeded its bounded ${this.limit}-item limit.`,
      );
    }
    this.#sequence += 1;
    this.items.push({
      id: `fidelity:${this.#sequence}`,
      feature,
      fidelity,
      reason,
      ...context,
    });
  }

  report(): PptxImportFidelityReport {
    const summary: Record<PptxImportFidelity, number> = {
      native: 0,
      approximated: 0,
      dropped: 0,
    };
    for (const item of this.items) summary[item.fidelity] += 1;
    return {
      items: [...this.items],
      summary,
      hasLoss: summary.approximated > 0 || summary.dropped > 0,
    };
  }
}

function normalizedBounds(overrides: Partial<PptxImportBounds> | undefined): PptxImportBounds {
  const bounds = { ...DEFAULT_PPTX_IMPORT_BOUNDS, ...overrides };
  for (const [name, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ImportFailure('invalid_pptx', `Import bound ${name} must be a positive integer.`);
    }
  }
  bounds.maxSlides = Math.min(bounds.maxSlides, 64);
  bounds.maxItemsPerSlide = Math.min(bounds.maxItemsPerSlide, NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT);
  return bounds;
}

function inputBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
}

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.byteLength - 2);
    for (let index = 2; index + 1 < bytes.byteLength; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index] ?? 0;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

async function inflateBounded(
  entry: JSZipObject,
  limit: number,
  checkDeadline: () => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (entry as StreamableZipObject).internalStream('uint8array');
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };
    stream
      .on('data', (chunk) => {
        if (settled) return;
        try {
          checkDeadline();
        } catch (error) {
          rejectOnce(error);
          return;
        }
        total += chunk.byteLength;
        if (total > limit) {
          rejectOnce(
            new ImportFailure('part_too_large', 'An inflated package part exceeded its limit.'),
          );
          return;
        }
        chunks.push(chunk);
      })
      .on('error', rejectOnce)
      .on('end', () => {
        if (settled) return;
        settled = true;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(result);
      })
      .resume();
  });
}

class PackageReader {
  readonly #xmlCache = new Map<string, string | undefined>();
  readonly #binaryCache = new Map<string, Uint8Array | undefined>();
  #mediaBytesRead = 0;

  constructor(
    private readonly entries: ReadonlyMap<string, JSZipObject>,
    private readonly sizes: ReadonlyMap<string, number>,
    private readonly bounds: PptxImportBounds,
    private readonly checkDeadline: () => void,
  ) {}

  has(partName: string): boolean {
    return this.entries.has(partName);
  }

  entryNames(): string[] {
    return [...this.entries.keys()].sort();
  }

  async readXml(partName: string, required = false): Promise<string | undefined> {
    if (this.#xmlCache.has(partName)) {
      const cached = this.#xmlCache.get(partName);
      if (required && cached === undefined) {
        throw new ImportFailure(
          'invalid_pptx',
          `Required OOXML part ${partName} is missing.`,
          partName,
        );
      }
      return cached;
    }
    const bytes = await this.readPart(partName, this.bounds.maxXmlPartBytes, required);
    const xml = bytes ? decodeXml(bytes) : undefined;
    this.#xmlCache.set(partName, xml);
    return xml;
  }

  async readMedia(partName: string): Promise<Uint8Array | undefined> {
    if (this.#binaryCache.has(partName)) return this.#binaryCache.get(partName);
    const declared = this.sizes.get(partName);
    if (
      declared !== undefined &&
      declared + this.#mediaBytesRead > this.bounds.maxAggregateMediaBytes
    ) {
      throw new ImportFailure(
        'archive_too_large',
        'Embedded media exceeded the aggregate import limit.',
        partName,
      );
    }
    const bytes = await this.readPart(partName, this.bounds.maxMediaPartBytes, false);
    if (bytes) {
      this.#mediaBytesRead += bytes.byteLength;
      if (this.#mediaBytesRead > this.bounds.maxAggregateMediaBytes) {
        throw new ImportFailure(
          'archive_too_large',
          'Embedded media exceeded the aggregate import limit.',
          partName,
        );
      }
    }
    this.#binaryCache.set(partName, bytes);
    return bytes;
  }

  private async readPart(
    partName: string,
    limit: number,
    required: boolean,
  ): Promise<Uint8Array | undefined> {
    this.checkDeadline();
    const entry = this.entries.get(partName);
    const declared = this.sizes.get(partName);
    if (!entry || declared === undefined) {
      if (required) {
        throw new ImportFailure(
          'invalid_pptx',
          `Required OOXML part ${partName} is missing.`,
          partName,
        );
      }
      return undefined;
    }
    if (declared > limit) {
      throw new ImportFailure(
        'part_too_large',
        `OOXML part ${partName} exceeds its limit.`,
        partName,
      );
    }
    try {
      return await inflateBounded(entry, limit, this.checkDeadline);
    } catch (error) {
      if (error instanceof ImportFailure) {
        throw new ImportFailure(error.code, error.message, partName);
      }
      throw new ImportFailure(
        'invalid_zip',
        `Could not inflate package part ${partName}.`,
        partName,
      );
    }
  }
}

function buildPackageMaps(
  zip: JSZip,
  directory: readonly ZipDirectoryEntry[],
): { entries: Map<string, JSZipObject>; sizes: Map<string, number> } {
  const sizes = new Map<string, number>();
  for (const metadata of directory) {
    if (metadata.directory) continue;
    if (!isSafePackagePath(metadata.originalName) || sizes.has(metadata.originalName)) {
      throw new ImportFailure('invalid_zip', 'The archive contains an unsafe or duplicate entry.');
    }
    sizes.set(metadata.originalName, metadata.uncompressedSize);
  }
  const entries = new Map<string, JSZipObject>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const originalName = entry.unsafeOriginalName ?? entry.name;
    if (originalName !== entry.name || !sizes.has(originalName)) {
      throw new ImportFailure('invalid_zip', 'The archive contains an unsafe entry name.');
    }
    entries.set(originalName, entry);
  }
  return { entries, sizes };
}

function attrLocal(node: PptxXmlNode, localName: string): string | undefined {
  for (const [name, value] of Object.entries(node.tag.attributes)) {
    if ((name.split(':').pop() ?? name) === localName) return value;
  }
  return undefined;
}

function isNamespace(node: PptxXmlNode, namespaces: ReadonlySet<string>): boolean {
  return namespaces.has(node.tag.namespaceUri ?? '');
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function safeIdPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}:${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function directChild(node: PptxXmlNode, localName: string): PptxXmlNode | undefined {
  return node.children.find((child) => child.tag.localName === localName);
}

function directDescendantPath(
  node: PptxXmlNode,
  ...localNames: readonly string[]
): PptxXmlNode | undefined {
  let current: PptxXmlNode | undefined = node;
  for (const localName of localNames) {
    current = current ? directChild(current, localName) : undefined;
  }
  return current;
}

/**
 * The shared signature parser intentionally rejects leading-slash targets. OPC also permits
 * package-absolute part names, which PptxGenJS emits for charts. Recover only a strictly safe,
 * internal `/part/name` after the shared parser has validated the relationship document and type.
 */
function parseImportRelationships(
  xml: string,
  sourcePartName: string,
  checkDeadline: () => void,
): RelationshipSet {
  const parsed = parseRelationships(xml, sourcePartName, checkDeadline);
  if (parsed.malformed || !parsed.validRoot) return parsed;
  const tree = parsePptxXml(xml, checkDeadline);
  if (!tree.root || tree.malformed) return { ...parsed, malformed: true };
  for (const node of descendants(tree.root, 'Relationship')) {
    if (!isNamespace(node, PACKAGE_RELATIONSHIP_NS)) continue;
    const id = getXmlAttribute(node.tag.attributes, 'Id', 'id');
    const rawTarget = getXmlAttribute(node.tag.attributes, 'Target', 'target')?.trim();
    const targetMode = getXmlAttribute(node.tag.attributes, 'TargetMode', 'targetMode');
    const typeUri = getXmlAttribute(node.tag.attributes, 'Type', 'type');
    const relationship = id ? parsed.byId.get(id) : undefined;
    if (
      !id ||
      !relationship ||
      !relationship.unsafe ||
      targetMode === 'External' ||
      !rawTarget?.startsWith('/') ||
      rawTarget.startsWith('//') ||
      !typeUri
    ) {
      continue;
    }
    const separator = typeUri.lastIndexOf('/');
    const typeBase = separator >= 0 ? typeUri.slice(0, separator) : '';
    const target = rawTarget.slice(1);
    if (!OFFICE_RELATIONSHIP_NS.has(typeBase) || !isSafePackagePath(target)) continue;
    parsed.byId.set(id, { ...relationship, target, unsafe: false });
  }
  return parsed;
}

function resolveColor(
  container: PptxXmlNode | undefined,
  theme: ThemeDefinition,
  colorMap: Readonly<Record<string, string>>,
): string | undefined {
  if (!container) return undefined;
  const color = container.children.find(
    (child) =>
      isNamespace(child, DRAWING_NS) &&
      ['srgbClr', 'sysClr', 'prstClr', 'schemeClr'].includes(child.tag.localName),
  );
  if (!color) return undefined;
  const value = getXmlAttribute(color.tag.attributes, 'val');
  if (color.tag.localName === 'srgbClr' && value && /^[0-9a-f]{6}$/i.test(value)) {
    return `#${value.toUpperCase()}`;
  }
  if (color.tag.localName === 'sysClr') {
    const last = getXmlAttribute(color.tag.attributes, 'lastClr');
    return last && /^[0-9a-f]{6}$/i.test(last) ? `#${last.toUpperCase()}` : undefined;
  }
  if (color.tag.localName === 'prstClr' && value) return PRESET_COLORS[value];
  if (color.tag.localName === 'schemeClr' && value) {
    const role = colorMap[value] ?? value;
    return theme.colors.get(role)?.hex;
  }
  return undefined;
}

function alphaFromColor(container: PptxXmlNode | undefined): number | undefined {
  const alpha = container ? firstDescendant(container, 'alpha') : undefined;
  const raw = parseInteger(alpha ? getXmlAttribute(alpha.tag.attributes, 'val') : undefined);
  return raw === undefined ? undefined : Math.max(0, Math.min(1, raw / 100_000));
}

function presentationTheme(theme: ThemeDefinition): ThemeSpec {
  const canvas = theme.colors.get('lt1')?.hex ?? '#FFFFFF';
  const ink = theme.colors.get('dk1')?.hex ?? '#111827';
  const muted = theme.colors.get('dk2')?.hex ?? '#64748B';
  const accent = theme.colors.get('accent1')?.hex ?? '#2563EB';
  return {
    id: `pptx-theme-${stableHash(`${theme.name}:${canvas}:${ink}:${accent}`)}`,
    name: theme.name,
    mode: canvas.toUpperCase() === '#000000' ? 'dark' : 'light',
    colors: {
      canvas,
      ink,
      muted,
      accent,
      accentSoft: theme.colors.get('accent2')?.hex ?? '#DBEAFE',
      insight: theme.colors.get('accent3')?.hex ?? '#16A34A',
      insightInk: ink,
      trace: theme.colors.get('accent4')?.hex ?? '#7C3AED',
      border: theme.colors.get('dk2')?.hex ?? '#CBD5E1',
    },
    typography: {
      display: theme.majorFont ?? 'Aptos Display',
      body: theme.minorFont ?? 'Aptos',
      data: theme.minorFont ?? 'Aptos',
    },
    defaultRadius: 0,
    spacingUnit: 8,
  };
}

function geometryFor(
  node: PptxXmlNode,
  slideWidthEmu: number,
  slideHeightEmu: number,
): GeometryResult | undefined {
  const xfrm = descendants(node, 'xfrm').find(
    (candidate) => isNamespace(candidate, DRAWING_NS) || isNamespace(candidate, PRESENTATION_NS),
  );
  if (!xfrm) return undefined;
  const off = directChild(xfrm, 'off');
  const ext = directChild(xfrm, 'ext');
  const x = parseInteger(off ? getXmlAttribute(off.tag.attributes, 'x') : undefined);
  const y = parseInteger(off ? getXmlAttribute(off.tag.attributes, 'y') : undefined);
  const cx = parseInteger(ext ? getXmlAttribute(ext.tag.attributes, 'cx') : undefined);
  const cy = parseInteger(ext ? getXmlAttribute(ext.tag.attributes, 'cy') : undefined);
  if (x === undefined || y === undefined || cx === undefined || cy === undefined) return undefined;

  const raw = {
    x: x / slideWidthEmu,
    y: y / slideHeightEmu,
    width: cx / slideWidthEmu,
    height: cy / slideHeightEmu,
  };
  const minimum = 0.001;
  const width = Math.max(minimum, Math.min(1, raw.width));
  const height = Math.max(minimum, Math.min(1, raw.height));
  const normalized: BoundingBox = {
    x: Math.max(0, Math.min(1 - width, raw.x)),
    y: Math.max(0, Math.min(1 - height, raw.y)),
    width,
    height,
  };
  normalized.width = Math.min(normalized.width, 1 - normalized.x);
  normalized.height = Math.min(normalized.height, 1 - normalized.y);
  const rotationRaw = parseInteger(getXmlAttribute(xfrm.tag.attributes, 'rot')) ?? 0;
  const rotation = (((rotationRaw / 60_000) % 360) + 360) % 360;
  const flip =
    getXmlAttribute(xfrm.tag.attributes, 'flipH') === '1' ||
    getXmlAttribute(xfrm.tag.attributes, 'flipV') === '1';
  return {
    bbox: normalized,
    rotation,
    approximated:
      flip ||
      Math.abs(normalized.x - raw.x) > 1e-9 ||
      Math.abs(normalized.y - raw.y) > 1e-9 ||
      Math.abs(normalized.width - raw.width) > 1e-9 ||
      Math.abs(normalized.height - raw.height) > 1e-9,
  };
}

function shapeIdentity(node: PptxXmlNode): {
  sourceId: string;
  name: string;
  objectName: string;
  altText?: string;
} {
  const cNvPr = firstDescendant(node, 'cNvPr');
  const sourceId = cNvPr ? (getXmlAttribute(cNvPr.tag.attributes, 'id') ?? 'unknown') : 'unknown';
  const name = cNvPr
    ? (getXmlAttribute(cNvPr.tag.attributes, 'name') ?? `Object ${sourceId}`)
    : 'Object';
  const description = cNvPr ? getXmlAttribute(cNvPr.tag.attributes, 'descr') : undefined;
  const title = cNvPr ? getXmlAttribute(cNvPr.tag.attributes, 'title') : undefined;
  const altText = description?.trim() || title?.trim() || undefined;
  return { sourceId, name, objectName: name, ...(altText ? { altText } : {}) };
}

function textPayload(
  node: PptxXmlNode,
  theme: ThemeDefinition = EMPTY_THEME,
  colorMap: Readonly<Record<string, string>> = DEFAULT_COLOR_MAP,
): {
  content: string;
  style: ElementStyle;
  complex: boolean;
  hasOmml: boolean;
} {
  const txBody = directChild(node, 'txBody');
  if (!txBody) return { content: '', style: {}, complex: false, hasOmml: false };
  const paragraphs = childNodes(txBody, 'p');
  const content = paragraphs
    .map((paragraph) =>
      descendants(paragraph, 't')
        .filter((text) => isNamespace(text, DRAWING_NS))
        .map((text) => nodeText(text))
        .join(''),
    )
    .join('\n');
  const runProperties = descendants(txBody, 'rPr').filter((item) => isNamespace(item, DRAWING_NS));
  const defaultProperties = descendants(txBody, 'defRPr').filter((item) =>
    isNamespace(item, DRAWING_NS),
  );
  const property = runProperties[0] ?? defaultProperties[0];
  const style: ElementStyle = {};
  if (property) {
    const size = parseInteger(getXmlAttribute(property.tag.attributes, 'sz'));
    if (size !== undefined && size > 0) style.fontSize = size / 100;
    if (getXmlAttribute(property.tag.attributes, 'b') === '1') style.fontWeight = 700;
    const color = resolveColor(firstChild(property, 'solidFill'), theme, colorMap);
    if (color) style.color = color;
    const latin = firstDescendant(property, 'latin');
    const family = latin ? getXmlAttribute(latin.tag.attributes, 'typeface') : undefined;
    if (family && !family.startsWith('+')) style.fontFamily = family;
  }
  const firstParagraphProperties = descendants(txBody, 'pPr')[0];
  const alignment = firstParagraphProperties
    ? getXmlAttribute(firstParagraphProperties.tag.attributes, 'algn')
    : undefined;
  if (alignment === 'ctr') style.textAlign = 'center';
  else if (alignment === 'r') style.textAlign = 'right';
  else if (alignment === 'l') style.textAlign = 'left';
  const spacingPercentage = firstParagraphProperties
    ? firstDescendant(firstParagraphProperties, 'spcPct')
    : undefined;
  const spacingValue = spacingPercentage
    ? parseInteger(getXmlAttribute(spacingPercentage.tag.attributes, 'val'))
    : undefined;
  if (spacingValue !== undefined && spacingValue > 0) style.lineHeight = spacingValue / 100_000;
  const bodyProperties = firstChild(txBody, 'bodyPr');
  const anchor = bodyProperties
    ? getXmlAttribute(bodyProperties.tag.attributes, 'anchor')
    : undefined;
  if (anchor === 'ctr') style.verticalAlign = 'middle';
  else if (anchor === 'b') style.verticalAlign = 'bottom';
  else if (anchor === 't') style.verticalAlign = 'top';
  const signatures = new Set(
    runProperties.map((item) =>
      JSON.stringify({
        sz: getXmlAttribute(item.tag.attributes, 'sz'),
        b: getXmlAttribute(item.tag.attributes, 'b'),
        i: getXmlAttribute(item.tag.attributes, 'i'),
        u: getXmlAttribute(item.tag.attributes, 'u'),
        strike: getXmlAttribute(item.tag.attributes, 'strike'),
        color: resolveColor(firstChild(item, 'solidFill'), theme, colorMap),
        font: getXmlAttribute(firstDescendant(item, 'latin')?.tag.attributes ?? {}, 'typeface'),
      }),
    ),
  );
  const unsupportedRunFormatting = runProperties.some((item) => {
    const italic = getXmlAttribute(item.tag.attributes, 'i');
    const underline = getXmlAttribute(item.tag.attributes, 'u');
    const strike = getXmlAttribute(item.tag.attributes, 'strike');
    return (
      italic === '1' ||
      (underline !== undefined && underline !== 'none') ||
      (strike !== undefined && strike !== 'noStrike') ||
      getXmlAttribute(item.tag.attributes, 'baseline') !== undefined ||
      getXmlAttribute(item.tag.attributes, 'spc') !== undefined
    );
  });
  const complex =
    signatures.size > 1 ||
    unsupportedRunFormatting ||
    descendants(txBody, 'buChar').length > 0 ||
    descendants(txBody, 'buAutoNum').length > 0 ||
    descendants(txBody, 'br').length > 0;
  const hasOmml = descendants(txBody, 'oMath').some((item) => isNamespace(item, MATH_NS));
  return { content, style, complex, hasOmml };
}

const EMPTY_THEME: ThemeDefinition = { name: 'fallback', colors: new Map() };

function shapeStyle(
  node: PptxXmlNode,
  theme: ThemeDefinition,
  colorMap: Readonly<Record<string, string>>,
  textStyle: ElementStyle,
): ElementStyle {
  const style: ElementStyle = { ...textStyle };
  const spPr = directChild(node, 'spPr');
  if (!spPr) return style;
  const solidFill = directChild(spPr, 'solidFill');
  const fill = resolveColor(solidFill, theme, colorMap);
  if (fill) style.fill = fill;
  if (directChild(spPr, 'noFill')) style.fill = 'transparent';
  const line = directChild(spPr, 'ln');
  if (line) {
    const stroke = resolveColor(directChild(line, 'solidFill'), theme, colorMap);
    if (stroke) style.stroke = stroke;
    const width = parseInteger(getXmlAttribute(line.tag.attributes, 'w'));
    if (width !== undefined && width >= 0) style.strokeWidth = width / 12_700;
    if (directChild(line, 'noFill')) style.strokeWidth = 0;
  }
  const opacity = alphaFromColor(solidFill);
  if (opacity !== undefined) style.opacity = opacity;
  return style;
}

function elementCapabilities(): SlideElement['exportCapabilities'] {
  return ['web_native', 'pptx_editable', 'google_importable'];
}

function preferredElementId(
  identity: ReturnType<typeof shapeIdentity>,
  generated: string,
  usedIds: Set<string>,
): { id: string; identityApproximated: boolean } {
  const stableObjectName = isStableId(identity.objectName) ? identity.objectName : undefined;
  const base = stableObjectName ?? generated;
  const collision = usedIds.has(base);
  return {
    id: uniqueId(base, usedIds),
    identityApproximated: !stableObjectName || collision,
  };
}

function incrementItem(context: ImportContext, slideItems: number, partName: string): void {
  if (slideItems > context.bounds.maxItemsPerSlide) {
    throw new ImportFailure(
      'too_many_items',
      `Slide ${partName} exceeds the ${context.bounds.maxItemsPerSlide}-item limit.`,
      partName,
    );
  }
  context.totalItems += 1;
  if (context.totalItems > context.bounds.maxTotalItems) {
    throw new ImportFailure(
      'too_many_items',
      `The presentation exceeds the ${context.bounds.maxTotalItems}-item limit.`,
    );
  }
}

function parseShape(
  node: PptxXmlNode,
  slideId: string,
  slideIndex: number,
  partName: string,
  context: ImportContext,
  usedIds: Set<string>,
  textNode: PptxXmlNode = node,
): SlideElement | undefined {
  const identity = shapeIdentity(node);
  const geometry = geometryFor(node, context.slideWidthEmu, context.slideHeightEmu);
  const text = textPayload(textNode, context.theme, context.colorMap);
  const itemContext = {
    sourcePart: partName,
    sourceId: identity.sourceId,
    sourceObjectName: identity.objectName,
    slideIndex,
  };
  if (text.hasOmml) {
    context.fidelity.add(
      'omml',
      'dropped',
      'Native Office Math (OMML) has no canonical equation mapping and was not claimed as text.',
      itemContext,
    );
  }
  if (!geometry) {
    context.fidelity.add(
      text.content ? 'text' : 'shape',
      'dropped',
      'The object has no direct transform; inherited layout geometry is outside this bounded importer.',
      itemContext,
    );
    return undefined;
  }
  if (!text.content && text.hasOmml) return undefined;

  const preset = firstDescendant(node, 'prstGeom');
  const presetName = preset ? getXmlAttribute(preset.tag.attributes, 'prst') : undefined;
  const spPr = directChild(node, 'spPr');
  const shapeLine = spPr ? directChild(spPr, 'ln') : undefined;
  const hasVisualLine = Boolean(
    shapeLine &&
      !directChild(shapeLine, 'noFill') &&
      (directChild(shapeLine, 'solidFill') || getXmlAttribute(shapeLine.tag.attributes, 'w')),
  );
  const hasVisualShape = Boolean(
    spPr &&
      (directChild(spPr, 'solidFill') ||
        directChild(spPr, 'gradFill') ||
        directChild(spPr, 'pattFill') ||
        hasVisualLine),
  );
  const cNvSpPr = firstDescendant(node, 'cNvSpPr');
  const placeholder = firstDescendant(node, 'ph');
  const authoredTextBox = cNvSpPr && getXmlAttribute(cNvSpPr.tag.attributes, 'txBox') === '1';
  const textOnly =
    Boolean(text.content) &&
    (authoredTextBox ||
      (Boolean(placeholder) && !hasVisualShape) ||
      (!hasVisualShape && !presetName));
  const kind: SlideElement['kind'] = textOnly ? 'text' : 'shape';
  const identityResult = preferredElementId(
    identity,
    `${context.deckId}:pptx:s${slideIndex}:e${safeIdPart(identity.sourceId, 'shape')}`,
    usedIds,
  );
  const id = identityResult.id;
  const style = shapeStyle(node, context.theme, context.colorMap, text.style);
  const approximationReasons: string[] = [];
  if (geometry.approximated)
    approximationReasons.push('geometry was clamped or flipping was removed');
  if (text.complex) approximationReasons.push('rich text runs or bullets were flattened');
  if (identityResult.identityApproximated && isStableId(identity.objectName)) {
    approximationReasons.push('a colliding objectName required a de-duplicated canonical ID');
  }
  if (presetName && !['rect', 'roundRect'].includes(presetName)) {
    approximationReasons.push(`preset geometry ${presetName} was reduced to the canonical shape`);
  }
  if (spPr && (directChild(spPr, 'gradFill') || directChild(spPr, 'pattFill'))) {
    approximationReasons.push('gradient or pattern fill was reduced to available solid styling');
  }
  if (
    spPr &&
    ['tint', 'shade', 'lum', 'lumMod', 'lumOff', 'satMod', 'alphaMod', 'alphaOff'].some(
      (transform) => descendants(spPr, transform).length > 0,
    )
  ) {
    approximationReasons.push('DrawingML color transforms were simplified');
  }
  const dash = spPr ? firstDescendant(spPr, 'prstDash') : undefined;
  if (dash && getXmlAttribute(dash.tag.attributes, 'val') !== 'solid') {
    approximationReasons.push('custom line dashing was not retained');
  }
  const fidelity: PptxImportFidelity = approximationReasons.length > 0 ? 'approximated' : 'native';
  context.fidelity.add(
    kind === 'text' ? 'text' : 'shape',
    fidelity,
    approximationReasons.length > 0
      ? approximationReasons.join('; ')
      : `Basic ${kind} content and geometry were mapped directly.`,
    { ...itemContext, targetId: id },
  );
  return {
    id,
    slideId,
    name: identity.name,
    kind,
    bbox: geometry.bbox,
    rotation: geometry.rotation,
    ...(text.content ? { content: text.content } : {}),
    style,
    ...(identity.altText ? { altText: identity.altText } : {}),
    sourceIds: [],
    locked: false,
    exportCapabilities: elementCapabilities(),
    version: 1,
  };
}

function parseConnector(
  node: PptxXmlNode,
  slideId: string,
  slideIndex: number,
  partName: string,
  context: ImportContext,
  usedIds: Set<string>,
): SlideElement | undefined {
  const identity = shapeIdentity(node);
  const geometry = geometryFor(node, context.slideWidthEmu, context.slideHeightEmu);
  const itemContext = {
    sourcePart: partName,
    sourceId: identity.sourceId,
    sourceObjectName: identity.objectName,
    slideIndex,
  };
  if (!geometry) {
    context.fidelity.add(
      'connector',
      'dropped',
      'The connector has no usable transform.',
      itemContext,
    );
    return undefined;
  }
  const identityResult = preferredElementId(
    identity,
    `${context.deckId}:pptx:s${slideIndex}:e${safeIdPart(identity.sourceId, 'connector')}`,
    usedIds,
  );
  const id = identityResult.id;
  const line = firstDescendant(node, 'ln');
  const hasArrowheads = Boolean(
    line && (firstDescendant(line, 'headEnd') || firstDescendant(line, 'tailEnd')),
  );
  const style = shapeStyle(node, context.theme, context.colorMap, {});
  context.fidelity.add(
    'connector',
    geometry.approximated ||
      hasArrowheads ||
      (identityResult.identityApproximated && isStableId(identity.objectName))
      ? 'approximated'
      : 'native',
    hasArrowheads
      ? 'Connector geometry was retained, but arrowhead metadata is not represented canonically.'
      : geometry.approximated
        ? 'Zero-sized or out-of-bounds connector geometry was normalized.'
        : 'Basic connector geometry and line styling were mapped directly.',
    { ...itemContext, targetId: id },
  );
  return {
    id,
    slideId,
    name: identity.name,
    kind: 'connector',
    bbox: geometry.bbox,
    rotation: geometry.rotation,
    style,
    ...(identity.altText ? { altText: identity.altText } : {}),
    sourceIds: [],
    locked: false,
    exportCapabilities: elementCapabilities(),
    version: 1,
  };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(packed >>> 18) & 63] ?? '';
    result += BASE64_ALPHABET[(packed >>> 12) & 63] ?? '';
    result += index + 1 < bytes.length ? (BASE64_ALPHABET[(packed >>> 6) & 63] ?? '') : '=';
    result += index + 2 < bytes.length ? (BASE64_ALPHABET[packed & 63] ?? '') : '=';
  }
  return result;
}

function imageMimeType(partName: string): string | undefined {
  const extension = partName.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  return undefined;
}

async function parseImage(
  node: PptxXmlNode,
  relationships: RelationshipSet,
  slideId: string,
  slideIndex: number,
  partName: string,
  context: ImportContext,
  usedIds: Set<string>,
): Promise<SlideElement | undefined> {
  const identity = shapeIdentity(node);
  const geometry = geometryFor(node, context.slideWidthEmu, context.slideHeightEmu);
  const blip = firstDescendant(node, 'blip');
  const relationshipId = blip ? attrLocal(blip, 'embed') : undefined;
  const relationship = relationshipId ? relationships.byId.get(relationshipId) : undefined;
  const itemContext = {
    sourcePart: partName,
    sourceId: identity.sourceId,
    sourceObjectName: identity.objectName,
    slideIndex,
  };
  if (!geometry || !relationship?.target || relationship.type !== 'image' || relationship.unsafe) {
    context.fidelity.add(
      'image',
      'dropped',
      'The image has no safe embedded relationship or usable geometry.',
      itemContext,
    );
    return undefined;
  }
  const mimeType = imageMimeType(relationship.target);
  if (!mimeType) {
    context.fidelity.add(
      'image',
      'dropped',
      `Embedded image format in ${relationship.target} is unsupported.`,
      itemContext,
    );
    return undefined;
  }
  const bytes = await context.reader.readMedia(relationship.target);
  if (!bytes) {
    context.fidelity.add('image', 'dropped', 'The embedded image part is missing.', itemContext);
    return undefined;
  }
  const identityResult = preferredElementId(
    identity,
    `${context.deckId}:pptx:s${slideIndex}:e${safeIdPart(identity.sourceId, 'image')}`,
    usedIds,
  );
  const id = identityResult.id;
  const cropped = descendants(node, 'srcRect').length > 0;
  context.fidelity.add(
    'image',
    geometry.approximated || cropped ? 'approximated' : 'native',
    cropped
      ? 'Embedded image pixels were retained, but source cropping was not represented.'
      : geometry.approximated
        ? 'Embedded image pixels were retained with normalized geometry.'
        : 'Embedded image pixels and geometry were mapped directly.',
    { ...itemContext, targetId: id },
  );
  return {
    id,
    slideId,
    name: identity.name,
    kind: 'image',
    bbox: geometry.bbox,
    rotation: geometry.rotation,
    style: {},
    image: { placeholder: false },
    imageUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    altText: identity.altText ?? identity.name,
    sourceIds: [],
    locked: false,
    exportCapabilities: elementCapabilities(),
    version: 1,
  };
}

function cachedPoints(container: PptxXmlNode | undefined): string[] {
  if (!container) return [];
  return descendants(container, 'pt')
    .filter((point) => isNamespace(point, CHART_NS))
    .map((point) => ({
      index: parseInteger(getXmlAttribute(point.tag.attributes, 'idx')) ?? Number.MAX_SAFE_INTEGER,
      value: firstDescendant(point, 'v'),
    }))
    .sort((left, right) => left.index - right.index)
    .map((point) => (point.value ? nodeText(point.value).trim() : ''));
}

function chartData(chartRoot: PptxXmlNode): ChartData | undefined {
  const chartKinds = [
    ['barChart', 'bar'],
    ['lineChart', 'line'],
    ['areaChart', 'area'],
    ['doughnutChart', 'donut'],
  ] as const;
  const match = chartKinds
    .map(([nodeName, chartType]) => ({
      node: descendants(chartRoot, nodeName).find((item) => isNamespace(item, CHART_NS)),
      chartType,
    }))
    .find((candidate) => candidate.node);
  if (!match?.node) return undefined;
  const seriesNodes = childNodes(match.node, 'ser').filter((item) => isNamespace(item, CHART_NS));
  const series = seriesNodes.flatMap((seriesNode, seriesIndex) => {
    const values = cachedPoints(firstChild(seriesNode, 'val')).map(Number);
    if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return [];
    const nameValues = cachedPoints(firstChild(seriesNode, 'tx'));
    const directName = firstDescendant(firstChild(seriesNode, 'tx') ?? seriesNode, 'v');
    const name =
      nameValues[0] ||
      (directName ? nodeText(directName).trim() : '') ||
      `Series ${seriesIndex + 1}`;
    const color = resolveColor(
      directDescendantPath(seriesNode, 'spPr', 'solidFill'),
      EMPTY_THEME,
      DEFAULT_COLOR_MAP,
    );
    return [{ name, values, ...(color ? { color } : {}) }];
  });
  if (series.length === 0) return undefined;
  const firstSeries = seriesNodes[0];
  let labels = cachedPoints(firstSeries ? firstChild(firstSeries, 'cat') : undefined);
  const length = Math.max(...series.map((item) => item.values.length));
  if (labels.length === 0) labels = Array.from({ length }, (_, index) => String(index + 1));
  return { chartType: match.chartType, labels, series };
}

async function parseGraphicFrame(
  node: PptxXmlNode,
  relationships: RelationshipSet,
  slideId: string,
  slideIndex: number,
  partName: string,
  context: ImportContext,
  usedIds: Set<string>,
): Promise<SlideElement | undefined> {
  const identity = shapeIdentity(node);
  const geometry = geometryFor(node, context.slideWidthEmu, context.slideHeightEmu);
  const itemContext = {
    sourcePart: partName,
    sourceId: identity.sourceId,
    sourceObjectName: identity.objectName,
    slideIndex,
  };
  const graphicData = firstDescendant(node, 'graphicData');
  const uri = graphicData ? (getXmlAttribute(graphicData.tag.attributes, 'uri') ?? '') : '';
  if (/diagram/i.test(uri) || descendants(node, 'relIds').length > 0) {
    context.fidelity.add(
      'smartart',
      'dropped',
      'SmartArt/diagram semantics and transforms are unsupported.',
      itemContext,
    );
    return undefined;
  }
  if (/table/i.test(uri) || descendants(node, 'tbl').length > 0) {
    context.fidelity.add(
      'table',
      'dropped',
      'Native PowerPoint tables are unsupported.',
      itemContext,
    );
    return undefined;
  }
  const chartReference = descendants(node, 'chart').find((item) => isNamespace(item, CHART_NS));
  const relationshipId = chartReference ? attrLocal(chartReference, 'id') : undefined;
  const relationship = relationshipId ? relationships.byId.get(relationshipId) : undefined;
  if (
    !chartReference ||
    !relationship?.target ||
    relationship.type !== 'chart' ||
    relationship.unsafe
  ) {
    context.fidelity.add(
      'unsupported_object',
      'dropped',
      'The graphic frame is neither a safe simple chart nor another supported object.',
      itemContext,
    );
    return undefined;
  }
  if (!geometry) {
    context.fidelity.add('chart', 'dropped', 'The chart has no usable transform.', itemContext);
    return undefined;
  }
  const xml = await context.reader.readXml(relationship.target);
  if (!xml) {
    context.fidelity.add('chart', 'dropped', 'The chart part is missing.', itemContext);
    return undefined;
  }
  const parsed = parsePptxXml(xml, context.checkDeadline);
  const data = parsed.root && !parsed.malformed ? chartData(parsed.root) : undefined;
  if (!data) {
    context.fidelity.add(
      'chart',
      'dropped',
      'Only cached bar, line, area, and doughnut chart series are supported.',
      itemContext,
    );
    return undefined;
  }
  const identityResult = preferredElementId(
    identity,
    `${context.deckId}:pptx:s${slideIndex}:e${safeIdPart(identity.sourceId, 'chart')}`,
    usedIds,
  );
  const id = identityResult.id;
  context.fidelity.add(
    'chart',
    'approximated',
    'Cached simple chart data was retained; PowerPoint chart styling, axes, and formulas were simplified.',
    { ...itemContext, targetId: id },
  );
  return {
    id,
    slideId,
    name: identity.name,
    kind: 'chart',
    bbox: geometry.bbox,
    rotation: geometry.rotation,
    style: {},
    chart: data,
    ...(identity.altText ? { altText: identity.altText } : {}),
    sourceIds: [],
    locked: false,
    exportCapabilities: elementCapabilities(),
    version: 1,
  };
}

function slideBackground(
  root: PptxXmlNode,
  context: ImportContext,
  slideIndex: number,
  partName: string,
): string {
  const cSld = firstChild(root, 'cSld');
  const background = cSld ? directChild(cSld, 'bg') : undefined;
  const solid = background
    ? (directDescendantPath(background, 'bgPr', 'solidFill') ??
      directDescendantPath(background, 'bgRef', 'schemeClr'))
    : undefined;
  const color = solid
    ? solid.tag.localName === 'schemeClr'
      ? resolveColor({ ...solid, children: [solid] }, context.theme, context.colorMap)
      : resolveColor(solid, context.theme, context.colorMap)
    : undefined;
  if (color) {
    context.fidelity.add('background', 'native', 'A direct solid slide background was retained.', {
      sourcePart: partName,
      slideIndex,
    });
    return color;
  }
  context.fidelity.add(
    'background',
    'approximated',
    background
      ? 'Gradient, image, or pattern background was reduced to the imported theme canvas color.'
      : 'Inherited master/layout background was reduced to the imported theme canvas color.',
    { sourcePart: partName, slideIndex },
  );
  return presentationTheme(context.theme).colors.canvas;
}

async function slideNotes(
  relationships: RelationshipSet,
  context: ImportContext,
  slideIndex: number,
  partName: string,
): Promise<string | undefined> {
  const relationship = [...relationships.byId.values()].find(
    (candidate) => candidate.type === 'notesSlide' && candidate.target && !candidate.unsafe,
  );
  if (!relationship?.target) return undefined;
  const xml = await context.reader.readXml(relationship.target);
  if (!xml) {
    context.fidelity.add('notes', 'dropped', 'The notes relationship points to a missing part.', {
      sourcePart: partName,
      slideIndex,
    });
    return undefined;
  }
  const parsed = parsePptxXml(xml, context.checkDeadline);
  if (!parsed.root || parsed.malformed) {
    context.fidelity.add('notes', 'dropped', 'The notes part is malformed.', {
      sourcePart: relationship.target,
      slideIndex,
    });
    return undefined;
  }
  const shapeTexts = descendants(parsed.root, 'sp')
    .filter((shape) => isNamespace(shape, PRESENTATION_NS))
    .flatMap((shape) => {
      const placeholder = firstDescendant(shape, 'ph');
      const type = placeholder ? getXmlAttribute(placeholder.tag.attributes, 'type') : undefined;
      if (type && ['hdr', 'ftr', 'dt', 'sldNum'].includes(type)) return [];
      const text = textPayload(shape).content.trim();
      return text ? [text] : [];
    });
  const notes = shapeTexts.join('\n').trim();
  if (notes) {
    context.fidelity.add('notes', 'native', 'Speaker-note text was retained.', {
      sourcePart: relationship.target,
      slideIndex,
    });
  }
  return notes || undefined;
}

function reportUnsupportedRelationships(
  relationships: RelationshipSet,
  context: ImportContext,
  slideIndex: number,
  partName: string,
): void {
  for (const relationship of relationships.byId.values()) {
    const itemContext = { sourcePart: partName, sourceId: relationship.id, slideIndex };
    if (['audio', 'video', 'media'].includes(relationship.type)) {
      context.fidelity.add(
        'media',
        'dropped',
        'Embedded audio/video media is unsupported.',
        itemContext,
      );
    } else if (['oleObject', 'package'].includes(relationship.type)) {
      context.fidelity.add(
        'ole',
        'dropped',
        'OLE/package embeddings are unsupported.',
        itemContext,
      );
    } else if (relationship.type.startsWith('diagram')) {
      context.fidelity.add(
        'smartart',
        'dropped',
        'SmartArt relationship data is unsupported.',
        itemContext,
      );
    }
  }
}

async function parseSlide(
  partName: string,
  slideIndex: number,
  context: ImportContext,
): Promise<{ slide: Slide; elements: SlideElement[] }> {
  const xml = await context.reader.readXml(partName, true);
  if (!xml) throw new ImportFailure('invalid_pptx', 'A required slide part is missing.', partName);
  const parsed = parsePptxXml(xml, context.checkDeadline);
  if (
    !parsed.root ||
    parsed.malformed ||
    parsed.root.tag.localName !== 'sld' ||
    !isNamespace(parsed.root, PRESENTATION_NS)
  ) {
    throw new ImportFailure('invalid_pptx', `Slide part ${partName} is malformed.`, partName);
  }
  const relationshipsXml = await context.reader.readXml(relationshipPartName(partName));
  const relationships = relationshipsXml
    ? parseImportRelationships(relationshipsXml, partName, context.checkDeadline)
    : { byId: new Map(), malformed: false, validRoot: true };
  if (relationships.malformed || !relationships.validRoot) {
    throw new ImportFailure(
      'invalid_pptx',
      `Slide relationships for ${partName} are malformed.`,
      partName,
    );
  }
  reportUnsupportedRelationships(relationships, context, slideIndex, partName);

  if (descendants(parsed.root, 'timing').some((item) => isNamespace(item, PRESENTATION_NS))) {
    context.fidelity.add('animation', 'dropped', 'Slide animations and timing are unsupported.', {
      sourcePart: partName,
      slideIndex,
    });
  }
  const usedIds = context.usedElementIds;
  const elements: SlideElement[] = [];
  const spTree = firstDescendant(parsed.root, 'spTree');
  const packageObjectNodes = spTree
    ? spTree.children.filter((node) => !['nvGrpSpPr', 'grpSpPr'].includes(node.tag.localName))
    : [];
  const slideMarker = packageObjectNodes.find((node) =>
    shapeIdentity(node).objectName.startsWith(NODESLIDE_PPTX_SLIDE_ID_PREFIX),
  );
  const markedSlideId = slideMarker
    ? shapeIdentity(slideMarker).objectName.slice(NODESLIDE_PPTX_SLIDE_ID_PREFIX.length)
    : '';
  const slideId = isStableId(markedSlideId)
    ? markedSlideId
    : `${context.deckId}:pptx:slide:${slideIndex}`;
  const objectNodes = packageObjectNodes.filter((node) => node !== slideMarker);
  const identityNodes = objectNodes.filter((node) =>
    ['sp', 'cxnSp', 'pic', 'graphicFrame', 'grpSp'].includes(node.tag.localName),
  );
  const objectNames = new Set(identityNodes.map((node) => shapeIdentity(node).objectName));
  const companionByBaseId = new Map<string, PptxXmlNode>();
  const fallbackLabelByBaseId = new Map<string, PptxXmlNode>();
  const fallbackShapeNames = new Set(
    identityNodes
      .map((node) => shapeIdentity(node).objectName)
      .filter((name) => name.endsWith(':fallback-shape')),
  );
  for (const node of identityNodes) {
    const objectName = shapeIdentity(node).objectName;
    if (objectName.endsWith(':fallback-label')) {
      const baseId = objectName.slice(0, -':fallback-label'.length);
      if (isStableId(baseId) && fallbackShapeNames.has(`${baseId}:fallback-shape`)) {
        fallbackLabelByBaseId.set(baseId, node);
      }
    }
    if (!objectName.endsWith(':text')) continue;
    const baseId = objectName.slice(0, -':text'.length);
    if (isStableId(baseId) && objectNames.has(baseId)) companionByBaseId.set(baseId, node);
  }
  const shapeHandledOmml = new Set(
    identityNodes
      .filter(
        (node) =>
          node.tag.localName === 'sp' &&
          !companionByBaseId.has(shapeIdentity(node).objectName.slice(0, -':text'.length)),
      )
      .flatMap((node) => descendants(node, 'oMath')),
  );
  for (const omml of descendants(parsed.root, 'oMath')) {
    if (!isNamespace(omml, MATH_NS) || shapeHandledOmml.has(omml)) continue;
    context.fidelity.add(
      'omml',
      'dropped',
      'Native Office Math (OMML) inside an unsupported container was not imported as plain text.',
      { sourcePart: partName, slideIndex },
    );
  }
  let slideItems = 0;
  for (const node of objectNodes) {
    context.checkDeadline();
    slideItems += 1;
    incrementItem(context, slideItems, partName);
    const identity = shapeIdentity(node);
    if (identity.objectName.endsWith(':fallback-label')) {
      const baseId = identity.objectName.slice(0, -':fallback-label'.length);
      if (fallbackLabelByBaseId.get(baseId) === node) {
        context.fidelity.add(
          'unsupported_object',
          'approximated',
          'NodeSlide editable fallback label was merged back into its stable source object.',
          {
            sourcePart: partName,
            sourceId: identity.sourceId,
            sourceObjectName: identity.objectName,
            slideIndex,
            targetId: baseId,
          },
        );
        continue;
      }
    }
    if (
      identity.objectName.endsWith(':text') &&
      companionByBaseId.get(identity.objectName.slice(0, -':text'.length)) === node
    ) {
      const baseId = identity.objectName.slice(0, -':text'.length);
      context.fidelity.add(
        'text',
        'native',
        'NodeSlide shape-copy companion text was merged into its primary shape instead of duplicated.',
        {
          sourcePart: partName,
          sourceId: identity.sourceId,
          sourceObjectName: identity.objectName,
          slideIndex,
          targetId: baseId,
        },
      );
      continue;
    }
    let element: SlideElement | undefined;
    if (node.tag.localName === 'sp') {
      const presetGeometry = firstDescendant(node, 'prstGeom');
      const presetName = presetGeometry
        ? getXmlAttribute(presetGeometry.tag.attributes, 'prst')
        : undefined;
      element =
        presetName === 'line'
          ? parseConnector(node, slideId, slideIndex, partName, context, usedIds)
          : parseShape(
              node,
              slideId,
              slideIndex,
              partName,
              context,
              usedIds,
              identity.objectName.endsWith(':fallback-shape')
                ? (fallbackLabelByBaseId.get(
                    identity.objectName.slice(0, -':fallback-shape'.length),
                  ) ?? node)
                : (companionByBaseId.get(identity.objectName) ?? node),
            );
    } else if (node.tag.localName === 'cxnSp') {
      element = parseConnector(node, slideId, slideIndex, partName, context, usedIds);
    } else if (node.tag.localName === 'pic') {
      element = await parseImage(
        node,
        relationships,
        slideId,
        slideIndex,
        partName,
        context,
        usedIds,
      );
    } else if (node.tag.localName === 'graphicFrame') {
      element = await parseGraphicFrame(
        node,
        relationships,
        slideId,
        slideIndex,
        partName,
        context,
        usedIds,
      );
    } else if (node.tag.localName === 'grpSp') {
      const identity = shapeIdentity(node);
      context.fidelity.add(
        'grouped_transform',
        'dropped',
        'Grouped transforms are unsupported; grouped children were not silently imported out of context.',
        {
          sourcePart: partName,
          sourceId: identity.sourceId,
          sourceObjectName: identity.objectName,
          slideIndex,
        },
      );
    } else {
      const identity = shapeIdentity(node);
      context.fidelity.add(
        'unsupported_object',
        'dropped',
        `Top-level OOXML object ${node.tag.localName} is outside the bounded import subset.`,
        {
          sourcePart: partName,
          sourceId: identity.sourceId,
          sourceObjectName: identity.objectName,
          slideIndex,
        },
      );
    }
    if (element && identity.objectName.endsWith(':fallback-shape')) {
      const baseId = identity.objectName.slice(0, -':fallback-shape'.length);
      if (fallbackLabelByBaseId.has(baseId) && isStableId(baseId)) {
        usedIds.delete(element.id);
        element.id = uniqueId(baseId, usedIds);
        usedIds.add(element.id);
      }
    }
    if (element) elements.push(element);
  }

  const titleNode = identityNodes.find((node) => {
    const placeholder = firstDescendant(node, 'ph');
    const type = placeholder ? getXmlAttribute(placeholder.tag.attributes, 'type') : undefined;
    return type === 'title' || type === 'ctrTitle';
  });
  const titleTextNode = titleNode
    ? (companionByBaseId.get(shapeIdentity(titleNode).objectName) ?? titleNode)
    : undefined;
  const title =
    (titleTextNode
      ? textPayload(titleTextNode, context.theme, context.colorMap).content.trim()
      : '') ||
    elements.find((element) => element.content?.trim())?.content?.trim() ||
    `Slide ${slideIndex}`;
  const notes = await slideNotes(relationships, context, slideIndex, partName);
  const background = slideBackground(parsed.root, context, slideIndex, partName);
  context.fidelity.add('slide', 'native', 'Slide identity and z-order were retained.', {
    sourcePart: partName,
    slideIndex,
    targetId: slideId,
  });
  return {
    slide: {
      id: slideId,
      deckId: context.deckId,
      title: title.slice(0, 160),
      ...(notes ? { notes } : {}),
      background,
      elementOrder: elements.map((element) => element.id),
      version: 1,
    },
    elements,
  };
}

function fileStem(fileName: string | undefined): string | undefined {
  const normalized = fileName
    ?.trim()
    .replace(/\.[^.]+$/, '')
    .trim();
  return normalized || undefined;
}

async function coreTitle(
  reader: PackageReader,
  checkDeadline: () => void,
): Promise<string | undefined> {
  const xml = await reader.readXml('docProps/core.xml');
  if (!xml) return undefined;
  const parsed = parsePptxXml(xml, checkDeadline);
  if (!parsed.root || parsed.malformed) return undefined;
  const title = descendants(parsed.root, 'title')[0];
  return title ? nodeText(title).trim() || undefined : undefined;
}

function failureResult(error: unknown, fidelity: FidelityCollector): PptxImportResult {
  if (error instanceof ImportFailure) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.partName ? { partName: error.partName } : {}),
      },
      fidelity: fidelity.report(),
    };
  }
  if (error instanceof ZipMetadataFailure) {
    return {
      ok: false,
      error: {
        code: error.code === 'archive_too_large' ? 'archive_too_large' : 'invalid_zip',
        message: 'The ZIP directory is invalid or exceeds import bounds.',
      },
      fidelity: fidelity.report(),
    };
  }
  return {
    ok: false,
    error: { code: 'invalid_zip', message: 'The file is not a readable OOXML presentation.' },
    fidelity: fidelity.report(),
  };
}

/** Parse a bounded OOXML package into a standalone, validated canonical snapshot. No writes occur. */
export async function importPptxSnapshot(
  input: ArrayBuffer | Uint8Array,
  options: PptxImportOptions,
): Promise<PptxImportResult> {
  let bounds: PptxImportBounds;
  try {
    bounds = normalizedBounds(options.bounds);
  } catch (error) {
    const fidelity = new FidelityCollector(DEFAULT_PPTX_IMPORT_BOUNDS.maxFidelityItems);
    return failureResult(error, fidelity);
  }
  const fidelity = new FidelityCollector(bounds.maxFidelityItems);
  try {
    const bytes = inputBytes(input);
    if (bytes.byteLength > bounds.maxInputBytes) {
      throw new ImportFailure('archive_too_large', 'The PPTX exceeds the compressed input limit.');
    }
    const startedAt = Date.now();
    const checkDeadline = (): void => {
      if (Date.now() - startedAt > bounds.maxDurationMs) {
        throw new ImportFailure('deadline_exceeded', 'PPTX import exceeded its time limit.');
      }
    };
    const directory = readZipDirectory(bytes, bounds.maxEntries);
    const aggregate = directory.reduce((total, entry) => total + entry.uncompressedSize, 0);
    if (!Number.isSafeInteger(aggregate) || aggregate > bounds.maxAggregateUncompressedBytes) {
      throw new ImportFailure(
        'archive_too_large',
        'The PPTX exceeds the uncompressed package limit.',
      );
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes, { createFolders: false });
    } catch {
      throw new ImportFailure('invalid_zip', 'The file is not a readable ZIP package.');
    }
    const maps = buildPackageMaps(zip, directory);
    const reader = new PackageReader(maps.entries, maps.sizes, bounds, checkDeadline);
    const presentationXml = await reader.readXml('ppt/presentation.xml', true);
    const relationshipsXml = await reader.readXml('ppt/_rels/presentation.xml.rels', true);
    if (!presentationXml || !relationshipsXml) {
      throw new ImportFailure('invalid_pptx', 'The package does not contain a presentation root.');
    }
    const metadata = parsePresentationMetadata(presentationXml, checkDeadline);
    const relationships = parseImportRelationships(
      relationshipsXml,
      'ppt/presentation.xml',
      checkDeadline,
    );
    if (
      metadata.malformed ||
      !metadata.validRoot ||
      relationships.malformed ||
      !relationships.validRoot ||
      metadata.slideWidthEmu <= 0 ||
      metadata.slideHeightEmu <= 0
    ) {
      throw new ImportFailure(
        'invalid_pptx',
        'Presentation metadata or relationships are malformed.',
      );
    }
    if (metadata.slideRelationshipIds.length === 0) {
      throw new ImportFailure('invalid_pptx', 'The presentation contains no slides.');
    }
    if (metadata.slideRelationshipIds.length > bounds.maxSlides) {
      throw new ImportFailure(
        'too_many_slides',
        `The presentation exceeds the ${bounds.maxSlides}-slide import limit.`,
      );
    }

    const slideParts = metadata.slideRelationshipIds.map((relationshipId) => {
      const relationship = relationships.byId.get(relationshipId);
      if (
        !relationship?.target ||
        relationship.type !== 'slide' ||
        relationship.unsafe ||
        !reader.has(relationship.target)
      ) {
        throw new ImportFailure(
          'invalid_pptx',
          `Slide relationship ${relationshipId} is missing or unsafe.`,
        );
      }
      return relationship.target;
    });
    const themeRelationship = [...relationships.byId.values()].find(
      (relationship) =>
        relationship.type === 'theme' && relationship.target && !relationship.unsafe,
    );
    let theme: ThemeDefinition = EMPTY_THEME;
    if (themeRelationship?.target) {
      const themeXml = await reader.readXml(themeRelationship.target);
      if (themeXml) {
        const parsedTheme = parseTheme(themeXml, checkDeadline);
        if (!parsedTheme.malformed && parsedTheme.validRoot) theme = parsedTheme.theme;
      }
    }
    if (theme === EMPTY_THEME) {
      theme = {
        name: 'Imported PowerPoint',
        colors: new Map([
          ['lt1', { colorSpace: 'srgb', components: [1, 1, 1], hex: '#FFFFFF' }],
          ['dk1', { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' }],
          ['accent1', { colorSpace: 'srgb', components: [0.145, 0.388, 0.922], hex: '#2563EB' }],
        ]),
      };
    }
    const deckId = safeIdPart(
      options.deckId,
      `deck-pptx-${stableHash(options.fileName ?? 'import')}`,
    );
    const context: ImportContext = {
      bounds,
      checkDeadline,
      fidelity,
      reader,
      theme,
      colorMap: DEFAULT_COLOR_MAP,
      slideWidthEmu: metadata.slideWidthEmu,
      slideHeightEmu: metadata.slideHeightEmu,
      deckId,
      usedElementIds: new Set(),
      totalItems: 0,
    };
    const aspectRatio = metadata.slideWidthEmu / metadata.slideHeightEmu;
    fidelity.add(
      'slide_dimensions',
      Math.abs(aspectRatio - 16 / 9) < 0.001 ? 'native' : 'approximated',
      Math.abs(aspectRatio - 16 / 9) < 0.001
        ? 'Source dimensions match the canonical 16:9 canvas; geometry is normalized.'
        : 'Source geometry was normalized, but the canonical renderer uses a 16:9 canvas.',
      { sourcePart: 'ppt/presentation.xml' },
    );
    fidelity.add('slide_order', 'native', 'Presentation relationship order was retained.', {
      sourcePart: 'ppt/presentation.xml',
    });
    for (const name of reader.entryNames()) {
      if (/vbaProject\.bin$/i.test(name)) {
        fidelity.add('macro', 'dropped', 'VBA macros are never imported or executed.', {
          sourcePart: name,
        });
      }
    }

    const parsedSlides = [];
    for (let index = 0; index < slideParts.length; index += 1) {
      const partName = slideParts[index];
      if (!partName) continue;
      parsedSlides.push(await parseSlide(partName, index + 1, context));
    }
    const timestamp = options.timestamp ?? 0;
    const title =
      options.title?.trim() ||
      (await coreTitle(reader, checkDeadline)) ||
      fileStem(options.fileName) ||
      'Imported presentation';
    const slides = parsedSlides.map((item) => item.slide);
    const elements = parsedSlides.flatMap((item) => item.elements);
    const snapshot: DeckSnapshot = {
      deck: {
        schemaVersion: NODESLIDE_SCHEMA_VERSION,
        toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
        id: deckId,
        projectId: safeIdPart(options.projectId, 'project-import'),
        title: title.slice(0, 160),
        brief: {
          prompt: `Imported from ${options.fileName ?? 'PowerPoint'}`,
          audience: 'Imported presentation audience',
          purpose: 'Preserve supported PowerPoint content in canonical SlideLang form.',
          successCriteria: ['Review every approximated or dropped item in the fidelity report.'],
        },
        theme: presentationTheme(theme),
        slideOrder: slides.map((slide) => slide.id),
        version: 1,
        status: 'draft',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      slides,
      elements,
      sources: [],
    };
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      throw new ImportFailure(
        'candidate_invalid',
        'The imported snapshot failed canonical schema validation.',
      );
    }
    fidelity.add('presentation', 'native', 'A validated canonical snapshot was produced.', {
      sourcePart: 'ppt/presentation.xml',
      targetId: deckId,
    });
    return {
      ok: true,
      snapshot,
      validation,
      fidelity: fidelity.report(),
      source: {
        ...(options.fileName ? { fileName: options.fileName } : {}),
        slideWidthEmu: metadata.slideWidthEmu,
        slideHeightEmu: metadata.slideHeightEmu,
        aspectRatio,
        slideCount: slides.length,
        importedElementCount: elements.length,
      },
    };
  } catch (error) {
    return failureResult(error, fidelity);
  }
}

function rekeyImportedSnapshot(snapshot: DeckSnapshot, base: DeckSnapshot): DeckSnapshot {
  // Existing destination IDs are intentionally not reserved. The candidate stages a temporary
  // empty slide, removes destination slides, then adds imported slides so valid round-trip IDs can
  // be reused without colliding inside applyDeckPatch.
  const usedSlideIds = new Set<string>();
  const usedElementIds = new Set<string>();
  const slideIdMap = new Map<string, string>();
  for (const slideId of snapshot.deck.slideOrder) {
    slideIdMap.set(slideId, uniqueId(slideId, usedSlideIds));
  }
  const elementIdMap = new Map<string, string>();
  for (const element of snapshot.elements) {
    elementIdMap.set(element.id, uniqueId(element.id, usedElementIds));
  }
  const slides = snapshot.slides.map((slide) => ({
    ...structuredClone(slide),
    id: slideIdMap.get(slide.id) ?? slide.id,
    deckId: base.deck.id,
    elementOrder: slide.elementOrder.map((id) => elementIdMap.get(id) ?? id),
  }));
  const elements = snapshot.elements.map((element) => ({
    ...structuredClone(element),
    id: elementIdMap.get(element.id) ?? element.id,
    slideId: slideIdMap.get(element.slideId) ?? element.slideId,
  }));
  return {
    deck: {
      ...structuredClone(snapshot.deck),
      id: base.deck.id,
      projectId: base.deck.projectId,
      slideOrder: snapshot.deck.slideOrder.map((id) => slideIdMap.get(id) ?? id),
    },
    slides,
    elements,
    sources: [],
  };
}

function withCandidateFidelity(
  report: PptxImportFidelityReport,
  limit: number,
): PptxImportFidelityReport {
  if (report.items.length >= limit) {
    throw new ImportFailure(
      'too_many_items',
      `The candidate fidelity report exceeds its bounded ${limit}-item limit.`,
    );
  }
  const items = [
    ...report.items,
    {
      id: `fidelity:${report.items.length + 1}`,
      feature: 'presentation' as const,
      fidelity: 'approximated' as const,
      reason:
        'The CAS candidate preserves the destination deck theme and sources because the canonical patch vocabulary has no deck-theme/source replacement operation.',
    },
  ];
  const summary = {
    native: report.summary.native,
    approximated: report.summary.approximated + 1,
    dropped: report.summary.dropped,
  };
  return { items, summary, hasLoss: true };
}

const PPTX_GEOMETRY_EPSILON = 0.000_01;

/**
 * NodeSlide exports durable slide/element IDs into OOXML object names. When those IDs return,
 * derive only the portable changes instead of replacing the entire deck. PowerPoint does not
 * preserve NodeSlide-only role, source, group, radius, padding, or exact variable-font metadata,
 * so those fields remain owned by the canonical deck.
 */
function identityPreservingPptxOperations(
  base: DeckSnapshot,
  imported: DeckSnapshot,
): PatchOperation[] | null {
  if (!sameStringSet(base.deck.slideOrder, imported.deck.slideOrder)) return null;
  if (
    !sameStringSet(
      base.elements.map((item) => item.id),
      imported.elements.map((item) => item.id),
    )
  ) {
    return null;
  }
  const importedSlides = new Map(imported.slides.map((slide) => [slide.id, slide]));
  const importedElements = new Map(imported.elements.map((element) => [element.id, element]));
  const operations: PatchOperation[] = [];

  const workingSlideOrder = [...base.deck.slideOrder];
  for (let index = 0; index < imported.deck.slideOrder.length; index += 1) {
    const slideId = imported.deck.slideOrder[index];
    if (!slideId) return null;
    const currentIndex = workingSlideOrder.indexOf(slideId);
    if (currentIndex < 0) return null;
    if (currentIndex !== index) {
      operations.push({ op: 'reorder_slide', slideId, index });
      workingSlideOrder.splice(currentIndex, 1);
      workingSlideOrder.splice(index, 0, slideId);
    }
  }

  for (const baseSlide of base.slides) {
    const remoteSlide = importedSlides.get(baseSlide.id);
    if (!remoteSlide) return null;
    const workingElementOrder = [...baseSlide.elementOrder];
    if (!sameStringSet(workingElementOrder, remoteSlide.elementOrder)) return null;
    for (let index = 0; index < remoteSlide.elementOrder.length; index += 1) {
      const elementId = remoteSlide.elementOrder[index];
      if (!elementId) return null;
      const currentIndex = workingElementOrder.indexOf(elementId);
      if (currentIndex < 0) return null;
      if (currentIndex !== index) {
        operations.push({ op: 'reorder_element_v1', slideId: baseSlide.id, elementId, index });
        workingElementOrder.splice(currentIndex, 1);
        workingElementOrder.splice(index, 0, elementId);
      }
    }
  }

  for (const baseElement of base.elements) {
    const remoteElement = importedElements.get(baseElement.id);
    if (!remoteElement || remoteElement.slideId !== baseElement.slideId) return null;
    if (isEditablePptxFallback(baseElement, remoteElement)) continue;
    if (
      remoteElement.kind !== baseElement.kind &&
      !(baseElement.kind === 'math' && remoteElement.kind === 'text')
    ) {
      return null;
    }
    if ((baseElement.content ?? '') !== (remoteElement.content ?? '')) {
      operations.push({
        op: 'replace_text',
        slideId: baseElement.slideId,
        elementId: baseElement.id,
        text: remoteElement.content ?? '',
      });
    }
    if (
      !nearPptxNumber(baseElement.bbox.x, remoteElement.bbox.x) ||
      !nearPptxNumber(baseElement.bbox.y, remoteElement.bbox.y)
    ) {
      operations.push({
        op: 'move',
        slideId: baseElement.slideId,
        elementId: baseElement.id,
        x: remoteElement.bbox.x,
        y: remoteElement.bbox.y,
      });
    }
    if (
      !nearPptxDimension(baseElement.bbox.width, remoteElement.bbox.width) ||
      !nearPptxDimension(baseElement.bbox.height, remoteElement.bbox.height)
    ) {
      operations.push({
        op: 'resize',
        slideId: baseElement.slideId,
        elementId: baseElement.id,
        width: remoteElement.bbox.width,
        height: remoteElement.bbox.height,
      });
    }
    const style = portablePptxStyleDelta(baseElement.style, remoteElement.style, baseElement.kind);
    if (Object.keys(style).length > 0) {
      operations.push({
        op: 'update_style',
        slideId: baseElement.slideId,
        elementId: baseElement.id,
        properties: style,
      });
    }
    if (baseElement.kind === 'chart' && remoteElement.chart) {
      if (portableChartDigest(baseElement.chart) !== portableChartDigest(remoteElement.chart)) {
        operations.push({
          op: 'update_chart',
          slideId: baseElement.slideId,
          elementId: baseElement.id,
          chart: {
            ...structuredClone(remoteElement.chart),
            ...(baseElement.chart?.unit ? { unit: baseElement.chart.unit } : {}),
            ...(baseElement.chart?.sourceId ? { sourceId: baseElement.chart.sourceId } : {}),
          },
        });
      }
    }
  }
  return operations;
}

function isEditablePptxFallback(local: SlideElement, remote: SlideElement): boolean {
  if (remote.kind !== 'shape' || !['image', 'chart', 'video'].includes(local.kind)) return false;
  const label = remote.content?.toLocaleLowerCase('en-US') ?? '';
  return (
    label.includes('replace image') ||
    label.includes('static image unavailable') ||
    label.includes('chart data unavailable') ||
    label.includes('linked web video')
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function nearPptxNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= PPTX_GEOMETRY_EPSILON;
}

function nearPptxDimension(local: number, remote: number): boolean {
  return nearPptxNumber(local, remote) || (local <= 0.05 && remote <= 0.01 + PPTX_GEOMETRY_EPSILON);
}

function portableChartDigest(chart: ChartData | undefined): string {
  if (!chart) return 'none';
  return JSON.stringify({
    chartType: chart.chartType,
    labels: chart.labels,
    series: chart.series.map((series) => ({ name: series.name, values: series.values })),
  });
}

function portablePptxStyleDelta(
  local: ElementStyle,
  remote: ElementStyle,
  elementKind: SlideElement['kind'],
): Partial<ElementStyle> {
  const delta: Partial<ElementStyle> = {};
  for (const property of [
    'color',
    'fill',
    'stroke',
    'strokeWidth',
    'fontFamily',
    'fontSize',
    'lineHeight',
    'textAlign',
    'verticalAlign',
    'opacity',
  ] as const) {
    if (
      elementKind === 'shape' &&
      ['fontFamily', 'fontSize', 'lineHeight', 'textAlign', 'verticalAlign'].includes(property)
    ) {
      continue;
    }
    if (property === 'fill' && remote.fill === 'transparent' && local.fill !== undefined) continue;
    const left = canonicalPptxStyleValue(property, local[property]);
    const right = canonicalPptxStyleValue(property, remote[property]);
    if (left !== right && remote[property] !== undefined) {
      Object.assign(delta, { [property]: remote[property] });
    }
  }
  const localBold = (local.fontWeight ?? 400) >= 600;
  const remoteBold = (remote.fontWeight ?? 400) >= 600;
  if (localBold !== remoteBold) delta.fontWeight = remoteBold ? 700 : 400;
  return delta;
}

function canonicalPptxStyleValue(
  property: keyof ElementStyle,
  value: ElementStyle[keyof ElementStyle],
): ElementStyle[keyof ElementStyle] {
  if (property === 'fill' && value === 'transparent') return undefined;
  if (property === 'stroke' && value === '#FFFFFF') return undefined;
  if (property === 'strokeWidth' && value === 1) return undefined;
  if (property === 'lineHeight' && value === 1.2) return undefined;
  if (property === 'textAlign' && value === 'left') return undefined;
  if (property === 'verticalAlign' && value === 'top') return undefined;
  if (property === 'fontFamily' && value === 'Aptos') return undefined;
  return value;
}

/**
 * Build a wholesale-import proposal for the existing applyPatch/CAS mutation. This function does
 * not write; its candidate snapshot is materialized with the same shared applyDeckPatch semantics.
 */
export async function createPptxImportCandidate(
  baseSnapshot: DeckSnapshot,
  input: ArrayBuffer | Uint8Array,
  options: Omit<PptxImportOptions, 'deckId' | 'projectId'> = {},
): Promise<PptxImportCandidateResult> {
  const imported = await importPptxSnapshot(input, {
    ...options,
    deckId: baseSnapshot.deck.id,
    projectId: baseSnapshot.deck.projectId,
  });
  if (!imported.ok) return imported;
  try {
    const rekeyed = rekeyImportedSnapshot(imported.snapshot, baseSnapshot);
    const identityOperations = identityPreservingPptxOperations(baseSnapshot, rekeyed);
    const operations: PatchOperation[] = identityOperations ?? [];
    if (identityOperations !== null) {
      const scope = {
        kind: 'deck' as const,
        deckId: baseSnapshot.deck.id,
        operationMode: 'unrestricted' as const,
      };
      if (operations.length > NODESLIDE_PATCH_OPERATION_LIMIT) {
        throw new ImportFailure(
          'candidate_too_large',
          `The import candidate requires ${operations.length} operations; the limit is ${NODESLIDE_PATCH_OPERATION_LIMIT}.`,
        );
      }
      const committedAt = options.timestamp ?? baseSnapshot.deck.updatedAt;
      const snapshot =
        operations.length === 0
          ? structuredClone(baseSnapshot)
          : applyDeckPatch(
              baseSnapshot,
              { baseDeckVersion: baseSnapshot.deck.version, operations, scope },
              committedAt,
            ).snapshot;
      const validation = validateSnapshot(snapshot);
      if (!validation.ok) {
        throw new ImportFailure(
          'candidate_invalid',
          'The identity-preserving PPTX candidate failed canonical validation.',
        );
      }
      return {
        ok: true,
        candidate: {
          deckId: baseSnapshot.deck.id,
          baseDeckVersion: baseSnapshot.deck.version,
          baseSlideVersions: Object.fromEntries(
            baseSnapshot.slides.map((slide) => [slide.id, slide.version]),
          ),
          baseElementVersions: Object.fromEntries(
            baseSnapshot.elements.map((element) => [element.id, element.version]),
          ),
          scope,
          operations,
          summary:
            operations.length === 0
              ? `Link ${options.fileName ?? 'PowerPoint'}: exact NodeSlide export`
              : `Synchronize ${options.fileName ?? 'PowerPoint'}: ${operations.length} bounded change${operations.length === 1 ? '' : 's'}`,
          snapshot,
          validation,
          fidelity: withCandidateFidelity(
            imported.fidelity,
            options.bounds?.maxFidelityItems ?? DEFAULT_PPTX_IMPORT_BOUNDS.maxFidelityItems,
          ),
          source: imported.source,
        },
      };
    }
    if (rekeyed.deck.title !== baseSnapshot.deck.title) {
      operations.push({ op: 'update_deck', properties: { title: rekeyed.deck.title } });
    }
    const orderedSlides = rekeyed.deck.slideOrder.map((slideId) => {
      const slide = rekeyed.slides.find((candidate) => candidate.id === slideId);
      if (!slide)
        throw new ImportFailure('candidate_invalid', `Missing imported slide ${slideId}.`);
      return slide;
    });
    const stagingId = uniqueId(
      `${baseSnapshot.deck.id}:pptx:import-staging`,
      new Set([
        ...baseSnapshot.slides.map((slide) => slide.id),
        ...orderedSlides.map((slide) => slide.id),
      ]),
    );
    operations.push({
      op: 'add_slide',
      slide: {
        id: stagingId,
        deckId: baseSnapshot.deck.id,
        title: 'PPTX import staging',
        background: baseSnapshot.deck.theme.colors.canvas,
        elementOrder: [],
        version: 1,
      },
      elements: [],
      index: baseSnapshot.deck.slideOrder.length,
    });
    for (const slideId of baseSnapshot.deck.slideOrder) {
      operations.push({ op: 'remove_slide', slideId });
    }
    for (let index = 0; index < orderedSlides.length; index += 1) {
      const slide = orderedSlides[index];
      if (!slide) continue;
      operations.push({
        op: 'add_slide',
        slide,
        elements: rekeyed.elements.filter((element) => element.slideId === slide.id),
        index,
      });
    }
    operations.push({ op: 'remove_slide', slideId: stagingId });
    if (operations.length === 0 || operations.length > NODESLIDE_PATCH_OPERATION_LIMIT) {
      throw new ImportFailure(
        'candidate_too_large',
        `The import candidate requires ${operations.length} operations; the limit is ${NODESLIDE_PATCH_OPERATION_LIMIT}.`,
      );
    }
    const scope = {
      kind: 'deck' as const,
      deckId: baseSnapshot.deck.id,
      operationMode: 'unrestricted' as const,
    };
    const committedAt = options.timestamp ?? baseSnapshot.deck.updatedAt;
    const snapshot = applyDeckPatch(
      baseSnapshot,
      { baseDeckVersion: baseSnapshot.deck.version, operations, scope },
      committedAt,
    ).snapshot;
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      throw new ImportFailure(
        'candidate_invalid',
        'The CAS-materialized import candidate failed canonical validation.',
      );
    }
    return {
      ok: true,
      candidate: {
        deckId: baseSnapshot.deck.id,
        baseDeckVersion: baseSnapshot.deck.version,
        baseSlideVersions: Object.fromEntries(
          baseSnapshot.slides.map((slide) => [slide.id, slide.version]),
        ),
        baseElementVersions: Object.fromEntries(
          baseSnapshot.elements.map((element) => [element.id, element.version]),
        ),
        scope,
        operations,
        summary: `Import ${options.fileName ?? 'PowerPoint'}: ${orderedSlides.length} slides and ${rekeyed.elements.length} supported objects`,
        snapshot,
        validation,
        fidelity: withCandidateFidelity(
          imported.fidelity,
          options.bounds?.maxFidelityItems ?? DEFAULT_PPTX_IMPORT_BOUNDS.maxFidelityItems,
        ),
        source: imported.source,
      },
    };
  } catch (error) {
    const collector = new FidelityCollector(
      options.bounds?.maxFidelityItems ?? DEFAULT_PPTX_IMPORT_BOUNDS.maxFidelityItems,
    );
    for (const item of imported.fidelity.items) {
      collector.add(item.feature, item.fidelity, item.reason, {
        ...(item.sourcePart ? { sourcePart: item.sourcePart } : {}),
        ...(item.sourceId ? { sourceId: item.sourceId } : {}),
        ...(item.sourceObjectName ? { sourceObjectName: item.sourceObjectName } : {}),
        ...(item.slideIndex !== undefined ? { slideIndex: item.slideIndex } : {}),
        ...(item.targetId ? { targetId: item.targetId } : {}),
      });
    }
    return failureResult(
      error instanceof Error && !(error instanceof ImportFailure)
        ? new ImportFailure('candidate_invalid', error.message)
        : error,
      collector,
    ) as PptxImportCandidateResult;
  }
}
