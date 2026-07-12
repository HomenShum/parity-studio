import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_AGENTIC_CONTROLS_SCHEMA_VERSION = 'nodeslide.agentic-controls/v1' as const;

export const NODESLIDE_AGENTIC_CONTROL_ENV = Object.freeze({
  globalExecution: 'NODESLIDE_AGENTIC_GLOBAL_ENABLED',
  cohortAdmission: 'NODESLIDE_AGENTIC_SHADOW_ENABLED',
  providerPlanning: 'NODESLIDE_AGENTIC_PROVIDER_PLANNING_ENABLED',
  providerAllowlist: 'NODESLIDE_AGENTIC_PROVIDER_ALLOWLIST',
  kernelExecution: 'NODESLIDE_AGENTIC_KERNEL_ENABLED',
  kernelAllowlist: 'NODESLIDE_AGENTIC_KERNEL_ALLOWLIST',
  networkEgress: 'NODESLIDE_AGENTIC_NETWORK_EGRESS_ENABLED',
  renderRepair: 'NODESLIDE_AGENTIC_RENDER_REPAIR_ENABLED',
  automaticContinuation: 'NODESLIDE_AGENTIC_AUTO_CONTINUATION_ENABLED',
  fullTracePersistence: 'NODESLIDE_AGENTIC_FULL_TRACE_ENABLED',
  publication: 'NODESLIDE_AGENTIC_PUBLICATION_ENABLED',
});

export type NodeSlideAgenticOperation =
  | 'deck_repl_shadow'
  | 'provider_planning'
  | 'analysis_kernel'
  | 'network_egress'
  | 'render_repair'
  | 'automatic_continuation'
  | 'full_trace_persistence'
  | 'publication';

export interface NodeSlideAgenticControls {
  schemaVersion: typeof NODESLIDE_AGENTIC_CONTROLS_SCHEMA_VERSION;
  globalExecution: boolean;
  cohortAdmission: boolean;
  providerPlanning: boolean;
  providerAllowlist: string[];
  kernelExecution: boolean;
  kernelAllowlist: string[];
  networkEgress: boolean;
  renderRepair: boolean;
  automaticContinuation: boolean;
  fullTracePersistence: boolean;
  publication: boolean;
  controlsDigest: string;
}

export interface NodeSlideAgenticAuthorization {
  allowed: boolean;
  reasons: string[];
  controlsDigest: string;
}

export function resolveNodeSlideAgenticControls(
  environment: Readonly<Record<string, string | undefined>>,
): NodeSlideAgenticControls {
  const partial = {
    schemaVersion: NODESLIDE_AGENTIC_CONTROLS_SCHEMA_VERSION,
    globalExecution: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.globalExecution]),
    cohortAdmission: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.cohortAdmission]),
    providerPlanning: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.providerPlanning]),
    providerAllowlist: parseAllowlist(environment[NODESLIDE_AGENTIC_CONTROL_ENV.providerAllowlist]),
    kernelExecution: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.kernelExecution]),
    kernelAllowlist: parseAllowlist(environment[NODESLIDE_AGENTIC_CONTROL_ENV.kernelAllowlist]),
    networkEgress: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.networkEgress]),
    renderRepair: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.renderRepair]),
    automaticContinuation: enabled(
      environment[NODESLIDE_AGENTIC_CONTROL_ENV.automaticContinuation],
    ),
    fullTracePersistence: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.fullTracePersistence]),
    publication: enabled(environment[NODESLIDE_AGENTIC_CONTROL_ENV.publication]),
  };
  return {
    ...partial,
    controlsDigest: `controls_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

export function authorizeNodeSlideAgenticOperation(
  controls: NodeSlideAgenticControls,
  request: {
    operation: NodeSlideAgenticOperation;
    providerId?: string;
    kernelId?: string;
  },
): NodeSlideAgenticAuthorization {
  const reasons: string[] = [];
  if (!controls.globalExecution) reasons.push('global_execution_disabled');
  if (!controls.cohortAdmission) reasons.push('cohort_admission_disabled');
  switch (request.operation) {
    case 'deck_repl_shadow':
      break;
    case 'provider_planning': {
      if (!controls.providerPlanning) reasons.push('provider_planning_disabled');
      const providerId = cleanAdapterId(request.providerId);
      if (!providerId || !controls.providerAllowlist.includes(providerId)) {
        reasons.push('provider_not_allowlisted');
      }
      break;
    }
    case 'analysis_kernel': {
      if (!controls.kernelExecution) reasons.push('kernel_execution_disabled');
      const kernelId = cleanAdapterId(request.kernelId);
      if (!kernelId || !controls.kernelAllowlist.includes(kernelId)) {
        reasons.push('kernel_not_allowlisted');
      }
      break;
    }
    case 'network_egress':
      if (!controls.networkEgress) reasons.push('network_egress_disabled');
      break;
    case 'render_repair':
      if (!controls.renderRepair) reasons.push('render_repair_disabled');
      break;
    case 'automatic_continuation':
      if (!controls.automaticContinuation) reasons.push('automatic_continuation_disabled');
      break;
    case 'full_trace_persistence':
      if (!controls.fullTracePersistence) reasons.push('full_trace_persistence_disabled');
      break;
    case 'publication':
      if (!controls.publication) reasons.push('agentic_publication_disabled');
      break;
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  return {
    allowed: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    controlsDigest: controls.controlsDigest,
  };
}

function enabled(value: string | undefined): boolean {
  return value === 'true';
}

function parseAllowlist(value: string | undefined): string[] {
  if (!value || value.length > 1_024) return [];
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length > 16 || entries.some((entry) => !cleanAdapterId(entry))) return [];
  return [...new Set(entries)].sort();
}

function cleanAdapterId(value: string | undefined): string {
  if (!value || value.length > 96) return '';
  return /^[a-z0-9][a-z0-9._/-]*$/.test(value) ? value : '';
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}
