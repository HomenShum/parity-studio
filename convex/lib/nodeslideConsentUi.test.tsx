// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NodeSlideLanding } from '../../src/domains/nodeslide/components/NodeSlideLanding';
import {
  ProjectDialog,
  NODESLIDE_NEBIUS_BRIEF_CONSENT as UI_NEBIUS_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT as UI_OPENROUTER_CONSENT,
} from '../../src/domains/nodeslide/components/ProjectDialog';
import { AgentSessionProvider } from '../../src/domains/nodeslide/session/AgentSessionProvider';
import {
  NODESLIDE_NEBIUS_BRIEF_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
} from './nodeslideValidators';

describe('NodeSlide informed provider controls', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:nodeslide-consent-ui-test',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => undefined,
    });
  });

  afterEach(cleanup);

  it('recommends Nebius while keeping external egress ungranted by default', () => {
    render(
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
    const markup = document.body.innerHTML;

    expect(markup).toMatch(/data-testid="provider-deterministic"[^>]*aria-pressed="false"/);
    expect(markup).toMatch(/data-testid="provider-external"[^>]*aria-pressed="true"/);
    expect(markup).not.toMatch(/type="checkbox"[^>]*data-testid="provider-consent"[^>]*disabled/);
    expect(markup).toContain('Nebius');
    expect(markup).toContain('Sends the full brief to the selected named model through Nebius.');
    expect(markup).toContain('Allow external AI this session');
    expect(markup).toContain(
      'title="Allow selected external models and optional web research for this browser tab"',
    );
    expect(markup).toContain('data-testid="create-model-select"');
    expect(markup).toContain('data-testid="create-effort-select"');
    expect(markup).toContain('aria-label="Reasoning effort: Medium"');
    expect(markup).toContain('data-testid="create-file-input"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('name="nodeslide-preview-access-code"');
    expect(markup).toContain('autocomplete="off"');
    expect(markup).toContain('Add a deck title to continue.');
    expect(markup).toContain('Use World Cup data story');
    expect(markup).toContain('chart, formula, and image primitives');
    expect(markup).toMatch(/type="submit"[^>]*disabled[^>]*aria-describedby/);
  });

  it('renders admission failures inside the project dialog', () => {
    render(
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
    const markup = document.body.innerHTML;

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('That private-preview access code is not valid.');
  });

  it('uses the same versioned OpenRouter consent token in UI and server contracts', () => {
    expect(UI_OPENROUTER_CONSENT).toBe(NODESLIDE_OPENROUTER_BRIEF_CONSENT);
  });

  it('uses the same versioned Nebius consent token in UI and server contracts', () => {
    expect(UI_NEBIUS_CONSENT).toBe(NODESLIDE_NEBIUS_BRIEF_CONSENT);
  });

  it('recommends a live model and keeps consent inline before direct creation', () => {
    render(
      <AgentSessionProvider clientSessionId="session-test" storage={null}>
        <NodeSlideLanding
          clientSessionId="session-test"
          recentDecks={[]}
          creating={false}
          onCreate={() => undefined}
          onExploreSample={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );
    const markup = document.body.innerHTML;

    expect(markup).toContain('data-testid="nodeslide-landing"');
    expect(markup).toContain('What presentation should we build?');
    expect(markup).toContain('>GLM 5.2</span>');
    expect(markup).toContain('>Nebius</span>');
    expect(markup).toContain('data-testid="landing-effort-select"');
    expect(markup).toContain('aria-label="Reasoning effort: Medium"');
    expect(markup).toContain('data-testid="landing-file-input"');
    expect(markup).toContain('data-testid="landing-provider-consent"');
    expect(markup).not.toMatch(/data-testid="landing-provider-consent"[^>]*checked/);
    expect(markup).toContain('Attach data');
    expect(markup).toContain('Allow prompt + files');
    expect(markup).toContain(
      'title="Allow selected external models and optional web research for this browser tab"',
    );
    expect(markup).not.toContain('Consent resets immediately after submission.');
    expect(markup).not.toContain('Create directly');
    expect(markup).toContain('aria-label="Create presentation"');
    expect(markup).toContain('Explore the editable sample workspace');
    expect(markup).not.toContain('nodeslide-preview-access-code');
    expect(markup).not.toContain('NodeSlide inspector');
  });

  it('carries a root-composer draft into the detailed creation contract', () => {
    render(
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
    const markup = document.body.innerHTML;

    expect(markup).toContain('value="AI 2027 — Scenarios and Decisions"');
    expect(markup).toContain('Build an evidence-led AI 2027 scenario deck.');
    expect(markup).toMatch(/data-testid="provider-external"[^>]*aria-pressed="true"/);
    expect(markup).toContain('>Claude Sonnet 5</span>');
    expect(markup).toContain('and attached files');
    expect(markup).toMatch(
      /<button(?=[^>]*role="checkbox")(?=[^>]*data-testid="provider-consent")[^>]*>/,
    );
    expect(markup).not.toMatch(/data-testid="provider-consent"[^>]*disabled/);
  });
});
