export const NODESLIDE_OVERLAY_INSPECTOR_MAX_WIDTH = 1100;

export function shouldRevealCandidateCanvas(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= NODESLIDE_OVERLAY_INSPECTOR_MAX_WIDTH;
}
