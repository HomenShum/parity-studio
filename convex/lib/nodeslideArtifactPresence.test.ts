import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../../shared/nodeslide';
import { nodeslideArtifactPresenceChecks } from './nodeslideArtifactPresence';
import { evaluateNodeSlideDeckCi } from './nodeslideDeckCi';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function golden(): DeckSnapshot {
  return buildGoldenNodeSlide('artifact-presence-tests', NOW).snapshot;
}

describe('NodeSlide artifact presence gate', () => {
  it('passes a coherent deck with a single summary check', () => {
    const checks = nodeslideArtifactPresenceChecks(golden());
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ code: 'artifact_presence', status: 'pass' });
  });

  it('blocks when a slide orders an element that has no canonical state', () => {
    const snapshot = golden();
    snapshot.slides[0]?.elementOrder.push('element:ghost');

    const checks = nodeslideArtifactPresenceChecks(snapshot);
    expect(checks).toContainEqual(
      expect.objectContaining({
        code: 'artifact_state_missing',
        status: 'fail',
        blocker: true,
        elementIds: ['element:ghost'],
      }),
    );

    // The gate must reach Deck CI's verdict, not just produce a draft.
    const ci = evaluateNodeSlideDeckCi({ snapshot });
    expect(ci.status).toBe('fail');
    expect(
      ci.checks.some((check) => check.code === 'artifact_state_missing' && check.blocker),
    ).toBe(true);
  });

  it('blocks a chart whose data was silently dropped', () => {
    const snapshot = golden();
    const chart = snapshot.elements.find((element) => element.kind === 'chart');
    if (!chart) throw new Error('Golden fixture must include a chart element.');
    expect(Reflect.deleteProperty(chart, 'chart')).toBe(true);

    const checks = nodeslideArtifactPresenceChecks(snapshot);
    expect(checks).toContainEqual(
      expect.objectContaining({
        code: 'artifact_payload_missing',
        status: 'fail',
        blocker: true,
        elementIds: [chart.id],
      }),
    );
  });

  it('exempts intentionally hidden elements from render presence', () => {
    const snapshot = golden();
    const text = snapshot.elements.find((element) => element.kind === 'text');
    if (!text) throw new Error('Golden fixture must include a text element.');
    text.visible = false;

    const checks = nodeslideArtifactPresenceChecks(snapshot);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ code: 'artifact_presence', status: 'pass' });
  });

  it('warns about canonical elements no slide can ever render', () => {
    const snapshot = golden();
    const slide = snapshot.slides[0];
    const text = snapshot.elements.find((element) => element.kind === 'text');
    if (!slide || !text) throw new Error('Golden fixture must include a slide and text element.');
    slide.elementOrder = slide.elementOrder.filter((elementId) => elementId !== text.id);

    const checks = nodeslideArtifactPresenceChecks(snapshot);
    expect(checks).toContainEqual(
      expect.objectContaining({
        code: 'artifact_orphaned_element',
        status: 'warning',
        elementIds: [text.id],
      }),
    );
  });
});
