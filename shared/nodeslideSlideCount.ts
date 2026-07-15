export type NodeSlideRequestedSlideCount = 3 | 4 | 5 | 6 | 7 | 8;

const SLIDE_COUNT_BY_TOKEN: Record<string, NodeSlideRequestedSlideCount> = {
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
};

export function inferNodeSlideRequestedSlideCount(
  ...values: readonly (string | null | undefined)[]
): NodeSlideRequestedSlideCount | null {
  const text = values.filter((value): value is string => typeof value === 'string').join(' ');
  const match = text.match(
    /\b(3|4|5|6|7|8|three|four|five|six|seven|eight)(?:\s*[-–—]\s*|\s+)slides?\b/iu,
  );
  return match?.[1] ? (SLIDE_COUNT_BY_TOKEN[match[1].toLocaleLowerCase()] ?? null) : null;
}
