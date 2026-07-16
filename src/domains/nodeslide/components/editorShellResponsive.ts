export const NODESLIDE_OVERLAY_INSPECTOR_MAX_WIDTH = 1100;
export const NODESLIDE_RESPONSIVE_DRAWER_QUERY = '(max-width: 899px)';

export function shouldRevealCandidateCanvas(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= NODESLIDE_OVERLAY_INSPECTOR_MAX_WIDTH;
}
