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
        qaDogfoodRelay: true,
        qaFeatureId: 'nodebench.chat.declutter.v1',
        qaWorkflowLanes: ['new run', 'comment edit', 'export handoff'],
        includeRuntimeArchitecture: true,
        includeLockedSlugComparison: true,
        includeImplementationMap: true,
      },
    );

    expect(files['ui_kits/nodebench-web/design-slug-manifest.json']).toContain('nb.chat.composer');
    expect(files['ui_kits/nodebench-web/design-workflow.catalog.json']).toContain(
      'existing-app-to-ui-kit',
    );
    expect(files['ui_kits/nodebench-web/discovery.questions.json']).toContain(
      'Composer -> Reports',
    );
    expect(files['ui_kits/nodebench-web/open-design-takeaways.md']).toContain(
      'What Parity Studio Deliberately Does Differently',
    );
    expect(files['ui_kits/nodebench-web/DESIGN.md']).toContain('Source-First Design System');
    expect(files['ui_kits/nodebench-web/design-system.rules.json']).toContain(
      'parity.design-system-skills',
    );
    expect(files['ui_kits/nodebench-web/design-system.method.md']).toContain(
      'Design System And Skill Routing',
    );
    expect(files['ui_kits/nodebench-web/skill-routing.json']).toContain('locked-component-repair');
    expect(files['ui_kits/nodebench-web/skills.parity.md']).toContain('Approved Production Apply');
    expect(files['ui_kits/nodebench-web/post-decompose.process.json']).toContain('direction-cards');
    expect(files['ui_kits/nodebench-web/post-decompose.method.md']).toContain(
      'Post-Decompose Design Method',
    );
    expect(files['ui_kits/nodebench-web/direction-cards.json']).toContain('tech-utility-core');
    expect(files['ui_kits/nodebench-web/p0-checklist.md']).toContain('Every P0 must pass');
    expect(files['ui_kits/nodebench-web/five-d-critique.json']).toContain('delivery');
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
    expect(files['ui_kits/nodebench-web/proof.checklist.md']).toContain('QA dogfood packet');
    expect(files['ui_kits/nodebench-web/qa-dogfood.packet.json']).toContain(
      'nodebench.chat.declutter.v1',
    );
    expect(files['ui_kits/nodebench-web/snapshot-snippets.json']).toContain('nb.chat.composer');
    expect(files['ui_kits/nodebench-web/gmail-magic-resend.html']).toContain('Magic resend');
    expect(files['ui_kits/nodebench-web/remotion.storyboard.json']).toContain('comment edit');
    expect(files['ui_kits/nodebench-web/easier-to-read-submission.md']).toContain(
      'Workflow lanes covered',
    );
    expect(files['ui_kits/nodebench-web/figma.bridge.json']).toContain('figma-bridge');
    expect(files['figma/manifest.json']).toContain('Parity Studio Import');
    expect(files['figma/code.js']).toContain('figma.createPage');
  });

  it('can omit QA dogfood relay files for minimal missions', () => {
    const files = withDesignMissionFiles(
      { 'ui_kits/minimal/index.html': '<main>Minimal</main>' },
      'minimal',
      {
        request: 'minimal mission',
        qaDogfoodRelay: false,
      },
    );

    expect(files['ui_kits/minimal/qa-dogfood.packet.json']).toBeUndefined();
    expect(files['ui_kits/minimal/proof.checklist.md']).toContain(
      'QA dogfood relay intentionally skipped',
    );
  });

  it('renders prompt constraints for locked component workflows', () => {
    const block = designMissionPromptBlock({
      lockedComponents: ['Latest Public Research cards'],
      allowedChangeScope: 'approved-deltas',
    });
    expect(block).toContain('DESIGN-FIRST PARITY MISSION');
    expect(block).toContain('Latest Public Research cards');
    expect(block).toContain('approved-deltas');
    expect(block).toContain('design-workflow.catalog.json');
    expect(block).toContain('post-decompose.process.json');
    expect(block).toContain('skill-routing.json');
  });
});
