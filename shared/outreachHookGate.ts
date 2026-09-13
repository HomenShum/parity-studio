/**
 * Outreach hook gate — refuse to compose a message to a named person unless a
 * verified research hook exists on that contact.
 *
 * WHY THIS IS CODE AND NOT A PROMPT RULE
 *
 * A model asked to open a message without research produces something plausible
 * and false, and unlike a hallucinated code path it is delivered to a named human
 * who can check it. This exact failure happened: a research agent returned a
 * zero-byte result, its claims were recorded anyway, and a fabricated SEC filing
 * date reached the field that composes an outbound message to a real CEO. It was
 * removed before sending, but nothing in the system had objected.
 *
 * A rule in a system prompt competes with everything else in context and loses
 * under time pressure. This returns `allowed: false` and cannot be talked out of
 * it.
 *
 * Shaped deliberately after `evaluateNodeSlideSessionGrant`: pure, non-mutating,
 * typed reason codes, one decision per call.
 */

export const OUTREACH_HOOK_GATE_VERSION = 1 as const;

/** Maximum age of a hook before it stops counting as recent. */
export const OUTREACH_HOOK_MAX_AGE_DAYS = 90;

export const OUTREACH_HOOK_REASON_CODES = [
  'allowed',
  'no_hook',
  'legacy_unsourced_hook',
  'source_not_resolvable',
  'hook_stale',
  'hook_not_specific',
  'invalid_contract',
] as const;

export type OutreachHookReasonCode = (typeof OUTREACH_HOOK_REASON_CODES)[number];

/**
 * A hook recorded against a contact. `source` is required by construction: a
 * claim without a source is not a finding, and this is the field that is read
 * straight into a message a stranger reads.
 */
export interface OutreachHook {
  readonly text: string;
  readonly source: string;
  /** ISO date of the thing itself, not of when it was recorded. */
  readonly occurredAt?: string;
  readonly recordedAt: string;
}

export interface OutreachHookGateRequest {
  readonly contactId: string;
  /** A bare string is the legacy shape and is never trusted — see below. */
  readonly hook: OutreachHook | string | undefined;
  readonly evaluatedAt: number;
}

export interface OutreachHookGateDecision {
  readonly allowed: boolean;
  readonly reasonCode: OutreachHookReasonCode;
  /** Operator-facing sentence. Present on every denial. */
  readonly explanation: string;
  /** What the caller should do instead. Never "try again". */
  readonly remedy?: string;
}

/**
 * Phrases that are hooks with the specificity filed off. Each one is a real
 * opener a model will reach for when it has done no research, and each is
 * indistinguishable from diligence until the recipient checks.
 */
const GENERIC_HOOK_PATTERNS: readonly RegExp[] = [
  /^\s*(i\s+)?(saw|read|noticed|came across)\s+your\s+(recent\s+)?(work|post|profile|content|stuff)\b/i,
  /\byour\s+(work|posts?)\s+(in|on|around)\s+(ai|tech|the\s+space)\b/i,
  /\bimpressive\s+(background|profile|work)\b/i,
  // "you're", "youre", and "you are" all appear in practice; matching only the
  // contracted form let "love what you are building" through the gate.
  /\blove\s+what\s+(you(’|')?re|you\s+are)\s+(doing|building)\b/i,
  /^\s*your\s+company\s+(looks|seems)\b/i,
];

const HTTP_URL = /^https?:\/\/[^\s]+\.[^\s]+$/i;

const daysBetween = (laterMs: number, earlierIso: string): number | undefined => {
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(earlier)) return undefined;
  return (laterMs - earlier) / 86_400_000;
};

/**
 * Evaluates one outreach attempt. Pure: mutates nothing, reads nothing global.
 *
 * A denial is a NORMAL outcome, not an error. For a volume recruiter or an
 * unidentifiable sender, `no_hook` is the correct result and the correct
 * downstream action is to deprioritise the contact rather than write anything.
 */
export function evaluateOutreachHookGate(
  request: OutreachHookGateRequest,
): OutreachHookGateDecision {
  // `remedy` is spread in only when present. Under this repo's
  // exactOptionalPropertyTypes, an optional property cannot be handed an
  // explicit `undefined` — the absent key and the undefined value are different
  // things, which is the same distinction this gate makes about hooks.
  const deny = (
    reasonCode: Exclude<OutreachHookReasonCode, 'allowed'>,
    explanation: string,
    remedy?: string,
  ): OutreachHookGateDecision => ({
    allowed: false,
    reasonCode,
    explanation,
    ...(remedy === undefined ? {} : { remedy }),
  });

  if (!request.contactId || !Number.isFinite(request.evaluatedAt)) {
    return deny('invalid_contract', 'The gate needs a contactId and a finite evaluation time.');
  }

  const { hook } = request;

  if (hook === undefined || hook === null) {
    return deny(
      'no_hook',
      'No research hook on this contact.',
      'Look them up first: recent posts, a demo, a launch, a filing, what they shipped. Record one concrete thing with its URL. A generic opener is worse than a late reply.',
    );
  }

  // A bare string predates the requirement that hooks carry a source. That shape
  // is exactly how an unsourced claim reached an outbound field, so it is
  // treated as absent rather than trusted.
  if (typeof hook === 'string') {
    return deny(
      'legacy_unsourced_hook',
      'This contact carries a legacy hook with no source, so its provenance cannot be checked.',
      'Re-record it with the URL you actually read.',
    );
  }

  if (!HTTP_URL.test(hook.source ?? '')) {
    return deny(
      'source_not_resolvable',
      'The hook has no resolvable http(s) source.',
      'A claim without a source is not a finding. Supply the URL you read it on.',
    );
  }

  const text = (hook.text ?? '').trim();
  if (text.length < 12 || GENERIC_HOOK_PATTERNS.some((p) => p.test(text))) {
    return deny(
      'hook_not_specific',
      'The hook is generic — it would read as automated because it names nothing checkable.',
      'Name the specific artifact: which demo, which launch, which filing, which PR.',
    );
  }

  // Recency is checked against when the thing HAPPENED, not when it was recorded.
  // Recording an old item today does not make it recent, and the recipient knows
  // when they posted it.
  if (hook.occurredAt !== undefined) {
    const age = daysBetween(request.evaluatedAt, hook.occurredAt);
    if (age === undefined) {
      return deny('invalid_contract', 'hook.occurredAt is not a parsable ISO date.');
    }
    if (age > OUTREACH_HOOK_MAX_AGE_DAYS) {
      return deny(
        'hook_stale',
        `The hook is ${Math.round(age)} days old; a hook older than ${OUTREACH_HOOK_MAX_AGE_DAYS} days is not recency.`,
        'Find something from the last 90 days, or say plainly that nothing recent exists.',
      );
    }
  }

  return {
    allowed: true,
    reasonCode: 'allowed',
    explanation: `Hook verified against ${hook.source}.`,
  };
}
