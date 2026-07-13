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
    expect(markup).toContain('Sends the full brief—title, prompt, audience, purpose, and success');
    expect(markup).toContain('I consent to sending this full brief to OpenRouter');
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

  it('explains the privacy-preserving default before the create dialog opens', () => {
    const markup = renderToStaticMarkup(
      <NodeSlideLanding
        recentDecks={[]}
        onStart={() => undefined}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="nodeslide-landing"');
    expect(markup).toContain('What presentation should we build?');
    expect(markup).toContain('Private · deterministic');
    expect(markup).toContain('Your brief stays inside NodeSlide by default.');
    expect(markup).toContain('Explore the editable sample workspace');
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
        }}
        onClose={() => undefined}
        onCreate={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    expect(markup).toContain('value="AI 2027 — Scenarios and Decisions"');
    expect(markup).toContain('Build an evidence-led AI 2027 scenario deck.');
    expect(markup).toMatch(/data-testid="provider-openrouter"[^>]*aria-pressed="true"/);
    expect(markup).toMatch(/type="checkbox"[^>]*data-testid="provider-consent"/);
    expect(markup).not.toMatch(/data-testid="provider-consent"[^>]*disabled/);
  });
});
