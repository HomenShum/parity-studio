import { describe, expect, it } from 'vitest';
import {
  buildDesignWorkflowCatalogPayload,
  buildDiscoveryQuestionsPayload,
  buildOpenDesignTakeawaysDoc,
} from './designWorkflowCatalog.js';

describe('designWorkflowCatalog', () => {
  it('names the Parity workflows that adapt Open Design lessons without copying its product scope', () => {
    const catalog = buildDesignWorkflowCatalogPayload();

    expect(catalog.positioning.openDesign).toContain('artifact generator');
    expect(catalog.positioning.parityStudio).toContain('capture/decompose');
    expect(catalog.workflows.map((workflow) => workflow.id)).toContain('existing-app-to-ui-kit');
    expect(catalog.workflows.map((workflow) => workflow.id)).toContain('qa-dogfood-relay');
    expect(catalog.agentRule).toContain('capture/decompose/design-mission');
  });

  it('blocks production apply when required discovery answers are missing', () => {
    const payload = buildDiscoveryQuestionsPayload({
      request: 'stage this redesign first',
      allowedChangeScope: 'design-only',
    });

    expect(payload.status).toBe('needs_user_answers');
    expect(payload.unanswered.map((question) => question.id)).toContain('target-flow');
    expect(payload.unanswered.map((question) => question.id)).toContain('locked-components');
    expect(payload.safeDefaults['byok-privacy']).toContain('local MCP BYOK');
  });

  it('documents the actionable Open Design takeaways for generated kits', () => {
    const doc = buildOpenDesignTakeawaysDoc();

    expect(doc).toContain('What Open Design Does Well');
    expect(doc).toContain('What Parity Studio Deliberately Does Differently');
    expect(doc).toContain('Contribution Candidates Upstream');
  });
});
