import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstRunDialog } from '../../src/domains/nodeslide/components/FirstRunDialog';
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
      <FirstRunDialog open onCreate={() => undefined} onExplore={() => undefined} />,
    );

    expect(markup).toContain('Deterministic by default · OpenRouter opt-in');
    expect(markup).toContain('Your new-deck brief stays');
    expect(markup).toContain('OpenRouter is optional and receives the full brief only');
  });
});
