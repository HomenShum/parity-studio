import { NODESLIDE_SIGNATURE_SCHEMA_VERSION } from '../../../../../shared/nodeslideSignature';
import { hasValidTastePackIdentity, stableSerializeJson } from './encoding';
import type {
  NodeSlideAuthoredLayoutIntent,
  NodeSlideTastePack,
  NodeSlideTastePackId,
  NodeSlideTastePackValidationResult,
} from './types';

const TOKEN_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVIDENCE_ID_PATTERN = /^authored:[a-z][a-z0-9-]*:[a-z-]+:[a-z0-9-]+$/;
const GENERIC_FONT_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui']);

const EXPECTED_PACKS: Record<NodeSlideTastePackId, { name: string; ruleIds: readonly string[] }> = {
  'finance-ibcs': {
    name: 'Finance reporting',
    ruleIds: [
      'finance.message-first',
      'finance.semantic-consistency',
      'finance.no-decoration',
      'finance.dense-but-legible',
      'finance.direct-labels',
      'finance.integrity-axes-scales',
      'finance.time-horizontal',
      'finance.structure-vertical',
      'finance.highlight-with-purpose',
      'finance.chart-by-question',
    ],
  },
  'startup-narrative': {
    name: 'Startup narrative',
    ruleIds: [
      'startup.audience-centered-arc',
      'startup.single-takeaway',
      'startup.current-future-contrast',
      'startup.purposeful-simplicity',
      'startup.whitespace-for-focus',
      'startup.decisive-next-action',
    ],
  },
};

interface EvidenceExpectation {
  locator: string;
  observedValue: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameOrderedValues(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function sameValueSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (new Set(actual).size !== actual.length || actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((value) => expectedSet.has(value));
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(hex);
  if (!match) return null;
  const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

export function contrastRatioForHex(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateAuthoredExtension(
  extensionContainer: unknown,
  path: string,
  expectedEvidence: Map<string, EvidenceExpectation>,
  expectation: EvidenceExpectation,
  errors: string[],
): void {
  if (!isRecord(extensionContainer)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const extension = extensionContainer['com.nodeslide.signature'];
  if (!isRecord(extension)) {
    errors.push(`${path}.com.nodeslide.signature is required.`);
    return;
  }
  const evidenceIds = extension['evidenceIds'];
  if (
    !Array.isArray(evidenceIds) ||
    evidenceIds.length !== 1 ||
    !isNonEmptyString(evidenceIds[0])
  ) {
    errors.push(`${path}.com.nodeslide.signature.evidenceIds must contain one authored ID.`);
    return;
  }
  if (extension['confidence'] !== 1) errors.push(`${path} authored confidence must equal 1.`);
  if (extension['occurrences'] !== 0) errors.push(`${path} authored occurrences must equal 0.`);
  if (extension['sourceRole'] !== 'authored') errors.push(`${path} sourceRole must be authored.`);
  if (Object.hasOwn(extension, 'originalPoints')) {
    errors.push(`${path} must not claim extracted OOXML point evidence.`);
  }
  if (/https?:\/\//i.test(stableSerializeJson(extension))) {
    errors.push(`${path} token provenance must not contain citation URLs.`);
  }
  expectedEvidence.set(evidenceIds[0], expectation);
}

function validateColorTokens(
  value: unknown,
  expectedEvidence: Map<string, EvidenceExpectation>,
  errors: string[],
): Record<string, string> {
  const colors: Record<string, string> = {};
  if (!isRecord(value)) {
    errors.push('tokens.colors must be an object.');
    return colors;
  }
  const keys = Object.keys(value);
  if (!sameOrderedValues(keys, [...keys].sort(compareAscii))) {
    errors.push('tokens.colors keys must be ASCII-sorted.');
  }
  for (const key of keys) {
    const path = `tokens.colors.${key}`;
    if (!TOKEN_KEY_PATTERN.test(key)) errors.push(`${path} has an unsafe token key.`);
    const token = value[key];
    if (!isRecord(token)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (token['$type'] !== 'color') errors.push(`${path}.$type must be color.`);
    if (!isNonEmptyString(token['$description'])) errors.push(`${path} needs a description.`);
    const color = token['$value'];
    if (!isRecord(color)) {
      errors.push(`${path}.$value must be an object.`);
      continue;
    }
    if (color['colorSpace'] !== 'srgb') errors.push(`${path} must use sRGB.`);
    const components = color['components'];
    if (
      !Array.isArray(components) ||
      components.length !== 3 ||
      components.some(
        (component) =>
          typeof component !== 'number' ||
          !Number.isFinite(component) ||
          component < 0 ||
          component > 1,
      )
    ) {
      errors.push(`${path}.components must be three finite normalized sRGB values.`);
    }
    const hex = color['hex'];
    if (typeof hex !== 'string' || !/^#[0-9A-F]{6}$/.test(hex)) {
      errors.push(`${path}.hex must be canonical uppercase six-digit sRGB.`);
    } else {
      colors[key] = hex;
      if (Array.isArray(components) && components.length === 3) {
        const expectedComponents = [
          Number.parseInt(hex.slice(1, 3), 16),
          Number.parseInt(hex.slice(3, 5), 16),
          Number.parseInt(hex.slice(5, 7), 16),
        ].map((channel) => roundSix(channel / 255));
        if (
          components.some(
            (component, index) => component !== (expectedComponents[index] ?? Number.NaN),
          )
        ) {
          errors.push(`${path}.components do not match its canonical hex value.`);
        }
      }
    }
    validateAuthoredExtension(
      token['$extensions'],
      `${path}.$extensions`,
      expectedEvidence,
      {
        locator: `${path}.$value`,
        observedValue: stableSerializeJson(color),
      },
      errors,
    );
  }
  return colors;
}

function validateFontFamilyTokens(
  value: unknown,
  expectedEvidence: Map<string, EvidenceExpectation>,
  errors: string[],
): string[] {
  if (!isRecord(value)) {
    errors.push('tokens.fontFamilies must be an object.');
    return [];
  }
  const keys = Object.keys(value);
  if (!sameOrderedValues(keys, [...keys].sort(compareAscii))) {
    errors.push('tokens.fontFamilies keys must be ASCII-sorted.');
  }
  for (const key of keys) {
    const path = `tokens.fontFamilies.${key}`;
    if (!TOKEN_KEY_PATTERN.test(key)) errors.push(`${path} has an unsafe token key.`);
    const token = value[key];
    if (!isRecord(token)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (token['$type'] !== 'fontFamily') errors.push(`${path}.$type must be fontFamily.`);
    if (!isNonEmptyString(token['$description'])) errors.push(`${path} needs a description.`);
    const families = token['$value'];
    if (
      !Array.isArray(families) ||
      families.length === 0 ||
      families.some((family) => !isNonEmptyString(family))
    ) {
      errors.push(`${path} must use a non-empty ordered fallback array.`);
    } else {
      const generic = families.at(-1);
      if (typeof generic !== 'string' || !GENERIC_FONT_FAMILIES.has(generic.toLowerCase())) {
        errors.push(`${path} must end in a generic system fallback.`);
      }
      if (families.some((family) => /https?:\/\//i.test(String(family)))) {
        errors.push(`${path} must not fetch a font.`);
      }
    }
    validateAuthoredExtension(
      token['$extensions'],
      `${path}.$extensions`,
      expectedEvidence,
      {
        locator: `${path}.$value`,
        observedValue: stableSerializeJson(families),
      },
      errors,
    );
  }
  return keys;
}

function validateFontSizeTokens(
  value: unknown,
  expectedEvidence: Map<string, EvidenceExpectation>,
  errors: string[],
): string[] {
  if (!isRecord(value)) {
    errors.push('tokens.fontSizes must be an object.');
    return [];
  }
  const keys = Object.keys(value);
  if (!sameOrderedValues(keys, [...keys].sort(compareAscii))) {
    errors.push('tokens.fontSizes keys must be ASCII-sorted.');
  }
  for (const key of keys) {
    const path = `tokens.fontSizes.${key}`;
    if (!TOKEN_KEY_PATTERN.test(key)) errors.push(`${path} has an unsafe token key.`);
    const token = value[key];
    if (!isRecord(token)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (token['$type'] !== 'dimension') errors.push(`${path}.$type must be dimension.`);
    if (!isNonEmptyString(token['$description'])) errors.push(`${path} needs a description.`);
    const dimension = token['$value'];
    if (
      !isRecord(dimension) ||
      dimension['unit'] !== 'px' ||
      typeof dimension['value'] !== 'number' ||
      !Number.isFinite(dimension['value']) ||
      dimension['value'] <= 0
    ) {
      errors.push(`${path} must be a positive finite px dimension.`);
    }
    validateAuthoredExtension(
      token['$extensions'],
      `${path}.$extensions`,
      expectedEvidence,
      {
        locator: `${path}.$value`,
        observedValue: stableSerializeJson(dimension),
      },
      errors,
    );
  }
  return keys;
}

function validateUsageAndLayout(pack: NodeSlideTastePack, errors: string[]): void {
  if (
    !Array.isArray(pack.usage.colors) ||
    !Array.isArray(pack.usage.fonts) ||
    !Array.isArray(pack.usage.fontSizes) ||
    pack.usage.colors.length > 0 ||
    pack.usage.fonts.length > 0 ||
    pack.usage.fontSizes.length > 0
  ) {
    errors.push('Taste packs must keep observed usage arrays empty.');
  }
  const layout = pack.layout;
  if (
    !Number.isFinite(layout.slideWidthInches) ||
    layout.slideWidthInches <= 0 ||
    !Number.isFinite(layout.slideHeightInches) ||
    layout.slideHeightInches <= 0 ||
    !Number.isFinite(layout.aspectRatio) ||
    layout.aspectRatio <= 0
  ) {
    errors.push('layout geometry must be finite and positive.');
  } else if (layout.aspectRatio !== roundSix(layout.slideWidthInches / layout.slideHeightInches)) {
    errors.push('layout aspectRatio must match the authored slide geometry.');
  }
  if (
    layout.slideCount !== 0 ||
    layout.masterCount !== 0 ||
    layout.layoutCount !== 0 ||
    layout.averageShapesPerSlide !== 0 ||
    layout.maximumShapesPerSlide !== 0 ||
    layout.averageTextRunsPerSlide !== 0 ||
    layout.layoutUsage.length !== 0 ||
    layout.embeddedFontsPresent ||
    layout.embeddedFontFamilies.length !== 0 ||
    Object.hasOwn(layout, 'medianFontSizePoints')
  ) {
    errors.push('Taste packs must not manufacture observed deck layout facts.');
  }
  if (!['sparse', 'balanced', 'dense'].includes(layout.density)) {
    errors.push('Taste-pack layout density must be an authored non-unknown intent.');
  }
}

function validateRules(pack: NodeSlideTastePack, errors: string[]): void {
  const rulesExtension = pack.$extensions['com.nodeslide.rules'];
  const expectedPack = EXPECTED_PACKS[pack.$extensions['com.nodeslide.tastePack'].id];
  if (!rulesExtension || !Array.isArray(rulesExtension.rules)) {
    errors.push('com.nodeslide.rules.rules is required.');
    return;
  }
  const ruleIds = rulesExtension.rules.map((rule) => rule.id);
  if (!sameOrderedValues(ruleIds, expectedPack.ruleIds)) {
    errors.push('Rule IDs or their authored order do not match the frozen W5 pack.');
  }
  if (new Set(ruleIds).size !== ruleIds.length) errors.push('Rule IDs must be unique.');
  for (const rule of rulesExtension.rules) {
    const path = `rules.${rule.id || '<missing>'}`;
    if (!isNonEmptyString(rule.id)) errors.push(`${path} needs an ID.`);
    if (!isNonEmptyString(rule.title)) errors.push(`${path} needs a title.`);
    if (!isNonEmptyString(rule.behavior)) errors.push(`${path} needs an authored behavior.`);
    if (!Array.isArray(rule.citations) || rule.citations.length === 0) {
      errors.push(`${path} needs at least one citation.`);
      continue;
    }
    for (const [index, citation] of rule.citations.entries()) {
      const citationPath = `${path}.citations[${index}]`;
      if (!isNonEmptyString(citation.title)) errors.push(`${citationPath}.title is required.`);
      if (!isNonEmptyString(citation.supports))
        errors.push(`${citationPath}.supports is required.`);
      if (!isNonEmptyString(citation.license)) errors.push(`${citationPath}.license is required.`);
      if (!isNonEmptyString(citation.url)) {
        errors.push(`${citationPath}.url is required.`);
        continue;
      }
      try {
        const url = new URL(citation.url);
        if (url.protocol !== 'https:' || !url.hostname || url.pathname === '/') {
          errors.push(`${citationPath}.url must be a direct HTTPS source URL.`);
        }
      } catch {
        errors.push(`${citationPath}.url must be a valid direct HTTPS source URL.`);
      }
    }
  }
  const nonAffiliation = rulesExtension.nonAffiliation;
  if (
    !nonAffiliation ||
    nonAffiliation.independent !== true ||
    !isNonEmptyString(nonAffiliation.statement) ||
    !/not affiliated/i.test(nonAffiliation.statement) ||
    !Array.isArray(nonAffiliation.organizations) ||
    nonAffiliation.organizations.length === 0 ||
    !Array.isArray(nonAffiliation.prohibitedClaims) ||
    nonAffiliation.prohibitedClaims.length === 0
  ) {
    errors.push('A complete independent non-affiliation record is required.');
  }
}

function expectedLayoutEvidence(pack: NodeSlideTastePack, layout: NodeSlideAuthoredLayoutIntent) {
  return stableSerializeJson({
    aspectRatio: pack.layout.aspectRatio,
    density: pack.layout.density,
    guardrails: layout.guardrails,
    heightInches: pack.layout.slideHeightInches,
    safeAreaInches: layout.safeAreaInches ?? null,
    targets: layout.targets,
    widthInches: pack.layout.slideWidthInches,
  });
}

function validatePackMetadata(
  pack: NodeSlideTastePack,
  colorKeys: readonly string[],
  fontFamilyKeys: readonly string[],
  fontSizeKeys: readonly string[],
  colorHexes: Record<string, string>,
  expectedEvidence: Map<string, EvidenceExpectation>,
  errors: string[],
): void {
  const metadata = pack.$extensions['com.nodeslide.tastePack'];
  const expected = EXPECTED_PACKS[metadata.id];
  if (!expected || pack.name !== expected.name) {
    errors.push('Pack internal ID and user-facing name must match the frozen W5 pair.');
  }
  if (pack.source.fileName !== `${metadata.id}.json`) {
    errors.push('source.fileName must use the frozen internal pack ID.');
  }
  if (
    metadata.authorship.method !== 'authored' ||
    metadata.authorship.confidence !== 1 ||
    metadata.authorship.sourceDerived !== false ||
    !isNonEmptyString(metadata.authorship.confidenceMeaning)
  ) {
    errors.push('Taste-pack authorship metadata must explain literal authored confidence.');
  }
  if (
    metadata.fontPolicy.networkFetch !== false ||
    metadata.fontPolicy.embedsFonts !== false ||
    metadata.fontPolicy.requiresGenericFallback !== true
  ) {
    errors.push('Taste packs must use local fallback stacks without fetching or embedding fonts.');
  }
  if (!sameValueSet(metadata.authoredTokenPriority.colors, colorKeys)) {
    errors.push('Authored color priority must list every color exactly once.');
  }
  if (!sameValueSet(metadata.authoredTokenPriority.fontFamilies, fontFamilyKeys)) {
    errors.push('Authored font-family priority must list every family exactly once.');
  }
  if (!sameValueSet(metadata.authoredTokenPriority.fontSizes, fontSizeKeys)) {
    errors.push('Authored font-size priority must list every size exactly once.');
  }

  const layout = metadata.layout;
  if (
    layout.sourceRole !== 'authored' ||
    layout.observedDeckFacts !== false ||
    layout.intendedDensity !== pack.layout.density ||
    !Array.isArray(layout.evidenceIds) ||
    layout.evidenceIds.length !== 1 ||
    !isNonEmptyString(layout.evidenceIds[0]) ||
    !Array.isArray(layout.guardrails) ||
    layout.guardrails.length === 0 ||
    !Number.isFinite(layout.targets.minimumNonFooterFontPoints) ||
    layout.targets.minimumNonFooterFontPoints < 15
  ) {
    errors.push('Layout intent must be complete, explicitly authored, and not observed.');
  } else {
    expectedEvidence.set(layout.evidenceIds[0], {
      locator: '$extensions.com.nodeslide.tastePack.layout',
      observedValue: expectedLayoutEvidence(pack, layout),
    });
  }

  if (
    !Array.isArray(metadata.approvedContrastPairs) ||
    metadata.approvedContrastPairs.length === 0
  ) {
    errors.push('Taste packs need explicit approved contrast pairs.');
  } else {
    const pairIds = new Set<string>();
    for (const pair of metadata.approvedContrastPairs) {
      const pairId = `${pair.foreground}/${pair.background}/${pair.usage}`;
      if (pairIds.has(pairId)) errors.push(`Duplicate approved contrast pair ${pairId}.`);
      pairIds.add(pairId);
      const foreground = colorHexes[pair.foreground];
      const background = colorHexes[pair.background];
      if (!foreground || !background) {
        errors.push(`Approved contrast pair ${pairId} references an unknown color.`);
        continue;
      }
      const ratio = contrastRatioForHex(foreground, background);
      if (ratio === null || ratio < pair.minimumRatio) {
        errors.push(`Approved contrast pair ${pairId} does not meet ${pair.minimumRatio}:1.`);
      }
    }
  }
}

function validateEvidence(
  pack: NodeSlideTastePack,
  expectedEvidence: ReadonlyMap<string, EvidenceExpectation>,
  errors: string[],
): void {
  if (!Array.isArray(pack.evidence)) {
    errors.push('evidence must be an array.');
    return;
  }
  const ids = pack.evidence.map((item) => item.id);
  if (!sameOrderedValues(ids, [...ids].sort(compareAscii))) {
    errors.push('Evidence IDs must be ASCII-sorted.');
  }
  if (new Set(ids).size !== ids.length) errors.push('Evidence IDs must be unique.');
  if (ids.length !== expectedEvidence.size) {
    errors.push('Every evidence record must be referenced by one authored token or layout intent.');
  }
  for (const item of pack.evidence) {
    if (!EVIDENCE_ID_PATTERN.test(item.id)) errors.push(`Evidence ${item.id} has an unsafe ID.`);
    if (item.sourceKind !== 'taste_pack')
      errors.push(`Evidence ${item.id} sourceKind must be taste_pack.`);
    if (item.method !== 'authored') errors.push(`Evidence ${item.id} method must be authored.`);
    if (item.confidence !== 1) errors.push(`Evidence ${item.id} confidence must equal 1.`);
    if (item.sourceDigest !== pack.source.digest) {
      errors.push(`Evidence ${item.id} must carry the pack source digest.`);
    }
    if (/https?:\/\//i.test(`${item.locator}\n${item.observedValue}`)) {
      errors.push(`Evidence ${item.id} must not contain rule citation URLs.`);
    }
    const expected = expectedEvidence.get(item.id);
    if (!expected) {
      errors.push(`Evidence ${item.id} is not referenced.`);
      continue;
    }
    if (item.locator !== expected.locator)
      errors.push(`Evidence ${item.id} has the wrong locator.`);
    if (item.observedValue !== expected.observedValue) {
      errors.push(`Evidence ${item.id} does not preserve the literal authored value.`);
    }
  }
}

export function validateNodeSlideTastePack(value: unknown): NodeSlideTastePackValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['Taste pack must be an object.'] };
  if (value['schemaVersion'] !== NODESLIDE_SIGNATURE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${NODESLIDE_SIGNATURE_SCHEMA_VERSION}.`);
  }
  if (!isNonEmptyString(value['id'])) errors.push('id is required.');
  if (!isNonEmptyString(value['name'])) errors.push('name is required.');
  const source = value['source'];
  if (!isRecord(source) || source['kind'] !== 'taste_pack') {
    errors.push('source.kind must be taste_pack.');
  } else if (
    typeof source['digest'] !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(source['digest'])
  ) {
    errors.push('source.digest must be a lowercase SHA-256 digest.');
  }
  if (!isRecord(value['tokens'])) {
    errors.push('tokens must be an object.');
    return { ok: false, errors };
  }
  if (!isRecord(value['usage']) || !isRecord(value['layout'])) {
    errors.push('usage and layout objects are required.');
    return { ok: false, errors };
  }
  if (!Array.isArray(value['evidence']) || !Array.isArray(value['warnings'])) {
    errors.push('evidence and warnings must be arrays.');
    return { ok: false, errors };
  }
  if (value['confidence'] !== 'high') errors.push('Authored taste-pack confidence must be high.');
  if (value['warnings'].length !== 0) {
    errors.push('Static authored packs must not contain extraction warnings.');
  }
  const profileExtensions = value['$extensions'];
  if (!isRecord(profileExtensions)) {
    errors.push('Profile-level W5 extensions are required.');
    return { ok: false, errors };
  }
  const rulesExtension = profileExtensions['com.nodeslide.rules'];
  const metadataExtension = profileExtensions['com.nodeslide.tastePack'];
  if (!isRecord(rulesExtension) || !isRecord(metadataExtension)) {
    errors.push('Both com.nodeslide.rules and com.nodeslide.tastePack are required.');
    return { ok: false, errors };
  }
  const internalId = metadataExtension['id'];
  if (typeof internalId !== 'string' || !(internalId in EXPECTED_PACKS)) {
    errors.push('Unknown taste-pack internal ID.');
    return { ok: false, errors };
  }

  const pack = value as unknown as NodeSlideTastePack;
  try {
    const expectedEvidence = new Map<string, EvidenceExpectation>();
    const colorHexes = validateColorTokens(pack.tokens.colors, expectedEvidence, errors);
    const fontFamilyKeys = validateFontFamilyTokens(
      pack.tokens.fontFamilies,
      expectedEvidence,
      errors,
    );
    const fontSizeKeys = validateFontSizeTokens(pack.tokens.fontSizes, expectedEvidence, errors);
    const colorKeys = Object.keys(colorHexes);

    validateUsageAndLayout(pack, errors);
    validateRules(pack, errors);
    validatePackMetadata(
      pack,
      colorKeys,
      fontFamilyKeys,
      fontSizeKeys,
      colorHexes,
      expectedEvidence,
      errors,
    );
    validateEvidence(pack, expectedEvidence, errors);
    if (!hasValidTastePackIdentity(pack)) {
      errors.push('Pack ID or source digest is not derived from canonical authored content.');
    }
  } catch {
    errors.push('Taste pack has missing or malformed required fields.');
  }
  return { ok: errors.length === 0, errors };
}

export function assertNodeSlideTastePack(value: unknown): asserts value is NodeSlideTastePack {
  const result = validateNodeSlideTastePack(value);
  if (!result.ok) throw new TypeError(result.errors.join('\n'));
}
