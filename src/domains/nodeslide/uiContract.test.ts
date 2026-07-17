// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_UI_CONTRACT_VERSION,
  publishNodeSlideUiContract,
  readNodeSlideUiContract,
} from './uiContract';

describe('NodeSlide UI contract', () => {
  it('publishes a versioned window contract and mirrors it as data attributes', () => {
    publishNodeSlideUiContract({
      phase: 'loading',
      connection: 'connecting',
      theme: 'light',
      loading: { stage: 'connecting', elapsedMs: 1200, retryVisible: false },
    });

    const contract = readNodeSlideUiContract();
    expect(contract).toMatchObject({
      version: NODESLIDE_UI_CONTRACT_VERSION,
      phase: 'loading',
      connection: 'connecting',
      loading: { stage: 'connecting', retryVisible: false },
    });
    expect(contract?.updatedAt).toBeGreaterThan(0);
    const root = document.documentElement;
    expect(root.getAttribute('data-ns-phase')).toBe('loading');
    expect(root.getAttribute('data-ns-connection')).toBe('connecting');
    expect(root.getAttribute('data-ns-loading-stage')).toBe('connecting');
    expect(root.getAttribute('data-ns-theme')).toBe('light');
  });

  it('clears stale loading/deck attributes on phase transitions', () => {
    publishNodeSlideUiContract({
      phase: 'loading',
      connection: 'ready',
      theme: 'light',
      loading: { stage: 'preparing_sample', elapsedMs: 3000, retryVisible: false },
    });
    publishNodeSlideUiContract({
      phase: 'workspace',
      connection: 'ready',
      theme: 'dark',
      deck: { id: 'deck_golden', version: 4, slideCount: 7 },
    });

    const root = document.documentElement;
    expect(root.getAttribute('data-ns-phase')).toBe('workspace');
    expect(root.getAttribute('data-ns-loading-stage')).toBeNull();
    expect(root.getAttribute('data-ns-deck-id')).toBe('deck_golden');
    expect(root.getAttribute('data-ns-deck-version')).toBe('4');
    expect(root.getAttribute('data-ns-theme')).toBe('dark');

    publishNodeSlideUiContract({ phase: 'landing', connection: 'ready', theme: 'light' });
    expect(root.getAttribute('data-ns-deck-id')).toBeNull();
    expect(root.getAttribute('data-ns-deck-version')).toBeNull();
    expect(root.getAttribute('data-ns-phase')).toBe('landing');
  });
});
