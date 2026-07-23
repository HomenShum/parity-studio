/**
 * Claim proof — turning a marketing paragraph into something that can fail.
 *
 * A post about a product makes several claims at once, and they are not the same KIND of claim.
 * "A coding agent built this deck" can be demonstrated by one recording. "References improve visual
 * quality" cannot — that needs a controlled comparison. "Positioned for the YC S26 batch" is not a
 * technical claim at all and no amount of evidence makes it one.
 *
 * The failure this exists to prevent is a single successful demo standing in for all of them. One
 * green deck, and the reader infers the benchmark ran, the consumer install works, and the cohort
 * endorsed it. So proof CLASS is part of the claim, the evidence each class demands is different,
 * and the verdicts are deliberately not interchangeable.
 *
 * Two rules do the load-bearing work:
 *   - A `positioning` claim can never reach a proof verdict. Not "should not" — the evaluator has
 *     no code path that returns one, and a manifest that marks positioning `required` is invalid.
 *   - Absent evidence is `not-run`, never `passed`. A claim nobody measured and a claim that
 *     succeeded must not read the same in a summary, because that is exactly how a check that
 *     stopped running gets mistaken for a check that passed.
 */

export const NODESLIDE_CLAIM_PROOF_VERSION = 'nodeslide.claim-proof/v1' as const;

/**
 * How a claim can be established. The class dictates which evidence is admissible, so a claim
 * cannot be quietly promoted by attaching the wrong kind of proof.
 */
export type ClaimProofClass =
  /** One reproducible session demonstrates it end to end. */
  | 'live'
  /** Needs a controlled A/B across harness versions — a single run cannot show it. */
  | 'benchmark'
  /** Decided by inspecting the produced file, independent of how it was produced. */
  | 'artifact'
  /** Needs coverage across audiences; one persona proves only that persona. */
  | 'scenario'
  /** A fresh outside repository must install and run it without repo-local shortcuts. */
  | 'consumer'
  /** Market framing. Not a technical claim, and never presentable as one. */
  | 'positioning';

export const CLAIM_PROOF_CLASSES: readonly ClaimProofClass[] = Object.freeze([
  'live',
  'benchmark',
  'artifact',
  'scenario',
  'consumer',
  'positioning',
]);

/**
 * Verdicts. `passed` is deliberately narrow; everything else names WHY it is not a pass, because
 * "not passed" collapses a benchmark that has not been run, a scenario half-covered, and a feature
 * that is genuinely broken into one indistinguishable bucket.
 */
export type ClaimVerdict =
  | 'passed'
  | 'failed'
  /** Some required scenarios covered, others not. Honest middle state, not a soft pass. */
  | 'partially-proven'
  /** True, but on the strength of a separate benchmark receipt rather than this run. */
  | 'supported-by-separate-benchmark'
  /** Being built. Claimed nowhere as working. */
  | 'in-progress'
  /** No evidence was supplied. The default, and never upgraded by silence. */
  | 'not-run'
  /** Terminal state for market framing. Carries no technical weight by construction. */
  | 'positioning-only';

/** Verdicts that may be presented as the claim being true of the product. */
const PROOF_VERDICTS: readonly ClaimVerdict[] = Object.freeze([
  'passed',
  'supported-by-separate-benchmark',
]);

export function isProofVerdict(verdict: ClaimVerdict): boolean {
  return PROOF_VERDICTS.includes(verdict);
}

/** Numeric definition of "mostly autonomous". Without one the phrase is unfalsifiable. */
export interface AutonomyBudget {
  /** Steering messages a human may send: brief, one correction, acceptance. */
  maxHumanSteeringMessages: number;
  /** Any hand-edit of a file means the agent did not do it. */
  maxManualFileEdits: number;
  /** Any hand-edit of a slide means the deck was not agent-authored. */
  maxManualSlideEdits: number;
}

export const DEFAULT_AUTONOMY_BUDGET: AutonomyBudget = Object.freeze({
  maxHumanSteeringMessages: 3,
  maxManualFileEdits: 0,
  maxManualSlideEdits: 0,
});

export interface AutonomyMeasurement {
  humanMessages: number;
  agentToolCalls: number;
  agentAuthoredOperations: number;
  manualFileEdits: number;
  manualSlideEdits: number;
}

/**
 * Whether a run was mostly autonomous.
 *
 * Tool-call count is deliberately NOT part of the test. A run with 200 tool calls that a human had
 * to rescue twice is less autonomous than one with 20 that nobody touched; counting calls measures
 * how chatty the harness is, not who did the work.
 */
export function evaluateAutonomy(
  measured: AutonomyMeasurement,
  budget: AutonomyBudget = DEFAULT_AUTONOMY_BUDGET,
): { withinBudget: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (measured.humanMessages > budget.maxHumanSteeringMessages) {
    reasons.push(
      `${measured.humanMessages} human steering messages exceeds the budget of ${budget.maxHumanSteeringMessages}.`,
    );
  }
  if (measured.manualFileEdits > budget.maxManualFileEdits) {
    reasons.push(
      `${measured.manualFileEdits} manual file edit(s): the agent did not author that work.`,
    );
  }
  if (measured.manualSlideEdits > budget.maxManualSlideEdits) {
    reasons.push(
      `${measured.manualSlideEdits} manual slide edit(s): the deck is not agent-authored.`,
    );
  }
  if (measured.agentAuthoredOperations <= 0) {
    reasons.push('no agent-authored operations were recorded, so nothing was demonstrated.');
  }
  return { withinBudget: reasons.length === 0, reasons };
}

export interface ClaimDefinition {
  id: string;
  /** The sentence from the post, verbatim, so drift between claim and copy is visible. */
  statement: string;
  proof: ClaimProofClass;
  /** A required claim failing fails the whole set. Positioning claims may never be required. */
  required: boolean;
  /** Evidence kinds that must all be present for this claim to be decidable. */
  requiredEvidence: readonly string[];
}

export interface ClaimEvidence {
  claimId: string;
  /** Evidence kinds actually supplied, e.g. 'playwright-trace', 'agent-transcript'. */
  present: readonly string[];
  /** Whether the supplied evidence shows the claim holding. */
  holds: boolean;
  /** Free-text detail carried into the report so a verdict is never bare. */
  detail?: string;
  /** For scenario claims: which audiences were actually covered. */
  scenariosCovered?: readonly string[];
  /** For benchmark claims: a receipt id from a separate controlled comparison. */
  benchmarkReceiptId?: string | null;
}

export interface ClaimDecision {
  claimId: string;
  proof: ClaimProofClass;
  verdict: ClaimVerdict;
  reason: string;
  missingEvidence: readonly string[];
}

/**
 * Decide one claim.
 *
 * Positioning short-circuits before any evidence is consulted: there is no argument, and no
 * quantity of screenshots, that converts market framing into a technical result.
 */
export function decideClaim(
  definition: ClaimDefinition,
  evidence: ClaimEvidence | undefined,
  options: { requiredScenarios?: readonly string[] } = {},
): ClaimDecision {
  const base = { claimId: definition.id, proof: definition.proof };

  if (definition.proof === 'positioning') {
    return {
      ...base,
      verdict: 'positioning-only',
      reason:
        'Market framing. Recorded for context and deliberately not provable — presenting it as a technical result would be the claim it cannot support.',
      missingEvidence: [],
    };
  }

  if (!evidence) {
    return {
      ...base,
      verdict: 'not-run',
      reason: 'No evidence was supplied. Absence is reported, never scored as a pass.',
      missingEvidence: definition.requiredEvidence,
    };
  }

  const missing = definition.requiredEvidence.filter((kind) => !evidence.present.includes(kind));
  if (missing.length > 0) {
    return {
      ...base,
      verdict: 'not-run',
      reason: `Undecidable: missing ${missing.join(', ')}. A claim judged on partial evidence is a guess wearing a verdict.`,
      missingEvidence: missing,
    };
  }

  if (!evidence.holds) {
    return {
      ...base,
      verdict: 'failed',
      reason: evidence.detail ?? 'The supplied evidence does not show this claim holding.',
      missingEvidence: [],
    };
  }

  // A benchmark claim is never "passed" by the live run that referenced it — it is carried by the
  // separate controlled comparison, and the verdict says so rather than borrowing the demo's glow.
  if (definition.proof === 'benchmark') {
    return evidence.benchmarkReceiptId
      ? {
          ...base,
          verdict: 'supported-by-separate-benchmark',
          reason: `Carried by benchmark receipt ${evidence.benchmarkReceiptId}, not by the live run.`,
          missingEvidence: [],
        }
      : {
          ...base,
          verdict: 'not-run',
          reason:
            'A benchmark claim needs a controlled comparison receipt. Watching the agent retrieve references shows it happened, not that it helped.',
          missingEvidence: ['benchmark-receipt'],
        };
  }

  if (definition.proof === 'scenario') {
    const required = options.requiredScenarios ?? [];
    const covered = evidence.scenariosCovered ?? [];
    const uncovered = required.filter((scenario) => !covered.includes(scenario));
    if (uncovered.length > 0) {
      return {
        ...base,
        verdict: 'partially-proven',
        reason: `Covered ${covered.join(', ') || 'nothing'}; still unproven for ${uncovered.join(', ')}. One persona's deck does not establish another's.`,
        missingEvidence: uncovered,
      };
    }
  }

  return {
    ...base,
    verdict: 'passed',
    reason: evidence.detail ?? 'Required evidence present and the claim holds.',
    missingEvidence: [],
  };
}

export interface ClaimSetReport {
  schemaVersion: typeof NODESLIDE_CLAIM_PROOF_VERSION;
  claimSet: string;
  decisions: readonly ClaimDecision[];
  /** Claims a reader may be told are true of the product. */
  provenClaims: readonly string[];
  /** Everything else, so the gap between the post and the proof is one lookup. */
  unprovenClaims: readonly string[];
  verdict: 'pass' | 'fail';
  summary: string;
}

/** A manifest is malformed if it marks market framing as something that must be proven. */
export function validateClaimDefinitions(definitions: readonly ClaimDefinition[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) errors.push(`Duplicate claim id ${definition.id}.`);
    seen.add(definition.id);
    if (definition.proof === 'positioning' && definition.required) {
      errors.push(
        `Claim ${definition.id} is positioning and cannot be required — it has no provable form.`,
      );
    }
    if (!CLAIM_PROOF_CLASSES.includes(definition.proof)) {
      errors.push(`Claim ${definition.id} has unknown proof class ${String(definition.proof)}.`);
    }
    if (definition.statement.trim().length === 0) {
      errors.push(`Claim ${definition.id} has no statement, so nothing is being checked.`);
    }
  }
  return errors;
}

/**
 * Judge a whole claim set. Fails if any REQUIRED claim did not reach a proof verdict — including
 * when it was simply never run, which is the case a summary line is most likely to hide.
 */
export function evaluateClaimSet(input: {
  claimSet: string;
  definitions: readonly ClaimDefinition[];
  evidence: readonly ClaimEvidence[];
  requiredScenarios?: readonly string[];
}): ClaimSetReport {
  const byClaim = new Map(input.evidence.map((item) => [item.claimId, item]));
  const options = input.requiredScenarios ? { requiredScenarios: input.requiredScenarios } : {};
  const decisions = input.definitions.map((definition) =>
    decideClaim(definition, byClaim.get(definition.id), options),
  );

  const proven = decisions.filter((d) => isProofVerdict(d.verdict));
  const unproven = decisions.filter((d) => !isProofVerdict(d.verdict));
  const requiredIds = new Set(input.definitions.filter((d) => d.required).map((d) => d.id));
  const failedRequired = decisions.filter(
    (d) => requiredIds.has(d.claimId) && !isProofVerdict(d.verdict),
  );

  const counts = new Map<ClaimVerdict, number>();
  for (const decision of decisions) {
    counts.set(decision.verdict, (counts.get(decision.verdict) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([verdict, count]) => `${count} ${verdict}`)
    .join(', ');

  return {
    schemaVersion: NODESLIDE_CLAIM_PROOF_VERSION,
    claimSet: input.claimSet,
    decisions,
    provenClaims: proven.map((d) => d.claimId),
    unprovenClaims: unproven.map((d) => d.claimId),
    verdict: failedRequired.length === 0 ? 'pass' : 'fail',
    summary: `${decisions.length} claims — ${breakdown}. ${proven.length} may be presented as proven; ${unproven.length} may not.`,
  };
}
