import type { ParityReport } from './parityChecker';

export const QUALITY_GATE_MAX_REPAIRS = 4;
export const QUALITY_GATE_TARGET_PASS_RATIO = 0.85;

const NON_ACTIONABLE_CHECK_IDS = new Set(['colorDelta', 'visualRegression']);

type MinimalCheck = {
  id?: string;
  label?: string;
  status?: string;
};

type MinimalReport = {
  checks?: unknown;
  passCount?: number;
  totalChecks?: number;
  status?: ParityReport['status'];
};

export function actionableChecks(report: MinimalReport | null | undefined): MinimalCheck[] {
  const checks = Array.isArray(report?.checks) ? (report.checks as MinimalCheck[]) : [];
  return checks.filter((check) => {
    if (check.status !== 'fail' && check.status !== 'warn') return false;
    if (check.id && NON_ACTIONABLE_CHECK_IDS.has(check.id)) return false;
    return true;
  });
}

export function shouldContinueQualityGate(
  report: MinimalReport | null | undefined,
  iterationNumber: number,
): boolean {
  if (!report) return false;
  if (iterationNumber >= QUALITY_GATE_MAX_REPAIRS) return false;
  if (report.status === 'verified') return false;

  const actionable = actionableChecks(report);
  if (actionable.length === 0) return false;

  const totalChecks = Math.max(1, Number(report.totalChecks ?? 0));
  const passCount = Number(report.passCount ?? 0);
  const targetPassCount = Math.ceil(totalChecks * QUALITY_GATE_TARGET_PASS_RATIO);
  const hasActionableFailure = actionable.some((check) => check.status === 'fail');

  return hasActionableFailure || passCount < targetPassCount;
}
