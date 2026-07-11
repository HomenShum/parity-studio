import type {
  SignatureSourceRole,
  SignatureWarningCode,
} from '../../../../shared/nodeslideSignature';
import {
  getXmlAttribute,
  getXmlAttributeByNamespace,
  resolveRelationshipTarget,
  scanXmlTags,
} from './xml';

export interface CanonicalColor {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha?: number;
  hex: string;
}

export interface ThemeDefinition {
  name: string;
  colors: Map<string, CanonicalColor>;
  majorFont?: string;
  minorFont?: string;
}

export interface EmbeddedFontDeclaration {
  family?: string;
  relationshipIds: string[];
}

export interface PresentationMetadata {
  slideWidthEmu: number;
  slideHeightEmu: number;
  slideRelationshipIds: string[];
  embeddedFonts: EmbeddedFontDeclaration[];
  malformed: boolean;
  validRoot: boolean;
}

export interface PackageRelationship {
  id: string;
  type: string;
  target?: string;
  unsafe: boolean;
}

export interface RelationshipSet {
  byId: Map<string, PackageRelationship>;
  malformed: boolean;
  validRoot: boolean;
}

export interface CountedColor {
  color: CanonicalColor;
  occurrences: number;
}

export interface CountedString {
  value: string;
  occurrences: number;
}

export interface CountedNumber {
  value: number;
  occurrences: number;
}

export interface StylePartObservations {
  colors: Map<string, CountedColor>;
  fonts: Map<string, CountedString>;
  fontSizes: Map<string, CountedNumber>;
  shapeCount: number;
  textRunCount: number;
  malformed: boolean;
  validRoot: boolean;
}

export type ParserWarning = (
  code: Extract<SignatureWarningCode, 'unresolved_alias' | 'unresolved_color'>,
  locator: string,
) => void;

const PRESENTATION_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
]);

const DRAWING_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);

const OFFICE_RELATIONSHIP_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

const PACKAGE_RELATIONSHIP_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://purl.oclc.org/ooxml/package/relationships',
]);

const THEME_COLOR_ROLES = new Set([
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]);

const COLOR_CHOICE_NAMES = new Set([
  'srgbClr',
  'sysClr',
  'scrgbClr',
  'hslClr',
  'prstClr',
  'schemeClr',
]);

const COLOR_MAP_NAMES = [
  'bg1',
  'tx1',
  'bg2',
  'tx2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const;

const PRESET_COLORS: Readonly<Record<string, string>> = {
  aliceBlue: 'F0F8FF',
  aqua: '00FFFF',
  black: '000000',
  blue: '0000FF',
  blueViolet: '8A2BE2',
  brown: 'A52A2A',
  coral: 'FF7F50',
  crimson: 'DC143C',
  cyan: '00FFFF',
  dkBlue: '00008B',
  dkGray: 'A9A9A9',
  dkGreen: '006400',
  dkRed: '8B0000',
  gold: 'FFD700',
  gray: '808080',
  green: '008000',
  grey: '808080',
  ltBlue: 'ADD8E6',
  ltGray: 'D3D3D3',
  ltGreen: '90EE90',
  magenta: 'FF00FF',
  navy: '000080',
  orange: 'FFA500',
  pink: 'FFC0CB',
  purple: '800080',
  red: 'FF0000',
  silver: 'C0C0C0',
  teal: '008080',
  violet: 'EE82EE',
  white: 'FFFFFF',
  yellow: 'FFFF00',
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function hexByte(value: number): string {
  return Math.round(clamp(value) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function colorFromComponents(
  red: number,
  green: number,
  blue: number,
  alpha?: number,
): CanonicalColor {
  const components: [number, number, number] = [red, green, blue].map((component) =>
    round(Math.round(clamp(component) * 255) / 255),
  ) as [number, number, number];
  const normalizedAlpha = alpha === undefined ? undefined : round(clamp(alpha));
  const opaque = normalizedAlpha === undefined || normalizedAlpha >= 1;
  // DTCG carries opacity separately. Keep the convenience hex strictly six-digit so
  // downstream palette matching never mistakes an alpha suffix for another RGB color.
  const hex = `#${components.map(hexByte).join('')}`;
  return {
    colorSpace: 'srgb',
    components,
    ...(!opaque ? { alpha: normalizedAlpha } : {}),
    hex,
  };
}

export function canonicalColorKey(color: CanonicalColor): string {
  return color.alpha === undefined ? color.hex : `${color.hex}@${round(color.alpha)}`;
}

function colorFromHex(value: string | undefined): CanonicalColor | undefined {
  const normalized = value?.trim().replace(/^#/, '');
  if (!normalized || !/^[0-9a-f]{6}$/i.test(normalized)) return undefined;
  return colorFromComponents(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  );
}

function percentage(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100_000 : undefined;
}

function positiveSafeInteger(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hueToRgb(p: number, q: number, input: number): number {
  let hue = input;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, luminance: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp(saturation);
  const l = clamp(luminance);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function rgbToHsl([red, green, blue]: readonly [number, number, number]): [number, number, number] {
  const maximum = Math.max(red ?? 0, green ?? 0, blue ?? 0);
  const minimum = Math.min(red ?? 0, green ?? 0, blue ?? 0);
  const luminance = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, luminance];
  const delta = maximum - minimum;
  const saturation =
    luminance > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  let hue = 0;
  if (maximum === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue / 6, saturation, luminance];
}

function directColor(
  localName: string,
  attributes: Readonly<Record<string, string>>,
): CanonicalColor | undefined {
  if (localName === 'srgbClr') return colorFromHex(getXmlAttribute(attributes, 'val'));
  if (localName === 'sysClr') {
    return colorFromHex(
      getXmlAttribute(attributes, 'lastClr') ?? getXmlAttribute(attributes, 'val'),
    );
  }
  if (localName === 'scrgbClr') {
    const red = percentage(getXmlAttribute(attributes, 'r'));
    const green = percentage(getXmlAttribute(attributes, 'g'));
    const blue = percentage(getXmlAttribute(attributes, 'b'));
    return red === undefined || green === undefined || blue === undefined
      ? undefined
      : colorFromComponents(red, green, blue);
  }
  if (localName === 'hslClr') {
    const hueRaw = getXmlAttribute(attributes, 'hue');
    const saturation = percentage(getXmlAttribute(attributes, 'sat'));
    const luminance = percentage(getXmlAttribute(attributes, 'lum'));
    if (!hueRaw || saturation === undefined || luminance === undefined) return undefined;
    const hue = Number(hueRaw) / 60_000 / 360;
    if (!Number.isFinite(hue)) return undefined;
    return colorFromComponents(...hslToRgb(hue, saturation, luminance));
  }
  if (localName === 'prstClr') {
    const preset = getXmlAttribute(attributes, 'val');
    return preset ? colorFromHex(PRESET_COLORS[preset]) : undefined;
  }
  return undefined;
}

function normalizeFontFamily(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

export function parsePresentationMetadata(
  xml: string,
  checkDeadline: () => void,
): PresentationMetadata {
  const slideRelationshipIds: string[] = [];
  const embeddedFonts: EmbeddedFontDeclaration[] = [];
  let slideWidthEmu = 0;
  let slideHeightEmu = 0;
  let geometrySeen = false;
  let geometryMalformed = false;
  let embedded: { depth: number; family?: string; relationshipIds: Set<string> } | undefined;

  const scan = scanXmlTags(
    xml,
    (tag) => {
      if (!PRESENTATION_NAMESPACES.has(tag.namespaceUri ?? '')) return;
      if (tag.closing) {
        if (embedded && tag.localName === 'embeddedFont' && tag.depth === embedded.depth) {
          embeddedFonts.push({
            ...(embedded.family ? { family: embedded.family } : {}),
            relationshipIds: [...embedded.relationshipIds].sort(),
          });
          embedded = undefined;
        }
        return;
      }
      if (tag.localName === 'sldSz') {
        if (geometrySeen) geometryMalformed = true;
        geometrySeen = true;
        const width = positiveSafeInteger(getXmlAttribute(tag.attributes, 'cx'));
        const height = positiveSafeInteger(getXmlAttribute(tag.attributes, 'cy'));
        if (width === undefined || height === undefined) {
          geometryMalformed = true;
          slideWidthEmu = Number.NaN;
          slideHeightEmu = Number.NaN;
        } else {
          slideWidthEmu = width;
          slideHeightEmu = height;
        }
      } else if (tag.localName === 'sldId') {
        const relationshipId = getXmlAttributeByNamespace(
          tag,
          OFFICE_RELATIONSHIP_NAMESPACES,
          'id',
        );
        if (relationshipId) slideRelationshipIds.push(relationshipId);
      } else if (tag.localName === 'embeddedFont') {
        embedded = { depth: tag.depth, relationshipIds: new Set() };
        if (tag.selfClosing) {
          embeddedFonts.push({ relationshipIds: [] });
          embedded = undefined;
        }
      } else if (embedded && tag.localName === 'font') {
        const family = normalizeFontFamily(getXmlAttribute(tag.attributes, 'typeface'));
        if (family) embedded.family = family;
      } else if (embedded && ['regular', 'bold', 'italic', 'boldItalic'].includes(tag.localName)) {
        const relationshipId = getXmlAttributeByNamespace(
          tag,
          OFFICE_RELATIONSHIP_NAMESPACES,
          'id',
        );
        if (relationshipId) embedded.relationshipIds.add(relationshipId);
      }
    },
    checkDeadline,
  );

  return {
    slideWidthEmu,
    slideHeightEmu,
    slideRelationshipIds,
    embeddedFonts,
    malformed: scan.malformed || geometryMalformed,
    validRoot:
      scan.rootLocalName === 'presentation' &&
      PRESENTATION_NAMESPACES.has(scan.rootNamespaceUri ?? ''),
  };
}

export function parseRelationships(
  xml: string,
  sourcePartName: string,
  checkDeadline: () => void,
): RelationshipSet {
  const byId = new Map<string, PackageRelationship>();
  let duplicateId = false;
  let invalidElementNamespace = false;
  const scan = scanXmlTags(
    xml,
    (tag) => {
      if (tag.closing || tag.localName !== 'Relationship') return;
      if (!PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.namespaceUri ?? '')) {
        invalidElementNamespace = true;
        return;
      }
      const id = getXmlAttribute(tag.attributes, 'Id', 'id');
      const typeUri = getXmlAttribute(tag.attributes, 'Type', 'type');
      const rawTarget = getXmlAttribute(tag.attributes, 'Target', 'target');
      if (!id || !typeUri || !rawTarget) return;
      if (byId.has(id)) duplicateId = true;
      const external = getXmlAttribute(tag.attributes, 'TargetMode', 'targetMode') === 'External';
      const target = external ? undefined : resolveRelationshipTarget(sourcePartName, rawTarget);
      const separator = typeUri.lastIndexOf('/');
      const typeBase = separator >= 0 ? typeUri.slice(0, separator) : '';
      const validType = OFFICE_RELATIONSHIP_NAMESPACES.has(typeBase);
      byId.set(id, {
        id,
        type: separator >= 0 ? typeUri.slice(separator + 1) : typeUri,
        ...(target ? { target } : {}),
        unsafe: external || !target || !validType,
      });
    },
    checkDeadline,
  );
  return {
    byId,
    malformed: scan.malformed || duplicateId || invalidElementNamespace,
    validRoot:
      scan.rootLocalName === 'Relationships' &&
      PACKAGE_RELATIONSHIP_NAMESPACES.has(scan.rootNamespaceUri ?? ''),
  };
}

export function parseTheme(
  xml: string,
  checkDeadline: () => void,
): {
  theme: ThemeDefinition;
  malformed: boolean;
  validRoot: boolean;
  unresolvedColors: boolean;
} {
  const colors = new Map<string, CanonicalColor>();
  let themeName = '';
  let colorSchemeDepth: number | undefined;
  let colorRole: { value: string; depth: number } | undefined;
  let pendingColor:
    | {
        role: string;
        depth: number;
        localName: string;
        base?: CanonicalColor;
        transforms: ColorTransform[];
        valid: boolean;
      }
    | undefined;
  let fontContext: { kind: 'major' | 'minor'; depth: number } | undefined;
  let majorFont: string | undefined;
  let minorFont: string | undefined;
  let unresolvedColors = false;

  const scan = scanXmlTags(
    xml,
    (tag) => {
      if (!DRAWING_NAMESPACES.has(tag.namespaceUri ?? '')) return;
      if (tag.closing) {
        if (
          pendingColor &&
          tag.depth === pendingColor.depth &&
          tag.localName === pendingColor.localName
        ) {
          if (pendingColor.base && pendingColor.valid) {
            colors.set(
              pendingColor.role,
              applyColorTransforms(pendingColor.base, pendingColor.transforms),
            );
          }
          pendingColor = undefined;
        }
        if (colorRole && tag.depth === colorRole.depth) colorRole = undefined;
        if (colorSchemeDepth === tag.depth && tag.localName === 'clrScheme') {
          colorSchemeDepth = undefined;
        }
        if (fontContext && tag.depth === fontContext.depth) fontContext = undefined;
        return;
      }
      if (tag.localName === 'theme') {
        themeName = getXmlAttribute(tag.attributes, 'name')?.trim() ?? '';
      } else if (tag.localName === 'clrScheme') {
        colorSchemeDepth = tag.depth;
      } else if (
        colorSchemeDepth !== undefined &&
        tag.depth === colorSchemeDepth + 1 &&
        THEME_COLOR_ROLES.has(tag.localName)
      ) {
        colorRole = { value: tag.localName, depth: tag.depth };
      } else if (
        colorRole &&
        tag.depth === colorRole.depth + 1 &&
        COLOR_CHOICE_NAMES.has(tag.localName)
      ) {
        const color = directColor(tag.localName, tag.attributes);
        if (!color) unresolvedColors = true;
        if (tag.selfClosing) {
          if (color) colors.set(colorRole.value, color);
        } else {
          pendingColor = {
            role: colorRole.value,
            depth: tag.depth,
            localName: tag.localName,
            ...(color ? { base: color } : {}),
            transforms: [],
            valid: Boolean(color),
          };
        }
      } else if (pendingColor && tag.depth > pendingColor.depth) {
        const transform = parseColorTransform(tag.localName, tag.attributes);
        if (transform === null) {
          pendingColor.valid = false;
          unresolvedColors = true;
        } else if (transform) {
          pendingColor.transforms.push(transform);
        }
      } else if (tag.localName === 'majorFont' || tag.localName === 'minorFont') {
        fontContext = {
          kind: tag.localName === 'majorFont' ? 'major' : 'minor',
          depth: tag.depth,
        };
      } else if (fontContext && tag.localName === 'latin') {
        const family = normalizeFontFamily(getXmlAttribute(tag.attributes, 'typeface'));
        if (family && fontContext.kind === 'major') majorFont = family;
        if (family && fontContext.kind === 'minor') minorFont = family;
      }
    },
    checkDeadline,
  );

  return {
    theme: {
      name: themeName || 'OOXML theme',
      colors,
      ...(majorFont ? { majorFont } : {}),
      ...(minorFont ? { minorFont } : {}),
    },
    malformed: scan.malformed,
    validRoot:
      scan.rootLocalName === 'theme' && DRAWING_NAMESPACES.has(scan.rootNamespaceUri ?? ''),
    unresolvedColors,
  };
}

export function parseColorMap(
  xml: string,
  base: Readonly<Record<string, string>>,
  checkDeadline: () => void,
): { colorMap: Record<string, string>; malformed: boolean } {
  const colorMap = { ...base };
  const scan = scanXmlTags(
    xml,
    (tag) => {
      if (tag.closing || !['clrMap', 'overrideClrMapping'].includes(tag.localName)) return;
      if (
        (tag.localName === 'clrMap' && !PRESENTATION_NAMESPACES.has(tag.namespaceUri ?? '')) ||
        (tag.localName === 'overrideClrMapping' && !DRAWING_NAMESPACES.has(tag.namespaceUri ?? ''))
      ) {
        return;
      }
      for (const name of COLOR_MAP_NAMES) {
        const value = getXmlAttribute(tag.attributes, name);
        if (value) colorMap[name] = value;
      }
    },
    checkDeadline,
  );
  return { colorMap, malformed: scan.malformed };
}

interface ColorTransform {
  kind: string;
  value: number;
}

const SUPPORTED_COLOR_TRANSFORM_NAMES = new Set([
  'tint',
  'shade',
  'lum',
  'lumMod',
  'lumOff',
  'sat',
  'satMod',
  'satOff',
  'red',
  'redMod',
  'redOff',
  'green',
  'greenMod',
  'greenOff',
  'blue',
  'blueMod',
  'blueOff',
  'alpha',
  'alphaMod',
  'alphaOff',
]);

const COLOR_TRANSFORM_NAMES = new Set([
  ...SUPPORTED_COLOR_TRANSFORM_NAMES,
  'comp',
  'inv',
  'gray',
  'hue',
  'hueOff',
  'hueMod',
  'gamma',
  'invGamma',
]);

function parseColorTransform(
  localName: string,
  attributes: Readonly<Record<string, string>>,
): ColorTransform | null | undefined {
  if (!COLOR_TRANSFORM_NAMES.has(localName)) return undefined;
  if (!SUPPORTED_COLOR_TRANSFORM_NAMES.has(localName)) return null;
  const value = percentage(getXmlAttribute(attributes, 'val'));
  return value === undefined ? null : { kind: localName, value };
}

function applyHslTransform(
  components: [number, number, number],
  channel: 'saturation' | 'luminance',
  operation: 'set' | 'multiply' | 'offset',
  value: number,
): [number, number, number] {
  const hsl = rgbToHsl(components);
  const index = channel === 'saturation' ? 1 : 2;
  if (operation === 'set') hsl[index] = value;
  else if (operation === 'multiply') hsl[index] *= value;
  else hsl[index] += value;
  hsl[index] = clamp(hsl[index]);
  return hslToRgb(hsl[0], hsl[1], hsl[2]);
}

function applyColorTransforms(
  base: CanonicalColor,
  transforms: readonly ColorTransform[],
): CanonicalColor {
  let components: [number, number, number] = [...base.components];
  let alpha = base.alpha ?? 1;
  for (const transform of transforms) {
    const value = transform.value;
    switch (transform.kind) {
      case 'tint':
        components = components.map((component) => component + (1 - component) * value) as [
          number,
          number,
          number,
        ];
        break;
      case 'shade':
        components = components.map((component) => component * value) as [number, number, number];
        break;
      case 'lum':
        components = applyHslTransform(components, 'luminance', 'set', value);
        break;
      case 'lumMod':
        components = applyHslTransform(components, 'luminance', 'multiply', value);
        break;
      case 'lumOff':
        components = applyHslTransform(components, 'luminance', 'offset', value);
        break;
      case 'sat':
        components = applyHslTransform(components, 'saturation', 'set', value);
        break;
      case 'satMod':
        components = applyHslTransform(components, 'saturation', 'multiply', value);
        break;
      case 'satOff':
        components = applyHslTransform(components, 'saturation', 'offset', value);
        break;
      case 'red':
        components[0] = value;
        break;
      case 'redMod':
        components[0] *= value;
        break;
      case 'redOff':
        components[0] += value;
        break;
      case 'green':
        components[1] = value;
        break;
      case 'greenMod':
        components[1] *= value;
        break;
      case 'greenOff':
        components[1] += value;
        break;
      case 'blue':
        components[2] = value;
        break;
      case 'blueMod':
        components[2] *= value;
        break;
      case 'blueOff':
        components[2] += value;
        break;
      case 'alpha':
        alpha = value;
        break;
      case 'alphaMod':
        alpha *= value;
        break;
      case 'alphaOff':
        alpha += value;
        break;
      default:
        throw new TypeError('Unsupported OOXML color transform reached evaluation.');
    }
    components = components.map((component) => clamp(component)) as [number, number, number];
    alpha = clamp(alpha);
  }
  return colorFromComponents(...components, alpha);
}

function addColor(colors: Map<string, CountedColor>, color: CanonicalColor): void {
  const key = canonicalColorKey(color);
  const existing = colors.get(key);
  if (existing) existing.occurrences += 1;
  else colors.set(key, { color, occurrences: 1 });
}

function addString(values: Map<string, CountedString>, value: string): void {
  const normalized = value.toLocaleLowerCase('en-US');
  const existing = values.get(normalized);
  if (existing) existing.occurrences += 1;
  else values.set(normalized, { value, occurrences: 1 });
}

function addNumber(values: Map<string, CountedNumber>, value: number): void {
  const normalized = String(round(value));
  const existing = values.get(normalized);
  if (existing) existing.occurrences += 1;
  else values.set(normalized, { value: round(value), occurrences: 1 });
}

function resolveFontAlias(value: string, theme: ThemeDefinition | undefined): string | undefined {
  if (value === '+mj-lt') return theme?.majorFont;
  if (value === '+mn-lt') return theme?.minorFont;
  return value.startsWith('+') ? undefined : normalizeFontFamily(value);
}

function resolveStyleColor(
  localName: string,
  attributes: Readonly<Record<string, string>>,
  theme: ThemeDefinition | undefined,
  colorMap: Readonly<Record<string, string>>,
): CanonicalColor | undefined {
  if (localName !== 'schemeClr') return directColor(localName, attributes);
  const alias = getXmlAttribute(attributes, 'val');
  if (!alias) return undefined;
  const themeRole = colorMap[alias] ?? alias;
  return theme?.colors.get(themeRole);
}

export function parseStylePart(
  xml: string,
  options: {
    locator: string;
    role: Exclude<SignatureSourceRole, 'theme' | 'inferred' | 'authored'>;
    theme: ThemeDefinition | undefined;
    colorMap: Readonly<Record<string, string>>;
    countGeometry: boolean;
    warning: ParserWarning;
    checkDeadline: () => void;
  },
): StylePartObservations {
  const colors = new Map<string, CountedColor>();
  const fonts = new Map<string, CountedString>();
  const fontSizes = new Map<string, CountedNumber>();
  let shapeCount = 0;
  let textRunCount = 0;
  let pendingColor:
    | {
        depth: number;
        localName: string;
        base?: CanonicalColor;
        transforms: ColorTransform[];
        valid: boolean;
      }
    | undefined;

  const scan = scanXmlTags(
    xml,
    (tag) => {
      const drawingElement = DRAWING_NAMESPACES.has(tag.namespaceUri ?? '');
      const presentationElement = PRESENTATION_NAMESPACES.has(tag.namespaceUri ?? '');
      if (tag.closing) {
        if (
          drawingElement &&
          pendingColor &&
          tag.depth === pendingColor.depth &&
          tag.localName === pendingColor.localName
        ) {
          if (pendingColor.base && pendingColor.valid) {
            addColor(colors, applyColorTransforms(pendingColor.base, pendingColor.transforms));
          }
          pendingColor = undefined;
        }
        return;
      }

      if (drawingElement && !pendingColor && COLOR_CHOICE_NAMES.has(tag.localName)) {
        const base = resolveStyleColor(
          tag.localName,
          tag.attributes,
          options.theme,
          options.colorMap,
        );
        if (!base) {
          options.warning(
            tag.localName === 'schemeClr' ? 'unresolved_alias' : 'unresolved_color',
            options.locator,
          );
        }
        if (tag.selfClosing) {
          if (base) addColor(colors, base);
        } else {
          pendingColor = {
            depth: tag.depth,
            localName: tag.localName,
            ...(base ? { base } : {}),
            transforms: [],
            valid: Boolean(base),
          };
        }
      } else if (drawingElement && pendingColor && tag.depth > pendingColor.depth) {
        const transform = parseColorTransform(tag.localName, tag.attributes);
        if (transform === null) {
          pendingColor.valid = false;
          options.warning('unresolved_color', options.locator);
        } else if (transform) {
          pendingColor.transforms.push(transform);
        }
      }

      if (drawingElement && tag.localName === 'latin') {
        const rawFamily = normalizeFontFamily(getXmlAttribute(tag.attributes, 'typeface'));
        if (rawFamily) {
          const family = resolveFontAlias(rawFamily, options.theme);
          if (family) addString(fonts, family);
          else options.warning('unresolved_alias', options.locator);
        }
      }
      if (drawingElement && (tag.localName === 'rPr' || tag.localName === 'defRPr')) {
        const rawSize = getXmlAttribute(tag.attributes, 'sz');
        const hundredths = positiveSafeInteger(rawSize);
        if (hundredths !== undefined) addNumber(fontSizes, hundredths / 100);
      }
      if (options.countGeometry) {
        if (
          presentationElement &&
          ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(tag.localName)
        ) {
          shapeCount += 1;
        }
        if (drawingElement && (tag.localName === 'r' || tag.localName === 'fld')) {
          textRunCount += 1;
        }
      }
    },
    options.checkDeadline,
  );

  return {
    colors,
    fonts,
    fontSizes,
    shapeCount,
    textRunCount,
    malformed: scan.malformed,
    validRoot:
      PRESENTATION_NAMESPACES.has(scan.rootNamespaceUri ?? '') &&
      scan.rootLocalName ===
        (options.role === 'slide' ? 'sld' : options.role === 'master' ? 'sldMaster' : 'sldLayout'),
  };
}
