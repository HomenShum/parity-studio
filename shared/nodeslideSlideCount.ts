export const NODESLIDE_MIN_REQUESTED_SLIDES = 3;
export const NODESLIDE_MAX_REQUESTED_SLIDES = 8;

export type NodeSlideRequestedSlideCount = 3 | 4 | 5 | 6 | 7 | 8;

const SLIDE_COUNT_BY_TOKEN: Record<string, number> = {
  '1': 1,
  one: 1,
  '2': 2,
  two: 2,
  '3': 3,
  three: 3,
  '4': 4,
  four: 4,
  '5': 5,
  five: 5,
  '6': 6,
  six: 6,
  '7': 7,
  seven: 7,
  '8': 8,
  eight: 8,
  '9': 9,
  nine: 9,
  '10': 10,
  ten: 10,
  '11': 11,
  eleven: 11,
  '12': 12,
  twelve: 12,
  '13': 13,
  thirteen: 13,
  '14': 14,
  fourteen: 14,
  '15': 15,
  fifteen: 15,
  '16': 16,
  sixteen: 16,
  '17': 17,
  seventeen: 17,
  '18': 18,
  eighteen: 18,
  '19': 19,
  nineteen: 19,
  '20': 20,
  twenty: 20,
};

const REQUESTED_SLIDE_COUNT_PATTERN =
  /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:\s*[-–—]\s*|\s+)slides?\b/iu;

const DESCRIBED_SLIDE_COUNT_PATTERN =
  /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:[a-z][a-z-]{1,24}(?:,\s*|\s+)){1,4}slides?\b/iu;

export function explicitNodeSlideRequestedSlideCount(
  ...values: readonly (string | null | undefined)[]
): number | null {
  const text = values.filter((value): value is string => typeof value === 'string').join(' ');
  const match =
    text.match(REQUESTED_SLIDE_COUNT_PATTERN) ?? text.match(DESCRIBED_SLIDE_COUNT_PATTERN);
  if (!match?.[1]) return null;
  const token = match[1].toLocaleLowerCase();
  const mapped = SLIDE_COUNT_BY_TOKEN[token];
  if (mapped !== undefined) return mapped;
  const numeric = Number.parseInt(token, 10);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function inferNodeSlideRequestedSlideCount(
  ...values: readonly (string | null | undefined)[]
): NodeSlideRequestedSlideCount | null {
  const count = explicitNodeSlideRequestedSlideCount(...values);
  return count !== null &&
    count >= NODESLIDE_MIN_REQUESTED_SLIDES &&
    count <= NODESLIDE_MAX_REQUESTED_SLIDES
    ? (count as NodeSlideRequestedSlideCount)
    : null;
}

export function nodeSlideRequestedSlideCountIssue(
  ...values: readonly (string | null | undefined)[]
): string | null {
  const count = explicitNodeSlideRequestedSlideCount(...values);
  if (
    count === null ||
    (count >= NODESLIDE_MIN_REQUESTED_SLIDES && count <= NODESLIDE_MAX_REQUESTED_SLIDES)
  ) {
    return null;
  }
  return `NodeSlide currently creates ${NODESLIDE_MIN_REQUESTED_SLIDES}–${NODESLIDE_MAX_REQUESTED_SLIDES} slides. Change the requested ${count}-slide deck to ${NODESLIDE_MIN_REQUESTED_SLIDES}–${NODESLIDE_MAX_REQUESTED_SLIDES} slides.`;
}
