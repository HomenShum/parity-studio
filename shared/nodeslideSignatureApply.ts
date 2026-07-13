import type {
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
  ThemeSpec,
  ValidationIssue,
} from './nodeslide';
import {
  NODESLIDE_SIGNATURE_SCHEMA_VERSION,
  type SignatureColorToken,
  type SignatureDimensionToken,
  type SignatureFontFamilyToken,
  type SignatureProfile,
  type SignatureTokenEvidenceExtension,
} from './nodeslideSignature';

export const NODESLIDE_SIGNATURE_APPLY_VERSION = 'nodeslide.signature-apply/v1' as const;
export const NODESLIDE_SIGNATURE_OPERATION_LIMIT = 512 as const;
export const NODESLIDE_ON_BRAND_ISSUE_LIMIT = 512 as const;

const PROFILE_EVIDENCE_LIMIT = 2_000;
const PROFILE_TOKEN_LIMIT = 2_000;
const PROFILE_USAGE_LIMIT = 128;
const MIN_BRAND_TYPE_SIZE_PT = 12;
const MIN_TEXT_CONTRAST = 4.5;
const CSS_GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

const SAFE_THEME: ResolvedSignatureTheme = {
  colors: {
    canvas: '#F5F1E8',
    ink: '#14231C',
    muted: '#5F6B64',
    accent: '#B44A2D',
    accentSoft: '#F8D8CC',
    border: '#D8D1C5',
    data: ['#B44A2D', '#6B5BD2', '#287A8D', '#17442D', '#A15C00', '#7A3654'],
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
    titlePt: 40,
    bodyPt: 18,
    dataPt: 14,
  },
};

export interface ResolvedSignatureTheme {
  colors: {
    canvas: string;
    ink: string;
    muted: string;
    accent: string;
    accentSoft: string;
    border: string;
    data: string[];
  };
  typography: {
    display: string;
    body: string;
    data: string;
    titlePt: number;
    bodyPt: number;
    dataPt: number;
  };
}

export type SignatureResolvedRole =
  | 'colors.canvas'
  | 'colors.ink'
  | 'colors.muted'
  | 'colors.accent'
  | 'colors.accentSoft'
  | 'colors.border'
  | 'colors.data'
  | 'typography.display'
  | 'typography.body'
  | 'typography.data'
  | 'typography.titlePt'
  | 'typography.bodyPt'
  | 'typography.dataPt';

export type SignatureApplicationWarningCode =
  | 'ooxml_role_fallback'
  | 'authored_token_fallback'
  | 'observed_usage_fallback'
  | 'deck_theme_fallback'
  | 'safe_default_fallback'
  | 'contrast_adjusted'
  | 'type_scale_adjusted';

export interface SignatureApplicationWarning {
  code: SignatureApplicationWarningCode;
  role: SignatureResolvedRole;
  message: string;
  evidenceIds: string[];
}

export type SignatureApplicationErrorCode =
  | 'schema'
  | 'scope'
  | 'already_applied'
  | 'operation_limit_exceeded';

export interface SignatureApplicationError {
  code: SignatureApplicationErrorCode;
  message: string;
  path?: string;
  limit?: number;
  requiredOperations?: number;
  resolvedTheme?: ResolvedSignatureTheme;
  warnings?: SignatureApplicationWarning[];
  skippedLockedElementIds?: string[];
  unchangedElementIds?: string[];
}

export type ResolvedSignatureThemeResult =
  | {
      ok: true;
      theme: ResolvedSignatureTheme;
      warnings: SignatureApplicationWarning[];
    }
  | { ok: false; error: SignatureApplicationError };

export interface ResolveSignatureThemeOptions {
  currentTheme?: ThemeSpec;
}

export interface SignatureApplicationPlan {
  version: typeof NODESLIDE_SIGNATURE_APPLY_VERSION;
  id: string;
  deckId: string;
  profileId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  skippedLockedElementIds: string[];
  unchangedElementIds: string[];
  resolvedTheme: ResolvedSignatureTheme;
  warnings: SignatureApplicationWarning[];
}

export type SignatureApplicationResult =
  | { ok: true; plan: SignatureApplicationPlan }
  | { ok: false; error: SignatureApplicationError };

export interface SignatureApplicationOptions {
  scope?: PatchScope;
}

export interface OnBrandIssueOptions {
  scope?: PatchScope;
  skipLocked?: boolean;
  maxIssues?: number;
}

type IssueDraft = Omit<ValidationIssue, 'id'>;

interface ScopeSelection {
  scope: PatchScope;
  slideIds: ReadonlySet<string>;
  elementIds: ReadonlySet<string> | null;
  includeSlideBackgrounds: boolean;
}

interface ColorCandidate {
  key: string;
  value: string;
  evidenceIds: string[];
  occurrences: number;
  semanticRole?: string;
  ooxmlRole?: string;
  sourceRole?: SignatureTokenEvidenceExtension['sourceRole'];
  authoredPriority?: number;
}

interface ValueCandidate<T> {
  key: string;
  value: T;
  evidenceIds: string[];
  occurrences: number;
  semanticRole?: string;
  ooxmlRole?: string;
  sourceRole?: SignatureTokenEvidenceExtension['sourceRole'];
  authoredPriority?: number;
}

interface ResolvedValue<T> {
  value: T;
  evidenceIds: string[];
  source: 'semantic' | 'ooxml' | 'authored' | 'observed' | 'deck' | 'safe';
}

interface InternalThemeResolution {
  theme: ResolvedSignatureTheme;
  warnings: SignatureApplicationWarning[];
}

const STYLE_PROPERTY_ORDER = [
  'fill',
  'stroke',
  'strokeWidth',
  'color',
  'fontFamily',
  'fontSize',
] as const satisfies readonly (keyof ElementStyle)[];

const ON_BRAND_CODE_ORDER = [
  'on_brand_color',
  'on_brand_font',
  'on_brand_type_scale',
] as const satisfies readonly ValidationIssue['code'][];

export function resolveSignatureTheme(
  profile: SignatureProfile,
  options: ResolveSignatureThemeOptions = {},
): ResolvedSignatureThemeResult {
  const error = validateSignatureProfile(profile);
  if (error) return { ok: false, error };
  const resolution = resolveValidSignatureTheme(profile, options.currentTheme);
  return {
    ok: true,
    theme: resolution.theme,
    warnings: resolution.warnings,
  };
}

export function planSignatureApplication(
  snapshot: DeckSnapshot,
  profile: SignatureProfile,
  options: SignatureApplicationOptions = {},
): SignatureApplicationResult {
  const snapshotError = validateSnapshotForPlanning(snapshot);
  if (snapshotError) return { ok: false, error: snapshotError };

  const profileError = validateSignatureProfile(profile);
  if (profileError) return { ok: false, error: profileError };

  const preparedScope = preparePatchScope(
    options.scope ?? {
      kind: 'deck',
      deckId: snapshot.deck.id,
      operationMode: 'unrestricted',
    },
  );
  if ('error' in preparedScope) return { ok: false, error: preparedScope.error };
  const scope = preparedScope.scope;
  const selectionResult = selectScope(snapshot, scope);
  if ('error' in selectionResult) return { ok: false, error: selectionResult.error };

  const resolution = resolveValidSignatureTheme(profile, snapshot.deck.theme);
  const operations: PatchOperation[] = [];
  const skippedLockedElementIds: string[] = [];
  const unchangedElementIds: string[] = [];
  let requiredOperations = 0;

  const retainOperation = (operation: PatchOperation) => {
    requiredOperations += 1;
    if (operations.length < NODESLIDE_SIGNATURE_OPERATION_LIMIT) operations.push(operation);
  };

  for (const slide of orderedSlides(snapshot)) {
    if (!selectionResult.selection.slideIds.has(slide.id)) continue;

    if (
      selectionResult.selection.includeSlideBackgrounds &&
      !colorsEqual(slide.background, resolution.theme.colors.canvas)
    ) {
      retainOperation({
        op: 'update_slide',
        slideId: slide.id,
        properties: { background: resolution.theme.colors.canvas },
      });
    }

    for (const element of orderedElements(snapshot, slide)) {
      if (!elementIsSelected(selectionResult.selection, element)) continue;
      if (element.locked) {
        skippedLockedElementIds.push(element.id);
        continue;
      }

      const expected = expectedElementStyle(element, resolution.theme, snapshot.deck.theme);
      const delta = styleDelta(element.style, expected);
      if (Object.keys(delta).length === 0) {
        unchangedElementIds.push(element.id);
        continue;
      }
      retainOperation({
        op: 'update_style',
        slideId: slide.id,
        elementId: element.id,
        properties: delta,
      });
    }
  }

  if (requiredOperations > NODESLIDE_SIGNATURE_OPERATION_LIMIT) {
    return {
      ok: false,
      error: {
        code: 'operation_limit_exceeded',
        message: `Signature application requires ${requiredOperations} operations; the hard limit is ${NODESLIDE_SIGNATURE_OPERATION_LIMIT}. No operations were returned.`,
        limit: NODESLIDE_SIGNATURE_OPERATION_LIMIT,
        requiredOperations,
      },
    };
  }

  if (requiredOperations === 0) {
    return {
      ok: false,
      error: {
        code: 'already_applied',
        message: 'The selected scope already matches the resolved signature theme.',
        requiredOperations: 0,
        resolvedTheme: resolution.theme,
        warnings: resolution.warnings,
        skippedLockedElementIds,
        unchangedElementIds,
      },
    };
  }

  const clocks = clocksForOperations(snapshot, operations);
  const planWithoutId = {
    version: NODESLIDE_SIGNATURE_APPLY_VERSION,
    deckId: snapshot.deck.id,
    profileId: profile.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: clocks.baseSlideVersions,
    baseElementVersions: clocks.baseElementVersions,
    scope,
    operations,
    skippedLockedElementIds,
    unchangedElementIds,
    resolvedTheme: resolution.theme,
    warnings: resolution.warnings,
  } satisfies Omit<SignatureApplicationPlan, 'id'>;

  return {
    ok: true,
    plan: {
      ...planWithoutId,
      id: `signature-plan:${snapshot.deck.id}:${profile.id}:v${snapshot.deck.version}:${stableHash(
        stableSerialize(planWithoutId),
      )}`,
    },
  };
}

export function onBrandIssues(
  snapshot: DeckSnapshot,
  profile: SignatureProfile,
  options: OnBrandIssueOptions = {},
): IssueDraft[] {
  const issueLimit = boundedIssueLimit(options.maxIssues);
  const snapshotError = validateSnapshotForPlanning(snapshot);
  if (snapshotError) return [applicationErrorIssue(snapshotError)];
  const profileError = validateSignatureProfile(profile);
  if (profileError) return [applicationErrorIssue(profileError)];

  const preparedScope = preparePatchScope(
    options.scope ?? {
      kind: 'deck',
      deckId: snapshot.deck.id,
      operationMode: 'unrestricted',
    },
  );
  if ('error' in preparedScope) return [applicationErrorIssue(preparedScope.error)];
  const scope = preparedScope.scope;
  const selectionResult = selectScope(snapshot, scope);
  if ('error' in selectionResult) return [applicationErrorIssue(selectionResult.error)];

  const resolution = resolveValidSignatureTheme(profile, snapshot.deck.theme);
  const collector = createIssueCollector(issueLimit);
  const skipLocked = options.skipLocked !== false;

  for (const slide of orderedSlides(snapshot)) {
    if (!selectionResult.selection.slideIds.has(slide.id)) continue;
    if (
      selectionResult.selection.includeSlideBackgrounds &&
      !colorsEqual(slide.background, resolution.theme.colors.canvas)
    ) {
      collector.add({
        severity: 'warning',
        code: 'on_brand_background',
        message: `Slide "${slide.id}" background is ${displayValue(slide.background)}; expected ${resolution.theme.colors.canvas}.${warningSuffix(
          resolution.warnings,
          'on_brand_background',
        )}`,
        slideId: slide.id,
      });
    }

    const lockedIds: string[] = [];
    for (const element of orderedElements(snapshot, slide)) {
      if (!elementIsSelected(selectionResult.selection, element)) continue;
      if (element.locked && skipLocked) {
        lockedIds.push(element.id);
        continue;
      }
      addElementBrandIssues(
        collector,
        slide,
        element,
        expectedElementStyle(element, resolution.theme, snapshot.deck.theme),
        resolution.warnings,
      );
    }

    if (lockedIds.length > 0) {
      collector.add({
        severity: 'info',
        code: 'scope',
        message: lockedSummary(slide.id, lockedIds),
        slideId: slide.id,
      });
    }
  }

  for (const warning of resolution.warnings) {
    if (!warning.code.endsWith('_fallback')) continue;
    collector.add({
      severity: 'info',
      code: 'scope',
      message: `Signature resolution warning "${warning.code}" for ${warning.role}: ${warning.message}`,
    });
  }

  return collector.finish();
}

function validateSignatureProfile(
  profile: SignatureProfile,
): SignatureApplicationError | undefined {
  const value: unknown = profile;
  if (!isRecord(value)) return schemaError('profile', 'must be an object');
  if (value['schemaVersion'] !== NODESLIDE_SIGNATURE_SCHEMA_VERSION) {
    return schemaError('profile.schemaVersion', `must be "${NODESLIDE_SIGNATURE_SCHEMA_VERSION}"`);
  }
  if (!isNonemptyString(value['id'])) return schemaError('profile.id', 'must be non-empty');
  if (!isNonemptyString(value['name'])) return schemaError('profile.name', 'must be non-empty');
  if (!['high', 'medium', 'low'].includes(String(value['confidence']))) {
    return schemaError('profile.confidence', 'must be high, medium, or low');
  }

  const source = value['source'];
  if (!isRecord(source)) return schemaError('profile.source', 'must be an object');
  if (!['pptx', 'pdf', 'screenshot', 'taste_pack'].includes(String(source['kind']))) {
    return schemaError('profile.source.kind', 'is unsupported');
  }
  if (!isNonemptyString(source['digest'])) {
    return schemaError('profile.source.digest', 'must be non-empty');
  }

  const tokens = value['tokens'];
  if (!isRecord(tokens)) return schemaError('profile.tokens', 'must be an object');
  const colors = tokens['colors'];
  const fonts = tokens['fontFamilies'];
  const sizes = tokens['fontSizes'];
  if (!isRecord(colors)) return schemaError('profile.tokens.colors', 'must be a record');
  if (!isRecord(fonts)) return schemaError('profile.tokens.fontFamilies', 'must be a record');
  if (!isRecord(sizes)) return schemaError('profile.tokens.fontSizes', 'must be a record');
  if (Object.keys(colors).length > PROFILE_TOKEN_LIMIT) {
    return schemaError('profile.tokens.colors', `cannot exceed ${PROFILE_TOKEN_LIMIT} entries`);
  }
  if (Object.keys(fonts).length > PROFILE_TOKEN_LIMIT) {
    return schemaError(
      'profile.tokens.fontFamilies',
      `cannot exceed ${PROFILE_TOKEN_LIMIT} entries`,
    );
  }
  if (Object.keys(sizes).length > PROFILE_TOKEN_LIMIT) {
    return schemaError('profile.tokens.fontSizes', `cannot exceed ${PROFILE_TOKEN_LIMIT} entries`);
  }

  for (const key of Object.keys(colors).sort(compareText)) {
    const error = validateColorToken(colors[key], `profile.tokens.colors.${key}`);
    if (error) return error;
  }
  for (const key of Object.keys(fonts).sort(compareText)) {
    const error = validateFontToken(fonts[key], `profile.tokens.fontFamilies.${key}`);
    if (error) return error;
  }
  for (const key of Object.keys(sizes).sort(compareText)) {
    const error = validateDimensionToken(sizes[key], `profile.tokens.fontSizes.${key}`);
    if (error) return error;
  }

  const usage = value['usage'];
  if (!isRecord(usage)) return schemaError('profile.usage', 'must be an object');
  const usageColors = usage['colors'];
  const usageFonts = usage['fonts'];
  const usageSizes = usage['fontSizes'];
  if (!Array.isArray(usageColors)) return schemaError('profile.usage.colors', 'must be an array');
  if (!Array.isArray(usageFonts)) return schemaError('profile.usage.fonts', 'must be an array');
  if (!Array.isArray(usageSizes)) {
    return schemaError('profile.usage.fontSizes', 'must be an array');
  }
  if (
    usageColors.length > PROFILE_USAGE_LIMIT ||
    usageFonts.length > PROFILE_USAGE_LIMIT ||
    usageSizes.length > PROFILE_USAGE_LIMIT
  ) {
    return schemaError(
      'profile.usage',
      `each usage category cannot exceed ${PROFILE_USAGE_LIMIT} entries`,
    );
  }
  for (let index = 0; index < usageColors.length; index += 1) {
    const item = usageColors[index];
    const path = `profile.usage.colors.${index}`;
    const commonError = validateUsageRecord(item, path);
    if (commonError) return commonError;
    if (!canonicalHex((item as Record<string, unknown>)['value'])) {
      return schemaError(`${path}.value`, 'must be an sRGB hex color');
    }
  }
  for (let index = 0; index < usageFonts.length; index += 1) {
    const item = usageFonts[index];
    const path = `profile.usage.fonts.${index}`;
    const commonError = validateUsageRecord(item, path);
    if (commonError) return commonError;
    if (!isNonemptyString((item as Record<string, unknown>)['value'])) {
      return schemaError(`${path}.value`, 'must be a non-empty font family');
    }
  }
  for (let index = 0; index < usageSizes.length; index += 1) {
    const item = usageSizes[index];
    const path = `profile.usage.fontSizes.${index}`;
    const commonError = validateUsageRecord(item, path);
    if (commonError) return commonError;
    const record = item as Record<string, unknown>;
    if (!isPositiveFinite(record['value']) || record['unit'] !== 'pt') {
      return schemaError(path, 'must contain a positive finite point value');
    }
  }

  const evidence = value['evidence'];
  if (!Array.isArray(evidence)) return schemaError('profile.evidence', 'must be an array');
  if (evidence.length > PROFILE_EVIDENCE_LIMIT) {
    return schemaError('profile.evidence', `cannot exceed ${PROFILE_EVIDENCE_LIMIT} entries`);
  }
  const evidenceIds = new Set<string>();
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const path = `profile.evidence.${index}`;
    if (!isRecord(item)) return schemaError(path, 'must be an object');
    if (!isNonemptyString(item['id'])) return schemaError(`${path}.id`, 'must be non-empty');
    if (evidenceIds.has(item['id'])) {
      return schemaError(`${path}.id`, 'must be unique');
    }
    evidenceIds.add(item['id']);
    if (!isUnitInterval(item['confidence'])) {
      return schemaError(`${path}.confidence`, 'must be finite and between 0 and 1');
    }
    if (!isNonemptyString(item['locator'])) {
      return schemaError(`${path}.locator`, 'must be non-empty');
    }
    if (typeof item['observedValue'] !== 'string') {
      return schemaError(`${path}.observedValue`, 'must be a string');
    }
  }

  const layoutError = validateProfileLayout(value['layout']);
  if (layoutError) return layoutError;
  if (!Array.isArray(value['warnings'])) {
    return schemaError('profile.warnings', 'must be an array');
  }
  return undefined;
}

function validateColorToken(token: unknown, path: string): SignatureApplicationError | undefined {
  if (!isRecord(token) || token['$type'] !== 'color') {
    return schemaError(path, 'must be a color token');
  }
  const extensionError = validateTokenExtension(token, path);
  if (extensionError) return extensionError;
  const color = token['$value'];
  if (!isRecord(color) || color['colorSpace'] !== 'srgb') {
    return schemaError(`${path}.$value`, 'must use the srgb color space');
  }
  const components = color['components'];
  if (!Array.isArray(components) || components.length !== 3 || !components.every(isUnitInterval)) {
    return schemaError(`${path}.$value.components`, 'must contain three finite 0..1 values');
  }
  if (color['alpha'] !== undefined && !isUnitInterval(color['alpha'])) {
    return schemaError(`${path}.$value.alpha`, 'must be finite and between 0 and 1');
  }
  const hex = color['hex'];
  if (typeof hex !== 'string' || !/^#[0-9A-F]{6}$/.test(hex)) {
    return schemaError(`${path}.$value.hex`, 'must be canonical uppercase #RRGGBB');
  }
  const componentHex = rgbComponentsToHex(components as number[]);
  if (componentHex !== hex) {
    return schemaError(`${path}.$value`, 'hex must represent the declared sRGB components');
  }
  return undefined;
}

function validateFontToken(token: unknown, path: string): SignatureApplicationError | undefined {
  if (!isRecord(token) || token['$type'] !== 'fontFamily') {
    return schemaError(path, 'must be a font-family token');
  }
  const extensionError = validateTokenExtension(token, path);
  if (extensionError) return extensionError;
  const value = token['$value'];
  if (typeof value === 'string') {
    if (!value.trim()) return schemaError(`${path}.$value`, 'must not be empty');
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonemptyString)) {
    return schemaError(`${path}.$value`, 'must be a non-empty font-family list');
  }
  return undefined;
}

function validateDimensionToken(
  token: unknown,
  path: string,
): SignatureApplicationError | undefined {
  if (!isRecord(token) || token['$type'] !== 'dimension') {
    return schemaError(path, 'must be a dimension token');
  }
  const extensionError = validateTokenExtension(token, path);
  if (extensionError) return extensionError;
  const value = token['$value'];
  if (!isRecord(value) || value['unit'] !== 'px' || !isPositiveFinite(value['value'])) {
    return schemaError(`${path}.$value`, 'must be a positive finite px dimension');
  }
  const extensions = token['$extensions'];
  const extension = isRecord(extensions) ? extensions['com.nodeslide.signature'] : undefined;
  const originalPoints = isRecord(extension) ? extension['originalPoints'] : undefined;
  if (originalPoints !== undefined && !isPositiveFinite(originalPoints)) {
    return schemaError(
      `${path}.$extensions.com.nodeslide.signature.originalPoints`,
      'must be positive and finite',
    );
  }
  return undefined;
}

function validateTokenExtension(
  token: Record<string, unknown>,
  path: string,
): SignatureApplicationError | undefined {
  const extensions = token['$extensions'];
  if (!isRecord(extensions)) {
    return schemaError(`${path}.$extensions`, 'must be an object');
  }
  const extension = extensions['com.nodeslide.signature'];
  if (!isRecord(extension)) {
    return schemaError(
      `${path}.$extensions.com.nodeslide.signature`,
      'must be an evidence extension',
    );
  }
  const evidenceIds = extension['evidenceIds'];
  if (
    !Array.isArray(evidenceIds) ||
    evidenceIds.length > PROFILE_EVIDENCE_LIMIT ||
    !evidenceIds.every(isNonemptyString)
  ) {
    return schemaError(
      `${path}.$extensions.com.nodeslide.signature.evidenceIds`,
      `must contain at most ${PROFILE_EVIDENCE_LIMIT} non-empty IDs`,
    );
  }
  if (!isUnitInterval(extension['confidence'])) {
    return schemaError(
      `${path}.$extensions.com.nodeslide.signature.confidence`,
      'must be finite and between 0 and 1',
    );
  }
  if (!isNonnegativeInteger(extension['occurrences'])) {
    return schemaError(
      `${path}.$extensions.com.nodeslide.signature.occurrences`,
      'must be a non-negative integer',
    );
  }
  if (
    !['theme', 'master', 'layout', 'slide', 'inferred', 'authored'].includes(
      String(extension['sourceRole']),
    )
  ) {
    return schemaError(`${path}.$extensions.com.nodeslide.signature.sourceRole`, 'is unsupported');
  }
  return undefined;
}

function validateUsageRecord(item: unknown, path: string): SignatureApplicationError | undefined {
  if (!isRecord(item)) return schemaError(path, 'must be an object');
  if (!isNonnegativeInteger(item['occurrences'])) {
    return schemaError(`${path}.occurrences`, 'must be a non-negative integer');
  }
  const evidenceIds = item['evidenceIds'];
  if (
    !Array.isArray(evidenceIds) ||
    evidenceIds.length > PROFILE_EVIDENCE_LIMIT ||
    !evidenceIds.every(isNonemptyString)
  ) {
    return schemaError(`${path}.evidenceIds`, 'must be a bounded array of non-empty IDs');
  }
  return undefined;
}

function validateProfileLayout(layout: unknown): SignatureApplicationError | undefined {
  if (!isRecord(layout)) return schemaError('profile.layout', 'must be an object');
  for (const key of ['slideWidthInches', 'slideHeightInches', 'aspectRatio'] as const) {
    if (!isPositiveFinite(layout[key])) {
      return schemaError(`profile.layout.${key}`, 'must be positive and finite');
    }
  }
  for (const key of [
    'slideCount',
    'masterCount',
    'layoutCount',
    'maximumShapesPerSlide',
  ] as const) {
    if (!isNonnegativeInteger(layout[key])) {
      return schemaError(`profile.layout.${key}`, 'must be a non-negative integer');
    }
  }
  for (const key of ['averageShapesPerSlide', 'averageTextRunsPerSlide'] as const) {
    if (!isNonnegativeFinite(layout[key])) {
      return schemaError(`profile.layout.${key}`, 'must be finite and non-negative');
    }
  }
  if (
    layout['medianFontSizePoints'] !== undefined &&
    !isPositiveFinite(layout['medianFontSizePoints'])
  ) {
    return schemaError('profile.layout.medianFontSizePoints', 'must be positive and finite');
  }
  if (!['sparse', 'balanced', 'dense', 'unknown'].includes(String(layout['density']))) {
    return schemaError('profile.layout.density', 'is unsupported');
  }
  if (typeof layout['embeddedFontsPresent'] !== 'boolean') {
    return schemaError('profile.layout.embeddedFontsPresent', 'must be boolean');
  }
  if (
    !Array.isArray(layout['embeddedFontFamilies']) ||
    !layout['embeddedFontFamilies'].every(isNonemptyString)
  ) {
    return schemaError('profile.layout.embeddedFontFamilies', 'must contain non-empty names');
  }
  const layoutUsage = layout['layoutUsage'];
  if (!Array.isArray(layoutUsage)) {
    return schemaError('profile.layout.layoutUsage', 'must be an array');
  }
  for (let index = 0; index < layoutUsage.length; index += 1) {
    const entry = layoutUsage[index];
    if (
      !isRecord(entry) ||
      !isNonemptyString(entry['partName']) ||
      !isNonnegativeInteger(entry['occurrences'])
    ) {
      return schemaError(`profile.layout.layoutUsage.${index}`, 'is malformed');
    }
  }
  return undefined;
}

function validateSnapshotForPlanning(
  snapshot: DeckSnapshot,
): SignatureApplicationError | undefined {
  if (!isRecord(snapshot) || !isRecord(snapshot.deck)) {
    return schemaError('snapshot', 'must contain a deck');
  }
  if (!isNonemptyString(snapshot.deck.id)) {
    return schemaError('snapshot.deck.id', 'must be non-empty');
  }
  if (!isNonnegativeInteger(snapshot.deck.version)) {
    return schemaError('snapshot.deck.version', 'must be a non-negative integer');
  }
  if (
    !isRecord(snapshot.deck.theme) ||
    !isRecord(snapshot.deck.theme.colors) ||
    !isRecord(snapshot.deck.theme.typography)
  ) {
    return schemaError('snapshot.deck.theme', 'must contain color and typography records');
  }
  if (!Array.isArray(snapshot.slides) || !Array.isArray(snapshot.elements)) {
    return schemaError('snapshot', 'must contain slide and element arrays');
  }

  const slidesById = new Map<string, Slide>();
  for (const slide of snapshot.slides) {
    if (!isNonemptyString(slide.id) || slidesById.has(slide.id)) {
      return schemaError('snapshot.slides', 'must have unique non-empty IDs');
    }
    if (slide.deckId !== snapshot.deck.id || !isNonnegativeInteger(slide.version)) {
      return schemaError(`snapshot.slides.${slide.id}`, 'has an invalid deck or version');
    }
    if (typeof slide.background !== 'string') {
      return schemaError(`snapshot.slides.${slide.id}.background`, 'must be a string');
    }
    slidesById.set(slide.id, slide);
  }
  if (
    !Array.isArray(snapshot.deck.slideOrder) ||
    new Set(snapshot.deck.slideOrder).size !== snapshot.deck.slideOrder.length ||
    snapshot.deck.slideOrder.length !== snapshot.slides.length ||
    snapshot.deck.slideOrder.some((slideId) => !slidesById.has(slideId))
  ) {
    return schemaError('snapshot.deck.slideOrder', 'must order every slide exactly once');
  }

  const elementsById = new Map<string, SlideElement>();
  for (const element of snapshot.elements) {
    if (!isNonemptyString(element.id) || elementsById.has(element.id)) {
      return schemaError('snapshot.elements', 'must have unique non-empty IDs');
    }
    if (!slidesById.has(element.slideId) || !isNonnegativeInteger(element.version)) {
      return schemaError(`snapshot.elements.${element.id}`, 'has an invalid slide or version');
    }
    if (!isRecord(element.style) || typeof element.locked !== 'boolean') {
      return schemaError(`snapshot.elements.${element.id}`, 'has invalid style or lock state');
    }
    elementsById.set(element.id, element);
  }
  for (const slide of snapshot.slides) {
    const expectedIds = snapshot.elements
      .filter((element) => element.slideId === slide.id)
      .map((element) => element.id);
    if (
      !Array.isArray(slide.elementOrder) ||
      new Set(slide.elementOrder).size !== slide.elementOrder.length ||
      slide.elementOrder.length !== expectedIds.length ||
      slide.elementOrder.some((elementId) => elementsById.get(elementId)?.slideId !== slide.id)
    ) {
      return schemaError(
        `snapshot.slides.${slide.id}.elementOrder`,
        'must order every slide element exactly once',
      );
    }
  }
  return undefined;
}

function selectScope(
  snapshot: DeckSnapshot,
  scope: PatchScope,
): { selection: ScopeSelection } | { error: SignatureApplicationError } {
  if (scope.deckId !== snapshot.deck.id) {
    return {
      error: scopeError(
        `Scope deck "${scope.deckId}" does not match snapshot deck "${snapshot.deck.id}".`,
      ),
    };
  }
  if (scope.operationMode === 'copy' || scope.operationMode === 'layout') {
    return {
      error: scopeError(
        `Signature application cannot run in ${scope.operationMode}-only operation mode.`,
      ),
    };
  }

  const knownSlides = new Set(snapshot.slides.map((slide) => slide.id));
  const knownElements = new Map(snapshot.elements.map((element) => [element.id, element]));
  const requestedSlideIds = scope.kind === 'deck' ? snapshot.deck.slideOrder : scope.slideIds;
  if (new Set(requestedSlideIds).size !== requestedSlideIds.length) {
    return { error: scopeError('Scope slide IDs must be unique.') };
  }
  for (const slideId of requestedSlideIds) {
    if (!knownSlides.has(slideId)) {
      return { error: scopeError(`Scope references unknown slide "${slideId}".`) };
    }
  }

  const hasElementScope =
    scope.kind === 'elements' || scope.kind === 'bounding_box' || scope.kind === 'comment';
  let elementIds: ReadonlySet<string> | null = null;
  if (hasElementScope) {
    if (new Set(scope.elementIds).size !== scope.elementIds.length) {
      return { error: scopeError('Scope element IDs must be unique.') };
    }
    const selectedSlides = new Set(requestedSlideIds);
    for (const elementId of scope.elementIds) {
      const element = knownElements.get(elementId);
      if (!element)
        return { error: scopeError(`Scope references unknown element "${elementId}".`) };
      if (!selectedSlides.has(element.slideId)) {
        return {
          error: scopeError(
            `Scope element "${elementId}" does not belong to a selected scope slide.`,
          ),
        };
      }
    }
    elementIds = new Set(scope.elementIds);
  }

  return {
    selection: {
      scope,
      slideIds: new Set(requestedSlideIds),
      elementIds,
      includeSlideBackgrounds: !hasElementScope && scope.operationMode === 'unrestricted',
    },
  };
}

function resolveValidSignatureTheme(
  profile: SignatureProfile,
  currentTheme: ThemeSpec | undefined,
): InternalThemeResolution {
  const warnings: SignatureApplicationWarning[] = [];
  const colorCandidates = collectColorCandidates(profile);
  const fontCandidates = collectFontCandidates(profile);
  const sizeCandidates = collectSizeCandidates(profile);

  const canvas = resolveFromCandidates(
    'colors.canvas',
    candidatesForSemantic(colorCandidates, 'canvas'),
    candidatesForOoxml(colorCandidates, ['lt1']),
    [...colorCandidates].sort(compareCandidate),
    deckColorCandidate(currentTheme?.colors.canvas, 'deck:canvas'),
    safeCandidate(SAFE_THEME.colors.canvas),
    warnings,
  );

  const inkObserved = [...colorCandidates].sort(
    (left, right) =>
      contrastRatio(right.value, canvas.value) - contrastRatio(left.value, canvas.value) ||
      compareCandidate(left, right),
  );
  let ink = resolveFromCandidates(
    'colors.ink',
    candidatesForSemantic(colorCandidates, 'ink'),
    candidatesForOoxml(colorCandidates, ['dk1']),
    inkObserved.filter((candidate) => candidate.value !== canvas.value),
    deckColorCandidate(currentTheme?.colors.ink, 'deck:ink'),
    safeCandidate(SAFE_THEME.colors.ink),
    warnings,
  );

  const mutedObserved = [...colorCandidates]
    .filter(
      (candidate) =>
        candidate.value !== canvas.value &&
        contrastRatio(candidate.value, canvas.value) >= MIN_TEXT_CONTRAST,
    )
    .sort(compareCandidate);
  let muted = resolveFromCandidates(
    'colors.muted',
    candidatesForSemantic(colorCandidates, 'muted'),
    candidatesForOoxml(colorCandidates, ['dk2']),
    mutedObserved,
    deckColorCandidate(currentTheme?.colors.muted, 'deck:muted'),
    safeCandidate(SAFE_THEME.colors.muted),
    warnings,
  );

  const accentObserved = [...colorCandidates]
    .filter((candidate) => candidate.value !== canvas.value && candidate.value !== ink.value)
    .sort(
      (left, right) =>
        colorChroma(right.value) - colorChroma(left.value) || compareCandidate(left, right),
    );
  const accent = resolveFromCandidates(
    'colors.accent',
    candidatesForSemantic(colorCandidates, 'accent'),
    candidatesForOoxml(colorCandidates, ['accent1']),
    accentObserved,
    deckColorCandidate(currentTheme?.colors.accent, 'deck:accent'),
    safeCandidate(SAFE_THEME.colors.accent),
    warnings,
  );

  const softObserved = [...colorCandidates]
    .filter(
      (candidate) =>
        candidate.value !== canvas.value &&
        candidate.value !== ink.value &&
        contrastRatio(ink.value, candidate.value) >= MIN_TEXT_CONTRAST,
    )
    .sort(
      (left, right) =>
        colorDistance(left.value, canvas.value) - colorDistance(right.value, canvas.value) ||
        compareCandidate(left, right),
    );
  let accentSoft = resolveFromCandidates(
    'colors.accentSoft',
    candidatesForSemantic(colorCandidates, 'accentSoft'),
    candidatesForOoxml(colorCandidates, ['accent2']),
    softObserved,
    deckColorCandidate(currentTheme?.colors.accentSoft, 'deck:accentSoft'),
    safeCandidate(SAFE_THEME.colors.accentSoft),
    warnings,
  );

  const borderObserved = [...colorCandidates]
    .filter((candidate) => candidate.value !== canvas.value)
    .sort(
      (left, right) =>
        colorDistance(left.value, canvas.value) - colorDistance(right.value, canvas.value) ||
        compareCandidate(left, right),
    );
  const border = resolveFromCandidates(
    'colors.border',
    candidatesForSemantic(colorCandidates, 'border'),
    [],
    borderObserved,
    deckColorCandidate(currentTheme?.colors.border, 'deck:border'),
    safeCandidate(SAFE_THEME.colors.border),
    warnings,
  );

  const data = resolveDataColors(colorCandidates, currentTheme, accent, warnings);

  const display = resolveFromCandidates(
    'typography.display',
    candidatesForSemantic(fontCandidates, 'display'),
    candidatesForOoxml(fontCandidates, ['majorlatin', 'majorfont', 'major']),
    [...fontCandidates].sort(compareCandidate),
    deckFontCandidate(currentTheme?.typography.display, 'deck:display'),
    safeCandidate(SAFE_THEME.typography.display),
    warnings,
  );
  const body = resolveFromCandidates(
    'typography.body',
    candidatesForSemantic(fontCandidates, 'body'),
    candidatesForOoxml(fontCandidates, ['minorlatin', 'minorfont', 'minor']),
    [...fontCandidates].sort(compareCandidate),
    deckFontCandidate(currentTheme?.typography.body, 'deck:body'),
    safeCandidate(SAFE_THEME.typography.body),
    warnings,
  );
  const dataFont = resolveFromCandidates(
    'typography.data',
    candidatesForSemantic(fontCandidates, 'data'),
    candidatesForOoxml(fontCandidates, ['minorlatin', 'minorfont', 'minor']),
    [...fontCandidates].sort(compareCandidate),
    deckFontCandidate(currentTheme?.typography.data, 'deck:data'),
    safeCandidate(SAFE_THEME.typography.data),
    warnings,
  );

  const titleObserved = [...sizeCandidates].sort(
    (left, right) => right.value - left.value || compareCandidate(left, right),
  );
  const bodyObserved = [...sizeCandidates].sort(compareCandidate);
  const dataObserved = [...sizeCandidates].sort(
    (left, right) => left.value - right.value || compareCandidate(left, right),
  );
  let titlePt = resolveFromCandidates(
    'typography.titlePt',
    candidatesForSemantic(sizeCandidates, 'titlePt'),
    [],
    titleObserved,
    undefined,
    safeCandidate(SAFE_THEME.typography.titlePt),
    warnings,
  );
  let bodyPt = resolveFromCandidates(
    'typography.bodyPt',
    candidatesForSemantic(sizeCandidates, 'bodyPt'),
    [],
    bodyObserved,
    undefined,
    safeCandidate(SAFE_THEME.typography.bodyPt),
    warnings,
  );
  let dataPt = resolveFromCandidates(
    'typography.dataPt',
    candidatesForSemantic(sizeCandidates, 'dataPt'),
    [],
    dataObserved,
    undefined,
    safeCandidate(SAFE_THEME.typography.dataPt),
    warnings,
  );

  titlePt = enforceTypeFloor('typography.titlePt', titlePt, warnings);
  bodyPt = enforceTypeFloor('typography.bodyPt', bodyPt, warnings);
  dataPt = enforceTypeFloor('typography.dataPt', dataPt, warnings);

  if (contrastRatio(ink.value, canvas.value) < MIN_TEXT_CONTRAST) {
    const replacement = chooseContrastCandidate(canvas.value, colorCandidates, currentTheme);
    warnings.push({
      code: 'contrast_adjusted',
      role: 'colors.ink',
      message: `Adjusted colors.ink to ${replacement.value} because the resolved ink/canvas pair did not meet ${MIN_TEXT_CONTRAST}:1 contrast.`,
      evidenceIds: replacement.evidenceIds,
    });
    ink = replacement;
  }
  if (contrastRatio(muted.value, canvas.value) < MIN_TEXT_CONTRAST) {
    warnings.push({
      code: 'contrast_adjusted',
      role: 'colors.muted',
      message: `Adjusted colors.muted to ${ink.value} because the resolved muted/canvas pair did not meet ${MIN_TEXT_CONTRAST}:1 contrast.`,
      evidenceIds: ink.evidenceIds,
    });
    muted = { ...ink };
  }
  if (contrastRatio(ink.value, accentSoft.value) < MIN_TEXT_CONTRAST) {
    const adjustedSoft = contrastSafeSoftColor(canvas.value, accent.value, ink.value);
    warnings.push({
      code: 'contrast_adjusted',
      role: 'colors.accentSoft',
      message: `Adjusted colors.accentSoft to ${adjustedSoft} because the resolved ink/accent-soft pair did not meet ${MIN_TEXT_CONTRAST}:1 contrast.`,
      evidenceIds: sortedUnique([...canvas.evidenceIds, ...accent.evidenceIds]),
    });
    accentSoft = {
      value: adjustedSoft,
      evidenceIds: sortedUnique([...canvas.evidenceIds, ...accent.evidenceIds]),
      source: 'observed',
    };
  }

  return {
    theme: {
      colors: {
        canvas: canvas.value,
        ink: ink.value,
        muted: muted.value,
        accent: accent.value,
        accentSoft: accentSoft.value,
        border: border.value,
        data: data.value,
      },
      typography: {
        display: display.value,
        body: body.value,
        data: dataFont.value,
        titlePt: roundPointValue(titlePt.value),
        bodyPt: roundPointValue(bodyPt.value),
        dataPt: roundPointValue(dataPt.value),
      },
    },
    warnings,
  };
}

function resolveFromCandidates<T>(
  role: SignatureResolvedRole,
  semantic: readonly ValueCandidate<T>[],
  ooxml: readonly ValueCandidate<T>[],
  observed: readonly ValueCandidate<T>[],
  deck: ValueCandidate<T> | undefined,
  safe: ValueCandidate<T>,
  warnings: SignatureApplicationWarning[],
): ResolvedValue<T> {
  const semanticCandidate = [...semantic].sort(compareCandidate)[0];
  if (semanticCandidate) return resolvedCandidate(semanticCandidate, 'semantic');

  const ooxmlCandidate = [...ooxml].sort(compareCandidate)[0];
  if (ooxmlCandidate) {
    const resolved = resolvedCandidate(ooxmlCandidate, 'ooxml');
    warnings.push(
      fallbackWarning(
        'ooxml_role_fallback',
        role,
        `Resolved ${role} from OOXML role "${ooxmlCandidate.ooxmlRole ?? ooxmlCandidate.key}".`,
        resolved.evidenceIds,
      ),
    );
    return resolved;
  }

  const authoredCandidate = [...observed]
    .filter((candidate) => candidate.sourceRole === 'authored')
    .sort(compareCandidate)[0];
  if (authoredCandidate) {
    const resolved = resolvedCandidate(authoredCandidate, 'authored');
    const priorityDetail =
      authoredCandidate.authoredPriority === undefined
        ? ' using deterministic token order'
        : ` at declared priority ${authoredCandidate.authoredPriority + 1}`;
    warnings.push(
      fallbackWarning(
        'authored_token_fallback',
        role,
        `Resolved ${role} from authored token "${authoredCandidate.key}"${priorityDetail}; it was not assigned a semantic role.`,
        resolved.evidenceIds,
      ),
    );
    return resolved;
  }

  const observedCandidate = observed.find((candidate) => candidate.sourceRole !== 'authored');
  if (observedCandidate) {
    const resolved = resolvedCandidate(observedCandidate, 'observed');
    warnings.push(
      fallbackWarning(
        'observed_usage_fallback',
        role,
        `Inferred ${role} from observed token "${observedCandidate.key}"; it was not extracted as a semantic role.`,
        resolved.evidenceIds,
      ),
    );
    return resolved;
  }

  if (deck) {
    const resolved = resolvedCandidate(deck, 'deck');
    warnings.push(
      fallbackWarning(
        'deck_theme_fallback',
        role,
        `No usable profile evidence resolved ${role}; retained the current deck theme value.`,
        [],
      ),
    );
    return resolved;
  }

  const resolved = resolvedCandidate(safe, 'safe');
  warnings.push(
    fallbackWarning(
      'safe_default_fallback',
      role,
      `Neither profile evidence nor a valid deck value resolved ${role}; used the NodeSlide safe default.`,
      [],
    ),
  );
  return resolved;
}

function resolveDataColors(
  candidates: readonly ColorCandidate[],
  currentTheme: ThemeSpec | undefined,
  accent: ResolvedValue<string>,
  warnings: SignatureApplicationWarning[],
): ResolvedValue<string[]> {
  const semantic = uniqueColorCandidates(candidatesForSemantic(candidates, 'data')).slice(0, 6);
  if (semantic.length > 0) {
    return {
      value: semantic.map((candidate) => candidate.value),
      evidenceIds: sortedUnique(semantic.flatMap((candidate) => candidate.evidenceIds)),
      source: 'semantic',
    };
  }

  const ooxml = uniqueColorCandidates(
    candidates
      .filter((candidate) => /^accent[1-6]$/.test(candidate.ooxmlRole ?? ''))
      .sort(
        (left, right) =>
          Number((left.ooxmlRole ?? '').slice(-1)) - Number((right.ooxmlRole ?? '').slice(-1)) ||
          compareCandidate(left, right),
      ),
  ).slice(0, 6);
  if (ooxml.length > 0) {
    const evidenceIds = sortedUnique(ooxml.flatMap((candidate) => candidate.evidenceIds));
    warnings.push(
      fallbackWarning(
        'ooxml_role_fallback',
        'colors.data',
        'Resolved colors.data from the OOXML accent1..6 palette.',
        evidenceIds,
      ),
    );
    return { value: ooxml.map((candidate) => candidate.value), evidenceIds, source: 'ooxml' };
  }

  const authored = uniqueColorCandidates(
    candidates.filter((candidate) => candidate.sourceRole === 'authored').sort(compareCandidate),
  ).slice(0, 6);
  if (authored.length > 0) {
    const evidenceIds = sortedUnique(authored.flatMap((candidate) => candidate.evidenceIds));
    warnings.push(
      fallbackWarning(
        'authored_token_fallback',
        'colors.data',
        'Resolved colors.data from the authored palette in declared token priority; no semantic data palette was assigned.',
        evidenceIds,
      ),
    );
    return {
      value: authored.map((candidate) => candidate.value),
      evidenceIds,
      source: 'authored',
    };
  }

  const observed = uniqueColorCandidates(
    candidates.filter((candidate) => candidate.sourceRole !== 'authored').sort(compareCandidate),
  ).slice(0, 6);
  if (observed.length > 0) {
    const evidenceIds = sortedUnique(observed.flatMap((candidate) => candidate.evidenceIds));
    warnings.push(
      fallbackWarning(
        'observed_usage_fallback',
        'colors.data',
        'Inferred colors.data from the most-used observed palette; no semantic data palette was extracted.',
        evidenceIds,
      ),
    );
    return { value: observed.map((candidate) => candidate.value), evidenceIds, source: 'observed' };
  }

  const deckValues = sortedUnique(
    [currentTheme?.colors.accent, currentTheme?.colors.trace, currentTheme?.colors.insight]
      .map(canonicalHex)
      .filter((value): value is string => value !== undefined),
  );
  if (deckValues.length > 0) {
    warnings.push(
      fallbackWarning(
        'deck_theme_fallback',
        'colors.data',
        'No usable profile evidence resolved colors.data; retained the current deck palette.',
        [],
      ),
    );
    return { value: deckValues, evidenceIds: [], source: 'deck' };
  }

  warnings.push(
    fallbackWarning(
      'safe_default_fallback',
      'colors.data',
      'Neither profile evidence nor a valid deck palette resolved colors.data; used the NodeSlide safe palette.',
      [],
    ),
  );
  return {
    value: sortedUnique([accent.value, ...SAFE_THEME.colors.data]),
    evidenceIds: accent.evidenceIds,
    source: 'safe',
  };
}

function enforceTypeFloor(
  role: Extract<SignatureResolvedRole, `typography.${string}Pt`>,
  resolved: ResolvedValue<number>,
  warnings: SignatureApplicationWarning[],
): ResolvedValue<number> {
  if (resolved.value >= MIN_BRAND_TYPE_SIZE_PT) return resolved;
  warnings.push({
    code: 'type_scale_adjusted',
    role,
    message: `Raised ${role} from ${roundPointValue(resolved.value)}pt to the NodeSlide ${MIN_BRAND_TYPE_SIZE_PT}pt readability floor.`,
    evidenceIds: resolved.evidenceIds,
  });
  return { ...resolved, value: MIN_BRAND_TYPE_SIZE_PT };
}

function chooseContrastCandidate(
  background: string,
  candidates: readonly ColorCandidate[],
  currentTheme: ThemeSpec | undefined,
): ResolvedValue<string> {
  const deckInk = deckColorCandidate(currentTheme?.colors.ink, 'deck:ink');
  const choices: ValueCandidate<string>[] = [
    ...candidates,
    ...(deckInk ? [deckInk] : []),
    safeCandidate('#000000'),
    safeCandidate('#FFFFFF'),
  ];
  const best = choices.sort(
    (left, right) =>
      contrastRatio(right.value, background) - contrastRatio(left.value, background) ||
      compareCandidate(left, right),
  )[0];
  return best
    ? resolvedCandidate(best, best.key.startsWith('deck:') ? 'deck' : 'safe')
    : {
        value: '#000000',
        evidenceIds: [],
        source: 'safe',
      };
}

function contrastSafeSoftColor(canvas: string, accent: string, ink: string): string {
  for (const accentWeight of [0.5, 0.4, 0.3, 0.2, 0.1]) {
    const mixed = mixColors(canvas, accent, accentWeight);
    if (contrastRatio(ink, mixed) >= MIN_TEXT_CONTRAST) return mixed;
  }
  return canvas;
}

function collectColorCandidates(profile: SignatureProfile): ColorCandidate[] {
  const authoredPriority = authoredTokenPriority(profile, 'colors');
  const usage = new Map<string, { occurrences: number; evidenceIds: string[] }>();
  for (const item of [...profile.usage.colors].sort(
    (left, right) =>
      right.occurrences - left.occurrences ||
      compareText(canonicalHex(left.value) ?? left.value, canonicalHex(right.value) ?? right.value),
  )) {
    const value = canonicalHex(item.value);
    if (!value) continue;
    const previous = usage.get(value);
    usage.set(value, {
      occurrences: (previous?.occurrences ?? 0) + item.occurrences,
      evidenceIds: sortedUnique([...(previous?.evidenceIds ?? []), ...item.evidenceIds]),
    });
  }

  const candidates: ColorCandidate[] = [];
  const represented = new Set<string>();
  for (const [key, token] of Object.entries(profile.tokens.colors).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const value = token.$value.hex;
    represented.add(value);
    const extension = signatureExtension(token);
    const matchingUsage = usage.get(value);
    const semanticRole = semanticRoleForToken('color', key, token);
    const ooxmlRole = ooxmlRoleForToken('color', key, token, profile);
    candidates.push({
      key,
      value,
      evidenceIds: sortedUnique([
        ...(extension?.evidenceIds ?? []),
        ...(matchingUsage?.evidenceIds ?? []),
      ]),
      occurrences: Math.max(extension?.occurrences ?? 0, matchingUsage?.occurrences ?? 0),
      ...(semanticRole ? { semanticRole } : {}),
      ...(ooxmlRole ? { ooxmlRole } : {}),
      ...candidateSourceMetadata(extension, authoredPriority, key),
    });
  }
  for (const [value, item] of [...usage.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (represented.has(value)) continue;
    candidates.push({
      key: `usage:${value}`,
      value,
      evidenceIds: item.evidenceIds,
      occurrences: item.occurrences,
    });
  }
  return candidates.sort(compareCandidate);
}

function collectFontCandidates(profile: SignatureProfile): ValueCandidate<string>[] {
  const authoredPriority = authoredTokenPriority(profile, 'fontFamilies');
  const usage = new Map<string, { value: string; occurrences: number; evidenceIds: string[] }>();
  for (const item of [...profile.usage.fonts].sort(
    (left, right) =>
      right.occurrences - left.occurrences ||
      compareText(normalizeFontFamily(left.value), normalizeFontFamily(right.value)),
  )) {
    const normalized = normalizeFontFamily(item.value);
    const previous = usage.get(normalized);
    usage.set(normalized, {
      value: item.value.trim(),
      occurrences: (previous?.occurrences ?? 0) + item.occurrences,
      evidenceIds: sortedUnique([...(previous?.evidenceIds ?? []), ...item.evidenceIds]),
    });
  }

  const candidates: ValueCandidate<string>[] = [];
  const represented = new Set<string>();
  for (const [key, token] of Object.entries(profile.tokens.fontFamilies).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const value = fontFamilyCssValue(token);
    const normalized = normalizeFontFamily(value);
    represented.add(normalized);
    const extension = signatureExtension(token);
    const matchingUsage = usage.get(normalized);
    const semanticRole = semanticRoleForToken('font', key, token);
    const ooxmlRole = ooxmlRoleForToken('font', key, token, profile);
    candidates.push({
      key,
      value,
      evidenceIds: sortedUnique([
        ...(extension?.evidenceIds ?? []),
        ...(matchingUsage?.evidenceIds ?? []),
      ]),
      occurrences: Math.max(extension?.occurrences ?? 0, matchingUsage?.occurrences ?? 0),
      ...(semanticRole ? { semanticRole } : {}),
      ...(ooxmlRole ? { ooxmlRole } : {}),
      ...candidateSourceMetadata(extension, authoredPriority, key),
    });
  }
  for (const [normalized, item] of [...usage.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (represented.has(normalized)) continue;
    candidates.push({
      key: `usage:${normalized}`,
      value: item.value,
      evidenceIds: item.evidenceIds,
      occurrences: item.occurrences,
    });
  }
  return candidates.sort(compareCandidate);
}

function collectSizeCandidates(profile: SignatureProfile): ValueCandidate<number>[] {
  const authoredPriority = authoredTokenPriority(profile, 'fontSizes');
  const usage = new Map<string, { value: number; occurrences: number; evidenceIds: string[] }>();
  for (const item of [...profile.usage.fontSizes].sort(
    (left, right) => right.occurrences - left.occurrences || left.value - right.value,
  )) {
    const key = roundPointValue(item.value).toFixed(4);
    const previous = usage.get(key);
    usage.set(key, {
      value: roundPointValue(item.value),
      occurrences: (previous?.occurrences ?? 0) + item.occurrences,
      evidenceIds: sortedUnique([...(previous?.evidenceIds ?? []), ...item.evidenceIds]),
    });
  }

  const candidates: ValueCandidate<number>[] = [];
  const represented = new Set<string>();
  for (const [key, token] of Object.entries(profile.tokens.fontSizes).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const extension = signatureExtension(token);
    const value = roundPointValue(extension?.originalPoints ?? token.$value.value * (3 / 4));
    const usageKey = value.toFixed(4);
    represented.add(usageKey);
    const matchingUsage = usage.get(usageKey);
    const semanticRole = semanticRoleForToken('size', key, token);
    candidates.push({
      key,
      value,
      evidenceIds: sortedUnique([
        ...(extension?.evidenceIds ?? []),
        ...(matchingUsage?.evidenceIds ?? []),
      ]),
      occurrences: Math.max(extension?.occurrences ?? 0, matchingUsage?.occurrences ?? 0),
      ...(semanticRole ? { semanticRole } : {}),
      ...candidateSourceMetadata(extension, authoredPriority, key),
    });
  }
  for (const [key, item] of [...usage.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (represented.has(key)) continue;
    candidates.push({
      key: `usage:${key}pt`,
      value: item.value,
      evidenceIds: item.evidenceIds,
      occurrences: item.occurrences,
    });
  }
  return candidates.sort(compareCandidate);
}

function semanticRoleForToken(
  kind: 'color' | 'font' | 'size',
  key: string,
  token: SignatureColorToken | SignatureFontFamilyToken | SignatureDimensionToken,
): string | undefined {
  const extensionRole = tokenSemanticRole(token);
  if (extensionRole) return canonicalSemanticRole(kind, extensionRole);

  const normalized = normalizeIdentifier(key);
  if (kind === 'color' && /^(?:dk|lt)[12]$|^accent[1-6]$/.test(normalized)) return undefined;
  if (
    kind === 'font' &&
    ['majorlatin', 'minorlatin', 'majorfont', 'minorfont', 'major', 'minor'].includes(normalized)
  ) {
    return undefined;
  }
  return canonicalSemanticRole(kind, normalized);
}

function tokenSemanticRole(
  token: SignatureColorToken | SignatureFontFamilyToken | SignatureDimensionToken,
): string | undefined {
  const extensions: unknown = token.$extensions;
  if (!isRecord(extensions)) return undefined;
  const signature = extensions['com.nodeslide.signature'];
  if (isRecord(signature)) {
    for (const key of ['semanticRole', 'semantic', 'role', 'tokenRole']) {
      if (isNonemptyString(signature[key])) return signature[key];
    }
  }
  for (const extensionKey of ['com.nodeslide.semantic', 'org.designtokens.semantic']) {
    const semantic = extensions[extensionKey];
    if (isNonemptyString(semantic)) return semantic;
    if (isRecord(semantic)) {
      for (const key of ['semanticRole', 'role', 'value']) {
        if (isNonemptyString(semantic[key])) return semantic[key];
      }
    }
  }
  return undefined;
}

function canonicalSemanticRole(
  kind: 'color' | 'font' | 'size',
  rawRole: string,
): string | undefined {
  const role = normalizeIdentifier(rawRole)
    .replace(/^(?:semantic|theme|token)+/, '')
    .replace(/^(?:colors?|palette)/, '')
    .replace(/^(?:fontfamilies|fontfamily|fonts?)/, '')
    .replace(/^(?:fontsizes|fontsize|sizes?|type)/, '');
  if (kind === 'color') {
    if (['accentsoft', 'softaccent', 'brandsoft', 'accentbackground'].includes(role)) {
      return 'accentSoft';
    }
    if (
      [
        'canvas',
        'background',
        'backgroundprimary',
        'surface',
        'surfaceprimary',
        'brandcanvas',
      ].includes(role)
    ) {
      return 'canvas';
    }
    if (['ink', 'foreground', 'text', 'textprimary', 'primarytext', 'brandink'].includes(role)) {
      return 'ink';
    }
    if (['muted', 'textmuted', 'textsecondary', 'secondarytext', 'brandmuted'].includes(role)) {
      return 'muted';
    }
    if (['accent', 'brand', 'brandprimary', 'primaryaccent'].includes(role)) return 'accent';
    if (['border', 'borderdefault', 'outline', 'divider'].includes(role)) return 'border';
    if (
      /^(?:data|chart|series|dataviz)(?:color)?(?:neutral|positive|negative|comparison|caution|\d+)?$/.test(
        role,
      )
    ) {
      return 'data';
    }
    return undefined;
  }
  if (kind === 'font') {
    if (['display', 'headline', 'heading', 'title', 'typographydisplay'].includes(role)) {
      return 'display';
    }
    if (['body', 'copy', 'paragraph', 'text', 'typographybody'].includes(role)) return 'body';
    if (['data', 'mono', 'monospace', 'chart', 'label', 'typographydata'].includes(role)) {
      return 'data';
    }
    return undefined;
  }
  if (['titlept', 'title', 'display', 'headline', 'heading', 'typographytitle'].includes(role)) {
    return 'titlePt';
  }
  if (['bodypt', 'body', 'copy', 'paragraph', 'text', 'typographybody'].includes(role)) {
    return 'bodyPt';
  }
  if (['datapt', 'data', 'label', 'caption', 'mono', 'typographydata'].includes(role)) {
    return 'dataPt';
  }
  return undefined;
}

function ooxmlRoleForToken(
  kind: 'color' | 'font',
  key: string,
  token: SignatureColorToken | SignatureFontFamilyToken,
  profile: SignatureProfile,
): string | undefined {
  const roles =
    kind === 'color'
      ? [
          'lt1',
          'dk1',
          'lt2',
          'dk2',
          'accent1',
          'accent2',
          'accent3',
          'accent4',
          'accent5',
          'accent6',
        ]
      : ['majorlatin', 'minorlatin', 'majorfont', 'minorfont', 'major', 'minor'];
  const direct = knownRoleInText(key, roles);
  if (direct) return direct;

  const evidenceIds = signatureExtension(token)?.evidenceIds ?? [];
  const evidenceById = new Map(profile.evidence.map((item) => [item.id, item]));
  const evidenceText = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((left, right) => compareText(left.id, right.id))
    .map((item) => `${item.locator} ${item.observedValue}`)
    .join(' ');
  return knownRoleInText(`${token.$description ?? ''} ${evidenceText}`, roles);
}

function knownRoleInText(text: string, roles: readonly string[]): string | undefined {
  const parts = text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const collapsed = parts.join('');
  for (const role of roles) {
    if (parts.includes(role) || collapsed === role || collapsed.endsWith(role)) return role;
  }
  return undefined;
}

function candidatesForSemantic<T>(
  candidates: readonly ValueCandidate<T>[],
  role: string,
): ValueCandidate<T>[] {
  return candidates.filter((candidate) => candidate.semanticRole === role);
}

function candidatesForOoxml<T>(
  candidates: readonly ValueCandidate<T>[],
  roles: readonly string[],
): ValueCandidate<T>[] {
  const roleSet = new Set(roles);
  return candidates.filter(
    (candidate) => candidate.ooxmlRole !== undefined && roleSet.has(candidate.ooxmlRole),
  );
}

function compareCandidate<T>(left: ValueCandidate<T>, right: ValueCandidate<T>): number {
  const authoredPriority =
    left.sourceRole === 'authored' && right.sourceRole === 'authored'
      ? (left.authoredPriority ?? Number.MAX_SAFE_INTEGER) -
        (right.authoredPriority ?? Number.MAX_SAFE_INTEGER)
      : 0;
  return (
    authoredPriority ||
    right.occurrences - left.occurrences ||
    compareText(left.key, right.key) ||
    compareText(String(left.value), String(right.value))
  );
}

function uniqueColorCandidates(candidates: readonly ColorCandidate[]): ColorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.value)) return false;
    seen.add(candidate.value);
    return true;
  });
}

function resolvedCandidate<T>(
  candidate: ValueCandidate<T>,
  source: ResolvedValue<T>['source'],
): ResolvedValue<T> {
  return {
    value: candidate.value,
    evidenceIds: sortedUnique(candidate.evidenceIds),
    source,
  };
}

function safeCandidate<T>(value: T): ValueCandidate<T> {
  return { key: 'safe-default', value, evidenceIds: [], occurrences: 0 };
}

function deckColorCandidate(
  value: string | undefined,
  key: string,
): ValueCandidate<string> | undefined {
  const canonical = canonicalHex(value);
  return canonical ? { key, value: canonical, evidenceIds: [], occurrences: 0 } : undefined;
}

function deckFontCandidate(
  value: string | undefined,
  key: string,
): ValueCandidate<string> | undefined {
  return value?.trim() ? { key, value: value.trim(), evidenceIds: [], occurrences: 0 } : undefined;
}

function fallbackWarning(
  code: SignatureApplicationWarningCode,
  role: SignatureResolvedRole,
  message: string,
  evidenceIds: readonly string[],
): SignatureApplicationWarning {
  const sortedEvidence = sortedUnique(evidenceIds);
  return {
    code,
    role,
    message: `${message}${
      sortedEvidence.length > 0
        ? ` Evidence: ${sortedEvidence.map((id) => `"${id}"`).join(', ')}.`
        : ' Evidence: none.'
    }`,
    evidenceIds: sortedEvidence,
  };
}

function expectedElementStyle(
  element: SlideElement,
  theme: ResolvedSignatureTheme,
  currentTheme: ThemeSpec,
): Partial<ElementStyle> {
  const expected: Partial<ElementStyle> = {};
  const role = normalizeRole(element.role);
  const readableAccent =
    contrastRatio(theme.colors.accent, theme.colors.canvas) >= MIN_TEXT_CONTRAST
      ? theme.colors.accent
      : theme.colors.ink;

  if (element.kind === 'chart') {
    expected.fill = theme.colors.accentSoft;
    expected.stroke = theme.colors.border;
    expected.strokeWidth = 1;
    expected.color = theme.colors.ink;
    expected.fontFamily = theme.typography.data;
    expected.fontSize = theme.typography.dataPt;
    return expected;
  }

  if (element.kind === 'math') {
    expected.fill = theme.colors.accentSoft;
    expected.stroke = theme.colors.border;
    expected.strokeWidth = 1;
    expected.color = theme.colors.ink;
    expected.fontFamily = theme.typography.data;
    expected.fontSize = nearestPointSize(
      element.style.fontSize,
      [theme.typography.titlePt, theme.typography.bodyPt],
      theme.typography.titlePt,
    );
    return expected;
  }

  if (element.kind === 'text') {
    if (isTitleRole(role)) {
      expected.color = theme.colors.ink;
      expected.fontFamily = theme.typography.display;
      expected.fontSize = theme.typography.titlePt;
    } else if (isMetricRole(role)) {
      expected.fill = theme.colors.accentSoft;
      expected.color = theme.colors.ink;
      expected.fontFamily = theme.typography.data;
      expected.fontSize = nearestPointSize(
        element.style.fontSize,
        [theme.typography.titlePt, theme.typography.bodyPt],
        theme.typography.titlePt,
      );
    } else if (isDataLabelRole(role)) {
      expected.color = isAccentLabelRole(role) ? readableAccent : theme.colors.ink;
      expected.fontFamily = theme.typography.data;
      expected.fontSize = theme.typography.dataPt;
    } else if (isBodyRole(role)) {
      expected.color = isMutedTextRole(role) ? theme.colors.muted : theme.colors.ink;
      expected.fontFamily = theme.typography.body;
      expected.fontSize = nearestPointSize(
        element.style.fontSize,
        [theme.typography.bodyPt, theme.typography.dataPt],
        theme.typography.bodyPt,
      );
    } else {
      expected.fontFamily = theme.typography.body;
      const mappedColor = mappedThemeColor(element.style.color, currentTheme, theme);
      if (mappedColor) expected.color = mappedColor;
    }

    if (element.style.fill !== undefined && expected.fill === undefined) {
      const mappedFill = mappedThemeColor(element.style.fill, currentTheme, theme);
      if (mappedFill) expected.fill = mappedFill;
    }
    if (element.style.stroke !== undefined) expected.stroke = theme.colors.border;
    return expected;
  }

  if (element.kind === 'shape') {
    if (isSoftShapeRole(role)) {
      expected.fill = theme.colors.accentSoft;
    } else if (isAccentShapeRole(role)) {
      expected.fill = accentShapeFill(element, role, currentTheme, theme);
    } else if (isCanvasShapeRole(role)) {
      expected.fill = theme.colors.canvas;
    } else if (isContainerShapeRole(role)) {
      expected.fill = theme.colors.accentSoft;
      expected.stroke = theme.colors.border;
      expected.strokeWidth = 1;
    } else if (isBorderShapeRole(role)) {
      expected.stroke = theme.colors.border;
      if (element.style.fill !== undefined) expected.fill = theme.colors.border;
    }

    if (element.style.stroke !== undefined && expected.stroke === undefined) {
      expected.stroke = theme.colors.border;
    }
    if (element.content?.trim()) {
      expected.fontFamily = theme.typography.body;
      if (element.style.fontSize !== undefined) {
        expected.fontSize = nearestPointSize(
          element.style.fontSize,
          [theme.typography.bodyPt, theme.typography.dataPt],
          theme.typography.bodyPt,
        );
      }
      if (isContainerShapeRole(role)) expected.color = theme.colors.ink;
      else {
        const mappedColor = mappedThemeColor(element.style.color, currentTheme, theme);
        if (mappedColor) expected.color = mappedColor;
      }
    }
    return expected;
  }

  if (element.kind === 'connector') {
    if (element.style.stroke !== undefined) {
      expected.stroke = isAccentShapeRole(role) ? theme.colors.accent : theme.colors.border;
    }
    if (element.style.color !== undefined) {
      expected.color = isAccentShapeRole(role) ? theme.colors.accent : theme.colors.border;
    }
    return expected;
  }

  if (element.kind === 'image' || element.kind === 'video') {
    if (element.style.stroke !== undefined) expected.stroke = theme.colors.border;
    if (element.style.color !== undefined) {
      const mappedColor = mappedThemeColor(element.style.color, currentTheme, theme);
      if (mappedColor) expected.color = mappedColor;
    }
    if (element.style.fill !== undefined) {
      const mappedFill = mappedThemeColor(element.style.fill, currentTheme, theme);
      if (mappedFill) expected.fill = mappedFill;
    }
  }
  return expected;
}

function styleDelta(actual: ElementStyle, expected: Partial<ElementStyle>): Partial<ElementStyle> {
  const entries: Array<[keyof ElementStyle, ElementStyle[keyof ElementStyle]]> = [];
  for (const key of STYLE_PROPERTY_ORDER) {
    const expectedValue = expected[key];
    if (expectedValue === undefined || styleValuesEqual(key, actual[key], expectedValue)) continue;
    entries.push([key, expectedValue]);
  }
  return Object.fromEntries(entries) as Partial<ElementStyle>;
}

function styleValuesEqual(
  key: keyof ElementStyle,
  actual: ElementStyle[keyof ElementStyle],
  expected: ElementStyle[keyof ElementStyle],
): boolean {
  if (key === 'fill' || key === 'stroke' || key === 'color') {
    return colorsEqual(actual, expected);
  }
  if (key === 'fontFamily') {
    return (
      typeof actual === 'string' &&
      typeof expected === 'string' &&
      normalizeFontFamilyStack(actual) === normalizeFontFamilyStack(expected)
    );
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) <= 0.0001;
  }
  return actual === expected;
}

function mappedThemeColor(
  value: string | undefined,
  currentTheme: ThemeSpec,
  resolved: ResolvedSignatureTheme,
): string | undefined {
  const color = canonicalHex(value);
  if (!color) return undefined;
  const resolvedColors = [
    resolved.colors.canvas,
    resolved.colors.ink,
    resolved.colors.muted,
    resolved.colors.accent,
    resolved.colors.accentSoft,
    resolved.colors.border,
    ...resolved.colors.data,
  ];
  if (resolvedColors.includes(color)) return color;

  const current = currentTheme.colors;
  if (colorsEqual(color, current.canvas)) return resolved.colors.canvas;
  if (colorsEqual(color, current.ink) || colorsEqual(color, current.insightInk)) {
    return resolved.colors.ink;
  }
  if (colorsEqual(color, current.muted)) return resolved.colors.muted;
  if (colorsEqual(color, current.accent)) return resolved.colors.accent;
  if (colorsEqual(color, current.accentSoft) || colorsEqual(color, current.insight)) {
    return resolved.colors.accentSoft;
  }
  if (colorsEqual(color, current.border)) return resolved.colors.border;
  if (colorsEqual(color, current.trace)) return resolved.colors.data[1] ?? resolved.colors.accent;
  return undefined;
}

function addElementBrandIssues(
  collector: ReturnType<typeof createIssueCollector>,
  slide: Slide,
  element: SlideElement,
  expected: Partial<ElementStyle>,
  warnings: readonly SignatureApplicationWarning[],
): void {
  const mismatches = new Map<ValidationIssue['code'], string[]>();
  for (const key of STYLE_PROPERTY_ORDER) {
    const expectedValue = expected[key];
    if (expectedValue === undefined || styleValuesEqual(key, element.style[key], expectedValue)) {
      continue;
    }
    const code = brandCodeForStyleProperty(key);
    const details = mismatches.get(code) ?? [];
    details.push(
      `${key}=${displayValue(element.style[key])} (expected ${displayValue(expectedValue)})`,
    );
    mismatches.set(code, details);
  }

  for (const code of ON_BRAND_CODE_ORDER) {
    const details = mismatches.get(code);
    if (!details || details.length === 0) continue;
    collector.add({
      severity: 'warning',
      code,
      message: `Element "${element.id}" is off-brand: ${details.join('; ')}.${warningSuffix(
        warnings,
        code,
      )}`,
      slideId: slide.id,
      elementId: element.id,
    });
  }
}

function brandCodeForStyleProperty(key: keyof ElementStyle): ValidationIssue['code'] {
  if (key === 'fontFamily') return 'on_brand_font';
  if (key === 'fontSize') return 'on_brand_type_scale';
  return 'on_brand_color';
}

function warningSuffix(
  warnings: readonly SignatureApplicationWarning[],
  code: ValidationIssue['code'],
): string {
  const relevant = warnings.filter((warning) => {
    if (code === 'on_brand_font') {
      return warning.role.startsWith('typography.') && !warning.role.endsWith('Pt');
    }
    if (code === 'on_brand_type_scale') return warning.role.endsWith('Pt');
    return warning.role.startsWith('colors.');
  });
  if (relevant.length === 0) return '';
  const shown = relevant
    .slice(0, 4)
    .map((warning) => boundedText(warning.message, 220))
    .join(' ');
  const remaining = relevant.length - Math.min(relevant.length, 4);
  return ` Resolution warning${relevant.length === 1 ? '' : 's'}: ${shown}${
    remaining > 0 ? ` (${remaining} more documented fallback warnings.)` : ''
  }`;
}

function lockedSummary(slideId: string, elementIds: readonly string[]): string {
  const shown = elementIds.slice(0, 8).map((id) => `"${boundedText(id, 80)}"`);
  const remaining = elementIds.length - shown.length;
  return `Skipped ${elementIds.length} locked element${
    elementIds.length === 1 ? '' : 's'
  } on slide "${slideId}": ${shown.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}.`;
}

function createIssueCollector(limit: number): {
  add: (issue: IssueDraft) => void;
  finish: () => IssueDraft[];
} {
  const retained: IssueDraft[] = [];
  let total = 0;
  return {
    add(issue) {
      total += 1;
      if (retained.length < limit) retained.push(issue);
    },
    finish() {
      if (total <= limit) return retained;
      const summary: IssueDraft = {
        severity: 'info',
        code: 'scope',
        message: `${total - Math.max(0, limit - 1)} additional on-brand issues were omitted by the deterministic ${limit}-issue bound.`,
      };
      return limit === 1 ? [summary] : [...retained.slice(0, limit - 1), summary];
    },
  };
}

function clocksForOperations(
  snapshot: DeckSnapshot,
  operations: readonly PatchOperation[],
): { baseSlideVersions: Record<string, number>; baseElementVersions: Record<string, number> } {
  const touchedSlides = new Set<string>();
  const touchedElements = new Set<string>();
  for (const operation of operations) {
    if (operation.op === 'update_slide') touchedSlides.add(operation.slideId);
    if (operation.op === 'update_style') {
      touchedSlides.add(operation.slideId);
      touchedElements.add(operation.elementId);
    }
  }

  const baseSlideVersions: Record<string, number> = {};
  const baseElementVersions: Record<string, number> = {};
  for (const slide of orderedSlides(snapshot)) {
    if (!touchedSlides.has(slide.id)) continue;
    baseSlideVersions[slide.id] = slide.version;
    for (const element of orderedElements(snapshot, slide)) {
      if (touchedElements.has(element.id)) baseElementVersions[element.id] = element.version;
    }
  }
  return { baseSlideVersions, baseElementVersions };
}

function orderedSlides(snapshot: DeckSnapshot): Slide[] {
  const byId = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  return snapshot.deck.slideOrder.flatMap((slideId) => {
    const slide = byId.get(slideId);
    return slide ? [slide] : [];
  });
}

function orderedElements(snapshot: DeckSnapshot, slide: Slide): SlideElement[] {
  const byId = new Map(
    snapshot.elements
      .filter((element) => element.slideId === slide.id)
      .map((element) => [element.id, element]),
  );
  return slide.elementOrder.flatMap((elementId) => {
    const element = byId.get(elementId);
    return element ? [element] : [];
  });
}

function elementIsSelected(selection: ScopeSelection, element: SlideElement): boolean {
  return selection.elementIds === null || selection.elementIds.has(element.id);
}

function preparePatchScope(
  value: unknown,
): { scope: PatchScope } | { error: SignatureApplicationError } {
  if (!isRecord(value)) return { error: scopeError('Patch scope must be an object.') };
  if (!isNonemptyString(value['deckId'])) {
    return { error: scopeError('Patch scope deckId must be non-empty.') };
  }
  if (!['copy', 'style', 'layout', 'unrestricted'].includes(String(value['operationMode']))) {
    return { error: scopeError('Patch scope operationMode is unsupported.') };
  }
  const kind = value['kind'];
  const deckId = value['deckId'];
  const operationMode = value['operationMode'] as PatchScope['operationMode'];
  if (kind === 'deck') return { scope: { kind, deckId, operationMode } };

  const slideIds = stringArray(value['slideIds']);
  if (!slideIds) return { error: scopeError('Patch scope slideIds must be a string array.') };
  if (kind === 'slide') return { scope: { kind, deckId, slideIds, operationMode } };

  const elementIds = stringArray(value['elementIds']);
  if (!elementIds) return { error: scopeError('Patch scope elementIds must be a string array.') };
  if (kind === 'elements') {
    return { scope: { kind, deckId, slideIds, elementIds, operationMode } };
  }
  if (kind === 'comment') {
    if (!isNonemptyString(value['commentId'])) {
      return { error: scopeError('Comment scope commentId must be non-empty.') };
    }
    return {
      scope: {
        kind,
        deckId,
        slideIds,
        elementIds,
        commentId: value['commentId'],
        operationMode,
      },
    };
  }
  if (kind === 'bounding_box') {
    const bbox = value['bbox'];
    if (
      !isRecord(bbox) ||
      !isFiniteNumber(bbox['x']) ||
      !isFiniteNumber(bbox['y']) ||
      !isFiniteNumber(bbox['width']) ||
      !isFiniteNumber(bbox['height'])
    ) {
      return { error: scopeError('Bounding-box scope bbox must contain finite coordinates.') };
    }
    return {
      scope: {
        kind,
        deckId,
        slideIds,
        elementIds,
        bbox: {
          x: bbox['x'],
          y: bbox['y'],
          width: bbox['width'],
          height: bbox['height'],
        },
        operationMode,
      },
    };
  }
  return { error: scopeError(`Unsupported patch scope kind "${String(kind)}".`) };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value]
    : undefined;
}

function normalizeRole(role: string | undefined): string {
  return (role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function roleMatches(role: string, values: readonly string[]): boolean {
  return values.some(
    (value) => role === value || role.startsWith(`${value}_`) || role.endsWith(`_${value}`),
  );
}

function isTitleRole(role: string): boolean {
  return roleMatches(role, ['title', 'headline', 'display', 'heading', 'hero']);
}

function isMetricRole(role: string): boolean {
  return roleMatches(role, ['metric', 'stat', 'kpi', 'number']);
}

function isDataLabelRole(role: string): boolean {
  return roleMatches(role, [
    'data',
    'chart_label',
    'axis',
    'legend',
    'label',
    'section',
    'page_number',
    'eyebrow',
  ]);
}

function isAccentLabelRole(role: string): boolean {
  return roleMatches(role, ['section', 'page_number', 'eyebrow']);
}

function isBodyRole(role: string): boolean {
  return roleMatches(role, [
    'body',
    'paragraph',
    'copy',
    'bullet',
    'caption',
    'footer',
    'subtitle',
  ]);
}

function isMutedTextRole(role: string): boolean {
  return roleMatches(role, ['body', 'caption', 'footer', 'subtitle']);
}

function isAccentShapeRole(role: string): boolean {
  return roleMatches(role, ['accent', 'decoration', 'decorative', 'rail', 'brand']);
}

function isSoftShapeRole(role: string): boolean {
  return roleMatches(role, ['accent_soft', 'soft_accent', 'soft', 'tint']);
}

function accentShapeFill(
  element: SlideElement,
  role: string,
  currentTheme: ThemeSpec,
  resolvedTheme: ResolvedSignatureTheme,
): string {
  if (!roleMatches(role, ['decoration', 'decorative'])) return resolvedTheme.colors.accent;
  const fill = canonicalHex(element.style.fill);
  const canvas = canonicalHex(currentTheme.colors.canvas);
  if (!fill || !canvas) return resolvedTheme.colors.accent;
  if (
    colorsEqual(fill, currentTheme.colors.accentSoft) ||
    colorsEqual(fill, currentTheme.colors.insight) ||
    Math.abs(relativeLuminance(fill) - relativeLuminance(canvas)) <= 0.18
  ) {
    return resolvedTheme.colors.accentSoft;
  }
  return resolvedTheme.colors.accent;
}

function isCanvasShapeRole(role: string): boolean {
  return roleMatches(role, ['background', 'canvas', 'backdrop']);
}

function isContainerShapeRole(role: string): boolean {
  return roleMatches(role, [
    'card',
    'panel',
    'surface',
    'container',
    'evidence',
    'callout',
    'highlight',
    'badge',
  ]);
}

function isBorderShapeRole(role: string): boolean {
  return roleMatches(role, ['border', 'divider', 'rule', 'separator', 'outline']);
}

function nearestPointSize(
  current: number | undefined,
  candidates: readonly number[],
  fallback: number,
): number {
  const eligible = sortedUniqueNumbers(
    candidates.filter(
      (candidate) => Number.isFinite(candidate) && candidate >= MIN_BRAND_TYPE_SIZE_PT,
    ),
  );
  if (eligible.length === 0) return Math.max(MIN_BRAND_TYPE_SIZE_PT, fallback);
  if (!Number.isFinite(current))
    return eligible.includes(fallback) ? fallback : (eligible[0] ?? fallback);
  return (
    [...eligible].sort(
      (left, right) =>
        Math.abs(left - (current ?? fallback)) - Math.abs(right - (current ?? fallback)) ||
        left - right,
    )[0] ?? fallback
  );
}

function applicationErrorIssue(error: SignatureApplicationError): IssueDraft {
  return {
    severity: error.code === 'already_applied' ? 'info' : 'error',
    code: error.code === 'scope' ? 'scope' : 'schema',
    message: `Signature application ${error.code}: ${error.message}`,
  };
}

function schemaError(path: string, detail: string): SignatureApplicationError {
  return {
    code: 'schema',
    message: `Malformed signature application input at ${path}: ${detail}.`,
    path,
  };
}

function scopeError(message: string): SignatureApplicationError {
  return { code: 'scope', message };
}

function signatureExtension(
  token: SignatureColorToken | SignatureFontFamilyToken | SignatureDimensionToken,
): SignatureTokenEvidenceExtension | undefined {
  return token.$extensions['com.nodeslide.signature'];
}

function candidateSourceMetadata(
  extension: SignatureTokenEvidenceExtension | undefined,
  authoredPriority: ReadonlyMap<string, number>,
  key: string,
): {
  sourceRole?: SignatureTokenEvidenceExtension['sourceRole'];
  authoredPriority?: number;
} {
  if (!extension) return {};
  const priority = extension.sourceRole === 'authored' ? authoredPriority.get(key) : undefined;
  return {
    sourceRole: extension.sourceRole,
    ...(priority === undefined ? {} : { authoredPriority: priority }),
  };
}

function authoredTokenPriority(
  profile: SignatureProfile,
  category: 'colors' | 'fontFamilies' | 'fontSizes',
): ReadonlyMap<string, number> {
  const profileValue: unknown = profile;
  if (!isRecord(profileValue)) return new Map();
  const extensions = profileValue['$extensions'];
  if (!isRecord(extensions)) return new Map();
  const tastePack = extensions['com.nodeslide.tastePack'];
  if (!isRecord(tastePack)) return new Map();
  const priority = tastePack['authoredTokenPriority'];
  if (!isRecord(priority)) return new Map();
  const keys = priority[category];
  if (!Array.isArray(keys) || keys.length > PROFILE_TOKEN_LIMIT) return new Map();

  const positions = new Map<string, number>();
  for (const [index, key] of keys.entries()) {
    if (isNonemptyString(key) && !positions.has(key)) positions.set(key, index);
  }
  return positions;
}

function fontFamilyCssValue(token: SignatureFontFamilyToken): string {
  if (typeof token.$value === 'string') return token.$value.trim();
  return token.$value.map(cssFontFamilyName).join(', ');
}

function cssFontFamilyName(value: string): string {
  const family = value.trim();
  const normalized = family.toLowerCase();
  if (CSS_GENERIC_FONT_FAMILIES.has(normalized)) return normalized;
  if (/^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(family)) return family;
  return JSON.stringify(family) ?? '""';
}

function colorsEqual(left: unknown, right: unknown): boolean {
  const leftColor = canonicalHex(left);
  const rightColor = canonicalHex(right);
  return leftColor !== undefined && rightColor !== undefined && leftColor === rightColor;
}

function canonicalHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (short) {
    const red = short[1] ?? '0';
    const green = short[2] ?? '0';
    const blue = short[3] ?? '0';
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

function rgbComponentsToHex(components: readonly number[]): string {
  return `#${components
    .map((component) =>
      Math.round(component * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

function parseRgb(value: string): [number, number, number] {
  const hex = canonicalHex(value) ?? '#000000';
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance(value: string): number {
  const [red, green, blue] = parseRgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorChroma(value: string): number {
  const channels = parseRgb(value);
  return Math.max(...channels) - Math.min(...channels);
}

function colorDistance(left: string, right: string): number {
  const leftRgb = parseRgb(left);
  const rightRgb = parseRgb(right);
  return Math.sqrt(
    leftRgb.reduce((sum, channel, index) => {
      const difference = channel - (rightRgb[index] ?? 0);
      return sum + difference * difference;
    }, 0),
  );
}

function mixColors(base: string, mixed: string, mixedWeight: number): string {
  const baseRgb = parseRgb(base);
  const mixedRgb = parseRgb(mixed);
  const components = baseRgb.map(
    (channel, index) =>
      (channel * (1 - mixedWeight) + (mixedRgb[index] ?? channel) * mixedWeight) / 255,
  );
  return rgbComponentsToHex(components);
}

function normalizeFontFamily(value: string): string {
  const firstFamily = splitCssFontFamilies(value)[0] ?? value;
  return firstFamily
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitCssFontFamilies(value).map(normalizeFontFamily).filter(Boolean).join(',');
}

function splitCssFontFamilies(value: string): string[] {
  const families: string[] = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== undefined) {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) quote = undefined;
      else if (quote === undefined) quote = character;
      continue;
    }
    if (character === ',' && quote === undefined) {
      families.push(value.slice(start, index));
      start = index + 1;
    }
  }
  families.push(value.slice(start));
  return families.map((family) => family.trim()).filter(Boolean);
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function roundPointValue(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function boundedIssueLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return NODESLIDE_ON_BRAND_ISSUE_LIMIT;
  return Math.min(
    NODESLIDE_ON_BRAND_ISSUE_LIMIT,
    Math.max(1, Math.floor(value ?? NODESLIDE_ON_BRAND_ISSUE_LIMIT)),
  );
}

function displayValue(value: unknown): string {
  if (value === undefined) return '<unset>';
  if (typeof value === 'string') return `"${boundedText(value, 120)}"`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '<invalid>';
  return boundedText(String(value), 120);
}

function boundedText(value: string, limit: number): string {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function sortedUniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
