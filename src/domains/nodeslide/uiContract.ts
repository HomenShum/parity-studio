/**
 * NodeSlide UI contract — a machine-readable surface for agents driving the UI.
 *
 * QA agents, scripted drives, and coding assistants should never have to infer app
 * state from pixels or copy strings. The app PUBLISHES its state: a versioned window
 * object for JS-eval consumers plus mirrored `data-ns-*` attributes on <html> for
 * selector-based consumers (Playwright waits, pixels.cjs asserts, CSS-only checks).
 *
 * Contract rules (the reason this file is trustworthy):
 * - Values describe what the app IS DOING, never what it wants to appear to do; a
 *   publisher may only report a phase/stage it is actually rendering.
 * - Additive evolution only: bump `version` on breaking shape changes.
 * - No secrets, no user content — ids, phases, counts, and booleans only.
 */

export const NODESLIDE_UI_CONTRACT_VERSION = 'nodeslide.ui-contract/v1' as const;

export type NodeSlideUiPhase = 'landing' | 'loading' | 'workspace' | 'recovery' | 'present';
export type NodeSlideUiLoadingStage = 'connecting' | 'preparing_sample' | 'opening_deck';
export type NodeSlideUiConnection = 'connecting' | 'ready';

export interface NodeSlideUiContract {
  version: typeof NODESLIDE_UI_CONTRACT_VERSION;
  phase: NodeSlideUiPhase;
  connection: NodeSlideUiConnection;
  theme: 'light' | 'dark';
  loading?: {
    stage: NodeSlideUiLoadingStage;
    /** Milliseconds since this loading phase began. */
    elapsedMs: number;
    retryVisible: boolean;
  };
  deck?: {
    id: string;
    version: number;
    slideCount: number;
  };
  /** The active durable job, when one is running or awaiting review. */
  job?: {
    id: string;
    status: string;
    phase: string;
    /** Admission-time routing decision (advisory_v1) when the server published one. */
    routing?:
      | { kind: 'selected'; modelId: string; estimatedMicroUsd: number | null }
      | { kind: 'refused'; code: string };
  };
  updatedAt: number;
}

declare global {
  interface Window {
    __NODESLIDE_UI_CONTRACT__?: NodeSlideUiContract;
  }
}

/**
 * Publish the current UI state. Call from the component that RENDERS the state —
 * never speculatively. Attributes land on <html> so they survive shell remounts.
 */
export function publishNodeSlideUiContract(
  next: Omit<NodeSlideUiContract, 'version' | 'updatedAt'>,
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const contract: NodeSlideUiContract = {
    version: NODESLIDE_UI_CONTRACT_VERSION,
    ...next,
    updatedAt: Date.now(),
  };
  window.__NODESLIDE_UI_CONTRACT__ = contract;
  const root = document.documentElement;
  root.setAttribute('data-ns-phase', contract.phase);
  root.setAttribute('data-ns-connection', contract.connection);
  root.setAttribute('data-ns-theme', contract.theme);
  if (contract.loading) {
    root.setAttribute('data-ns-loading-stage', contract.loading.stage);
  } else {
    root.removeAttribute('data-ns-loading-stage');
  }
  if (contract.deck) {
    root.setAttribute('data-ns-deck-id', contract.deck.id);
    root.setAttribute('data-ns-deck-version', String(contract.deck.version));
  } else {
    root.removeAttribute('data-ns-deck-id');
    root.removeAttribute('data-ns-deck-version');
  }
  if (contract.job) {
    root.setAttribute('data-ns-job-status', contract.job.status);
    root.setAttribute('data-ns-job-phase', contract.job.phase);
    if (contract.job.routing) {
      root.setAttribute('data-ns-routing', contract.job.routing.kind);
    } else {
      root.removeAttribute('data-ns-routing');
    }
  } else {
    root.removeAttribute('data-ns-job-status');
    root.removeAttribute('data-ns-job-phase');
    root.removeAttribute('data-ns-routing');
  }
}

/** Read the last published contract (agents: prefer this over DOM scraping). */
export function readNodeSlideUiContract(): NodeSlideUiContract | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__NODESLIDE_UI_CONTRACT__;
}
