import { describe, expect, it } from 'vitest';
import { designMissionPromptBlock, withDesignMissionFiles } from './designMission.js';

describe('designMission', () => {
  it('adds durable design-first mission files to a ui_kit', () => {
    const files = withDesignMissionFiles(
      { 'ui_kits/nodebench-web/index.html': '<main>NodeBench</main>' },
      'nodebench-web',
      {
        request: 'iterate the design and UI slugs first',
        targetFlow: 'Composer -> Reports',
        lockedSlugs: ['nb.chat.composer', 'nb.reports.activity-card'],
        lockedComponents: ['Chat thread shell', 'Reports card grid'],
        allowedChangeScope: 'design-only',
        proofMedia: true,
        figmaBridge: true,
        includeRuntimeArchitecture: true,
        includeLockedSlugComparison: true,
        includeImplementationMap: true,
      },
    );

    expect(files['ui_kits/nodebench-web/design-slug-manifest.json']).toContain('nb.chat.composer');
    expect(files['ui_kits/nodebench-web/ui-slugs.json']).toContain('locked');
    expect(files['ui_kits/nodebench-web/locked-components.md']).toContain('Chat thread shell');
    expect(files['ui_kits/nodebench-web/decomposed-comparison.html']).toContain(
      'Current decomposition',
    );
    expect(files['ui_kits/nodebench-web/runtime-architecture.md']).toContain('Frontend Change Map');
    expect(files['ui_kits/nodebench-web/runtime-architecture.json']).toContain(
      'local MCP environment only',
    );
    expect(files['ui_kits/nodebench-web/runtime-architecture.html']).toContain(
      'Runtime Architecture Handoff',
    );
    expect(files['ui_kits/nodebench-web/design.plan.md']).toContain('Composer -> Reports');
    expect(files['ui_kits/nodebench-web/proof.checklist.md']).toContain('MP4/GIF proof');
    expect(files['ui_kits/nodebench-web/figma.bridge.json']).toContain('bridge-ready');
  });

  it('renders prompt constraints for locked component workflows', () => {
    const block = designMissionPromptBlock({
      lockedComponents: ['Latest Public Research cards'],
      allowedChangeScope: 'approved-deltas',
    });
    expect(block).toContain('DESIGN-FIRST PARITY MISSION');
    expect(block).toContain('Latest Public Research cards');
    expect(block).toContain('approved-deltas');
  });
});
