import {
  NODESLIDE_SIGNATURE_SCHEMA_VERSION,
  type SignatureColorToken,
  type SignatureDimensionToken,
  type SignatureEvidence,
  type SignatureFontFamilyToken,
} from '../../../../../shared/nodeslideSignature';
import type {
  NodeSlideAuthoredLayoutIntent,
  NodeSlideAuthoredLayoutTargets,
  NodeSlideContrastPair,
  NodeSlideNonAffiliationMetadata,
  NodeSlideRuleCitation,
  NodeSlideSafeAreaInches,
  NodeSlideTastePack,
  NodeSlideTastePackId,
  NodeSlideTastePackRule,
} from './types';

export interface AuthoredColorDefinition {
  key: string;
  hex: `#${string}`;
  description: string;
}

export interface AuthoredFontFamilyDefinition {
  key: string;
  families: readonly [string, ...string[]];
  description: string;
}

export interface AuthoredFontSizeDefinition {
  key: string;
  pixels: number;
  description: string;
}

export interface AuthoredRuleDefinition {
  id: string;
  title: string;
  behavior: string;
  citations: readonly [NodeSlideRuleCitation, ...NodeSlideRuleCitation[]];
}

export interface AuthoredLayoutDefinition {
  widthInches: number;
  heightInches: number;
  density: 'sparse' | 'balanced' | 'dense';
  safeAreaInches?: NodeSlideSafeAreaInches;
  targets: NodeSlideAuthoredLayoutTargets;
  guardrails: readonly string[];
}

export interface AuthoredTastePackDefinition {
  id: NodeSlideTastePackId;
  name: string;
  colors: readonly AuthoredColorDefinition[];
  fontFamilies: readonly AuthoredFontFamilyDefinition[];
  fontSizes: readonly AuthoredFontSizeDefinition[];
  colorPriority: readonly string[];
  fontFamilyPriority: readonly string[];
  fontSizePriority: readonly string[];
  layout: AuthoredLayoutDefinition;
  rules: readonly AuthoredRuleDefinition[];
  nonAffiliation: {
    statement: string;
    organizations: readonly string[];
    prohibitedClaims: readonly string[];
  };
  approvedContrastPairs: readonly NodeSlideContrastPair[];
}

const SHA_256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const SHA_256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function canonicalizeJson(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalizeJson(entry, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareAscii)) {
      const entry = source[key];
      if (entry === undefined) throw new TypeError(`${path}.${key} is undefined.`);
      result[key] = canonicalizeJson(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`${path} is not JSON-serializable.`);
}

export function stableSerializeJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value, '$'));
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** A synchronous UTF-8 SHA-256 used only for deterministic authored-pack identities. */
export function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const bitLength = BigInt(input.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const state: number[] = [...SHA_256_INITIAL_STATE];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((padded[wordOffset] ?? 0) << 24) |
        ((padded[wordOffset + 1] ?? 0) << 16) |
        ((padded[wordOffset + 2] ?? 0) << 8) |
        (padded[wordOffset + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + bigSigma1 + choice + (SHA_256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function authoredEvidenceId(
  packId: NodeSlideTastePackId,
  category: 'color' | 'font-family' | 'font-size' | 'layout',
  key: string,
): string {
  return `authored:${packId}:${category}:${key}`;
}

function authoredExtension(evidenceId: string) {
  return {
    'com.nodeslide.signature': {
      evidenceIds: [evidenceId],
      confidence: 1,
      occurrences: 0,
      sourceRole: 'authored' as const,
    },
  };
}

function evidence(id: string, locator: string, observedValue: unknown): SignatureEvidence {
  return {
    id,
    sourceKind: 'taste_pack',
    method: 'authored',
    sourceDigest: '',
    locator,
    observedValue: stableSerializeJson(observedValue),
    confidence: 1,
  };
}

function colorValue(hex: string) {
  if (!/^#[0-9A-F]{6}$/.test(hex)) {
    throw new TypeError(`Authored color ${hex} must be canonical uppercase six-digit sRGB.`);
  }
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) =>
    Number.parseInt(channel, 16),
  );
  return {
    colorSpace: 'srgb' as const,
    components: [
      roundSix((channels[0] ?? 0) / 255),
      roundSix((channels[1] ?? 0) / 255),
      roundSix((channels[2] ?? 0) / 255),
    ] as [number, number, number],
    hex,
  };
}

function sortedDefinitions<T extends { key: string }>(definitions: readonly T[]): T[] {
  return [...definitions].sort((left, right) => compareAscii(left.key, right.key));
}

function createColorTokens(
  definition: AuthoredTastePackDefinition,
  retainedEvidence: SignatureEvidence[],
): Record<string, SignatureColorToken> {
  const tokens: Record<string, SignatureColorToken> = {};
  for (const color of sortedDefinitions(definition.colors)) {
    const evidenceId = authoredEvidenceId(definition.id, 'color', color.key);
    const value = colorValue(color.hex);
    tokens[color.key] = {
      $type: 'color',
      $value: value,
      $description: color.description,
      $extensions: authoredExtension(evidenceId),
    };
    retainedEvidence.push(evidence(evidenceId, `tokens.colors.${color.key}.$value`, value));
  }
  return tokens;
}

function createFontFamilyTokens(
  definition: AuthoredTastePackDefinition,
  retainedEvidence: SignatureEvidence[],
): Record<string, SignatureFontFamilyToken> {
  const tokens: Record<string, SignatureFontFamilyToken> = {};
  for (const font of sortedDefinitions(definition.fontFamilies)) {
    const evidenceId = authoredEvidenceId(definition.id, 'font-family', font.key);
    const [firstFamily, ...fallbacks] = font.families;
    const value: [string, ...string[]] = [firstFamily, ...fallbacks];
    tokens[font.key] = {
      $type: 'fontFamily',
      $value: value,
      $description: font.description,
      $extensions: authoredExtension(evidenceId),
    };
    retainedEvidence.push(evidence(evidenceId, `tokens.fontFamilies.${font.key}.$value`, value));
  }
  return tokens;
}

function createFontSizeTokens(
  definition: AuthoredTastePackDefinition,
  retainedEvidence: SignatureEvidence[],
): Record<string, SignatureDimensionToken> {
  const tokens: Record<string, SignatureDimensionToken> = {};
  for (const fontSize of sortedDefinitions(definition.fontSizes)) {
    const evidenceId = authoredEvidenceId(definition.id, 'font-size', fontSize.key);
    const value = { value: fontSize.pixels, unit: 'px' as const };
    tokens[fontSize.key] = {
      $type: 'dimension',
      $value: value,
      $description: fontSize.description,
      $extensions: authoredExtension(evidenceId),
    };
    retainedEvidence.push(evidence(evidenceId, `tokens.fontSizes.${fontSize.key}.$value`, value));
  }
  return tokens;
}

function cloneRules(definitions: readonly AuthoredRuleDefinition[]): NodeSlideTastePackRule[] {
  return definitions.map((rule) => {
    const [firstCitation, ...remainingCitations] = rule.citations;
    const citations: [NodeSlideRuleCitation, ...NodeSlideRuleCitation[]] = [
      { ...firstCitation },
      ...remainingCitations.map((citation) => ({ ...citation })),
    ];
    return {
      id: rule.id,
      title: rule.title,
      behavior: rule.behavior,
      citations,
    };
  });
}

function cloneNonAffiliation(
  definition: AuthoredTastePackDefinition['nonAffiliation'],
): NodeSlideNonAffiliationMetadata {
  return {
    independent: true,
    statement: definition.statement,
    organizations: [...definition.organizations],
    prohibitedClaims: [...definition.prohibitedClaims],
  };
}

function identityDocument(pack: NodeSlideTastePack): Record<string, unknown> {
  const document: Record<string, unknown> = { ...pack };
  Reflect.deleteProperty(document, 'id');
  document['source'] = { ...pack.source, digest: '' };
  document['evidence'] = pack.evidence.map((item) => ({ ...item, sourceDigest: '' }));
  return document;
}

export function deriveTastePackIdentity(pack: NodeSlideTastePack): {
  digest: string;
  id: string;
} {
  const hash = sha256Hex(stableSerializeJson(identityDocument(pack)));
  const internalId = pack.$extensions['com.nodeslide.tastePack'].id;
  return {
    digest: `sha256:${hash}`,
    id: `taste-pack:${internalId}:${hash}`,
  };
}

export function hasValidTastePackIdentity(pack: NodeSlideTastePack): boolean {
  const expected = deriveTastePackIdentity(pack);
  return (
    pack.id === expected.id &&
    pack.source.digest === expected.digest &&
    pack.evidence.every((item) => item.sourceDigest === expected.digest)
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function stableSerializeTastePack(pack: NodeSlideTastePack): string {
  return stableSerializeJson(pack);
}

export function createAuthoredTastePack(
  definition: AuthoredTastePackDefinition,
): NodeSlideTastePack {
  const retainedEvidence: SignatureEvidence[] = [];
  const colors = createColorTokens(definition, retainedEvidence);
  const fontFamilies = createFontFamilyTokens(definition, retainedEvidence);
  const fontSizes = createFontSizeTokens(definition, retainedEvidence);
  const layoutEvidenceId = authoredEvidenceId(definition.id, 'layout', 'intent');
  const layoutIntent: NodeSlideAuthoredLayoutIntent = {
    sourceRole: 'authored',
    evidenceIds: [layoutEvidenceId],
    observedDeckFacts: false,
    intendedDensity: definition.layout.density,
    ...(definition.layout.safeAreaInches
      ? { safeAreaInches: { ...definition.layout.safeAreaInches } }
      : {}),
    targets: { ...definition.layout.targets },
    guardrails: [...definition.layout.guardrails],
    neutralProfileFields: [
      'slideCount',
      'masterCount',
      'layoutCount',
      'layoutUsage',
      'averageShapesPerSlide',
      'maximumShapesPerSlide',
      'averageTextRunsPerSlide',
      'medianFontSizePoints',
      'embeddedFontsPresent',
      'embeddedFontFamilies',
    ],
  };
  const aspectRatio = roundSix(definition.layout.widthInches / definition.layout.heightInches);
  retainedEvidence.push(
    evidence(layoutEvidenceId, '$extensions.com.nodeslide.tastePack.layout', {
      aspectRatio,
      density: definition.layout.density,
      guardrails: layoutIntent.guardrails,
      heightInches: definition.layout.heightInches,
      safeAreaInches: layoutIntent.safeAreaInches ?? null,
      targets: layoutIntent.targets,
      widthInches: definition.layout.widthInches,
    }),
  );
  retainedEvidence.sort((left, right) => compareAscii(left.id, right.id));

  const draft: NodeSlideTastePack = {
    schemaVersion: NODESLIDE_SIGNATURE_SCHEMA_VERSION,
    id: '',
    name: definition.name,
    source: {
      kind: 'taste_pack',
      digest: '',
      fileName: `${definition.id}.json`,
    },
    tokens: { colors, fontFamilies, fontSizes },
    usage: { colors: [], fonts: [], fontSizes: [] },
    layout: {
      slideWidthInches: definition.layout.widthInches,
      slideHeightInches: definition.layout.heightInches,
      aspectRatio,
      slideCount: 0,
      masterCount: 0,
      layoutCount: 0,
      layoutUsage: [],
      averageShapesPerSlide: 0,
      maximumShapesPerSlide: 0,
      averageTextRunsPerSlide: 0,
      density: definition.layout.density,
      embeddedFontsPresent: false,
      embeddedFontFamilies: [],
    },
    evidence: retainedEvidence,
    confidence: 'high',
    warnings: [],
    $extensions: {
      'com.nodeslide.rules': {
        rules: cloneRules(definition.rules),
        nonAffiliation: cloneNonAffiliation(definition.nonAffiliation),
      },
      'com.nodeslide.tastePack': {
        id: definition.id,
        authorship: {
          method: 'authored',
          confidence: 1,
          sourceDerived: false,
          confidenceMeaning:
            'Confidence 1 means the literal value exactly matches the NodeSlide-authored default; it does not attribute the value to a cited source or assert design quality.',
        },
        fontPolicy: {
          networkFetch: false,
          embedsFonts: false,
          requiresGenericFallback: true,
        },
        authoredTokenPriority: {
          colors: [...definition.colorPriority],
          fontFamilies: [...definition.fontFamilyPriority],
          fontSizes: [...definition.fontSizePriority],
        },
        layout: layoutIntent,
        approvedContrastPairs: definition.approvedContrastPairs.map((pair) => ({ ...pair })),
      },
    },
  };

  const identity = deriveTastePackIdentity(draft);
  const pack: NodeSlideTastePack = {
    ...draft,
    id: identity.id,
    source: { ...draft.source, digest: identity.digest },
    evidence: draft.evidence.map((item) => ({ ...item, sourceDigest: identity.digest })),
  };
  return deepFreeze(pack);
}
