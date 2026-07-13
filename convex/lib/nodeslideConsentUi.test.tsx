import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeSlideLanding } from '../../src/domains/nodeslide/components/NodeSlideLanding';
import {
  ProjectDialog,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT as UI_OPENROUTER_CONSENT,
} from '../../src/domains/nodeslide/components/ProjectDialog';
import { NODESLIDE_OPENROUTER_BRIEF_CONSENT } from './nodeslideValidators';

describe('NodeSlide informed provider controls', () => {
  it('keeps deterministic generation selected and OpenRouter consent ungranted by default', () => {
    const markup = renderToStaticMarkup(
      <ProjectDialog
        open
        clientSessionId="session-test"
        recentDecks={[]}
        creating={false}
        onClose={() => undefined}
        onCreate={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toMatch(/data-testid="provider-deterministic"[^>]*aria-pressed="true"/);
    expect(markup).toMatch(/data-testid="provider-openrouter"[^>]*aria-pressed="false"/);
    expect(markup).toMatch(/type="checkbox"[^>]*data-testid="provider-consent"[^>]*disabled/);
    expect(markup).toContain('no part of this brief is sent to OpenRouter');
    expect(markup).toContain(
      'Sends the full brief to the selected named model through OpenRouter.',
    );
    expect(markup).toContain('I consent to sending this full brief to OpenRouter');
    expect(markup).toContain('data-testid="create-model-select"');
    expect(markup).toContain('data-testid="create-effort-select"');
    expect(markup.match(/<option value=/g)).toHaveLength(12);
    expect(markup).toContain('data-testid="create-file-input"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('name="nodeslide-preview-access-code"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('Add a deck title to continue.');
    expect(markup).toContain('Use World Cup data story');
    expect(markup).toContain('chart, formula, and image primitives');
    expect(markup).toMatch(/type="submit"[^>]*disabled[^>]*aria-describedby/);
  });

  it('renders admission failures inside the project dialog', () => {
    const markup = renderToStaticMarkup(
      <ProjectDialog
        open
        clientSessionId="session-test"
        recentDecks={[]}
        creating={false}
        error="That private-preview access code is not valid."
        onClearError={() => undefined}
        onClose={() => undefined}
        onCreate={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('That private-preview access code is not valid.');
  });

  it('uses the same versioned OpenRouter consent token in UI and server contracts', () => {
    expect(UI_OPENROUTER_CONSENT).toBe(NODESLIDE_OPENROUTER_BRIEF_CONSENT);
  });

  it('recommends a live model and keeps consent inline before direct creation', () => {
    const markup = renderToStaticMarkup(
      <NodeSlideLanding
        clientSessionId="session-test"
        recentDecks={[]}
        creating={false}
        onCreate={() => undefined}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="nodeslide-landing"');
    expect(markup).toContain('What presentation should we build?');
    expect(markup).toContain('GLM 5.2 · Recommended');
    expect(markup).toContain('Claude Sonnet 5 · Anthropic');
    expect(markup).toContain('GPT-5.6 Sol · OpenAI');
    expect(markup).toContain('data-testid="landing-effort-select"');
    expect(markup).toContain('<option value="max">Ultra</option>');
    expect(markup.match(/<option value=/g)).toHaveLength(13);
    expect(markup).toContain('data-testid="landing-file-input"');
    expect(markup).toContain('data-testid="landing-provider-consent"');
    expect(markup).toContain('Attach data');
    expect(markup).toContain('One explicit consent above; then create directly.');
    expect(markup).toContain('aria-label="Create presentation"');
    expect(markup).toContain('Explore the editable sample workspace');
    expect(markup).not.toContain('nodeslide-preview-access-code');
    expect(markup).not.toContain('NodeSlide inspector');
  });

  it('carries a root-composer draft into the detailed creation contract', () => {
    const markup = renderToStaticMarkup(
      <ProjectDialog
        open
        clientSessionId="session-test"
        recentDecks={[]}
        creating={false}
        initialDraft={{
          title: 'AI 2027 — Scenarios and Decisions',
          prompt: 'Build an evidence-led AI 2027 scenario deck.',
          providerMode: 'openrouter_free',
          providerModel: 'anthropic/claude-sonnet-5',
          attachments: [{ title: 'evidence.csv', format: 'csv', content: 'year,value\n2027,42' }],
        }}
        onClose={() => undefined}
        onCreate={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toContain('value="AI 2027 — Scenarios and Decisions"');
    expect(markup).toContain('Build an evidence-led AI 2027 scenario deck.');
    expect(markup).toMatch(/data-testid="provider-openrouter"[^>]*aria-pressed="true"/);
    expect(markup).toContain('value="anthropic/claude-sonnet-5" selected=""');
    expect(markup).toContain('evidence.csv');
    expect(markup).toContain('and 1 attached file');
    expect(markup).toMatch(/type="checkbox"[^>]*data-testid="provider-consent"/);
    expect(markup).not.toMatch(/data-testid="provider-consent"[^>]*disabled/);
  });
});
