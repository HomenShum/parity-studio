import type { DeckSnapshot } from '../../shared/nodeslide';
import { renderDeckHtml } from '../../src/domains/nodeslide/slidelang/html';
import type { NodeSlideDeckCiHookCheckInput } from './nodeslideDeckCi';

/**
 * W6 artifact-presence gate: "the canonical state changed" is not success. Every
 * ordered element must exist in canonical state, carry its kind's payload, and
 * visibly appear in rendered output; otherwise Deck CI blocks instead of letting
 * a deck with silently dropped media report success. Export- and screenshot-level
 * links of the artifact chain remain with the journey proof and export tests.
 */
export function nodeslideArtifactPresenceChecks(
  snapshot: DeckSnapshot,
): NodeSlideDeckCiHookCheckInput[] {
  let html: string;
  try {
    html = renderDeckHtml(snapshot);
  } catch (error) {
    return [
      {
        code: 'artifact_render_failed',
        status: 'fail',
        blocker: true,
        message: `The deck could not be rendered for artifact verification: ${
          error instanceof Error ? error.message : 'unknown renderer error'
        }`,
      },
    ];
  }

  const checks: NodeSlideDeckCiHookCheckInput[] = [];
  const elementsById = new Map(snapshot.elements.map((element) => [element.id, element]));
  const orderedIds = new Set<string>();
  let verifiedCount = 0;

  for (const slide of snapshot.slides) {
    for (const elementId of slide.elementOrder) {
      orderedIds.add(elementId);
      const element = elementsById.get(elementId);
      if (!element) {
        checks.push({
          code: 'artifact_state_missing',
          status: 'fail',
          blocker: true,
          message: `Slide "${slide.title}" orders element ${elementId}, but it does not exist in canonical state.`,
          slideIds: [slide.id],
          elementIds: [elementId],
        });
        continue;
      }
      if (element.visible === false) continue;

      const payloadIssue =
        element.kind === 'chart' && (!element.chart || element.chart.series.length === 0)
          ? 'has no chart data and would export as a placeholder'
          : element.kind === 'image' && !element.imageUrl?.trim() && !element.image
            ? 'has no image source and would render as an empty frame'
            : element.kind === 'math' && !element.math
              ? 'has no math payload'
              : element.kind === 'video' && !element.video
                ? 'has no video payload'
                : null;
      if (payloadIssue) {
        checks.push({
          code: 'artifact_payload_missing',
          status: 'fail',
          blocker: true,
          message: `${element.name} (${element.kind}) ${payloadIssue}.`,
          slideIds: [slide.id],
          elementIds: [element.id],
        });
        continue;
      }
      if (element.kind === 'text' && !element.content?.trim()) {
        checks.push({
          code: 'artifact_payload_missing',
          status: 'warning',
          message: `${element.name} is an empty text element.`,
          slideIds: [slide.id],
          elementIds: [element.id],
        });
        continue;
      }

      if (!html.includes(`data-element-id="${element.id}"`)) {
        checks.push({
          code: 'artifact_render_missing',
          status: 'fail',
          blocker: true,
          message: `${element.name} (${element.kind}) exists in canonical state but does not appear in rendered output.`,
          slideIds: [slide.id],
          elementIds: [element.id],
        });
        continue;
      }
      verifiedCount += 1;
    }
  }

  for (const element of snapshot.elements) {
    if (!orderedIds.has(element.id)) {
      checks.push({
        code: 'artifact_orphaned_element',
        status: 'warning',
        message: `${element.name} exists in canonical state but no slide orders it, so it can never render.`,
        slideIds: [element.slideId],
        elementIds: [element.id],
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      code: 'artifact_presence',
      status: 'pass',
      message: `All ${verifiedCount} ordered visible elements are present in canonical state and rendered output.`,
    });
  }
  return checks;
}
