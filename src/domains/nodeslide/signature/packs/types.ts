import type { SignatureDensity, SignatureProfile } from '../../../../../shared/nodeslideSignature';

export const NODESLIDE_RULES_EXTENSION_KEY = 'com.nodeslide.rules' as const;
export const NODESLIDE_TASTE_PACK_EXTENSION_KEY = 'com.nodeslide.tastePack' as const;

export type NodeSlideTastePackId = 'finance-ibcs' | 'startup-narrative';

export interface NodeSlideRuleCitation {
  title: string;
  url: `https://${string}`;
  supports: string;
  license: string;
}

export interface NodeSlideTastePackRule {
  id: string;
  title: string;
  behavior: string;
  citations: [NodeSlideRuleCitation, ...NodeSlideRuleCitation[]];
}

export interface NodeSlideNonAffiliationMetadata {
  independent: true;
  statement: string;
  organizations: string[];
  prohibitedClaims: string[];
}

export interface NodeSlideRulesExtension {
  rules: NodeSlideTastePackRule[];
  nonAffiliation: NodeSlideNonAffiliationMetadata;
}

export interface NodeSlideContrastPair {
  foreground: string;
  background: string;
  minimumRatio: 3 | 4.5;
  usage: 'text' | 'large_text' | 'non_text';
}

export interface NodeSlideSafeAreaInches {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NodeSlideAuthoredLayoutTargets {
  minimumNonFooterFontPoints: number;
  maximumFocalAccents?: number;
  maximumSmallMultiples?: number;
  maximumForegroundElements?: number;
  maximumFocalVisuals?: number;
  maximumSupportingGroups?: number;
  minimumWhitespaceFraction?: number;
}

export interface NodeSlideAuthoredLayoutIntent {
  sourceRole: 'authored';
  evidenceIds: string[];
  observedDeckFacts: false;
  intendedDensity: Exclude<SignatureDensity, 'unknown'>;
  safeAreaInches?: NodeSlideSafeAreaInches;
  targets: NodeSlideAuthoredLayoutTargets;
  guardrails: string[];
  neutralProfileFields: string[];
}

export interface NodeSlideAuthorshipMetadata {
  method: 'authored';
  confidence: 1;
  sourceDerived: false;
  confidenceMeaning: string;
}

export interface NodeSlideFontPolicy {
  networkFetch: false;
  embedsFonts: false;
  requiresGenericFallback: true;
}

export interface NodeSlideAuthoredTokenPriority {
  colors: string[];
  fontFamilies: string[];
  fontSizes: string[];
}

export interface NodeSlideTastePackMetadataExtension {
  id: NodeSlideTastePackId;
  authorship: NodeSlideAuthorshipMetadata;
  fontPolicy: NodeSlideFontPolicy;
  authoredTokenPriority: NodeSlideAuthoredTokenPriority;
  layout: NodeSlideAuthoredLayoutIntent;
  approvedContrastPairs: NodeSlideContrastPair[];
}

/**
 * W5's local structural superset. Assigning this value to SignatureProfile intentionally
 * drops no W1 fields; consumers that do not know W5 can ignore the profile-level extensions.
 */
export interface NodeSlideTastePack extends SignatureProfile {
  $extensions: {
    'com.nodeslide.rules': NodeSlideRulesExtension;
    'com.nodeslide.tastePack': NodeSlideTastePackMetadataExtension;
  };
}

export interface NodeSlideTastePackValidationResult {
  ok: boolean;
  errors: string[];
}
