import { describe, expect, it } from 'vitest';
import { buildOperatingContract, withOperatingContract } from './kitContract';

describe('kit operating contract', () => {
  it('backfills contract, QA, API, perf, and agent rule files', () => {
    const files = withOperatingContract(
      {
        'ui_kits/settings/index.html': '<html><body>Settings</body></html>',
        'ui_kits/settings/tokens.css': ':root { --color-brand: #c96442; }',
      },
      {
        slug: 'settings',
        sourceHtml: '<html><body>Settings user@example.com</body></html>',
        sourceType: 'platform-route',
        sourceUrl: 'http://localhost:3000/settings',
        byokMode: 'local-mcp-byok',
      },
    );

    expect(files['ui_kits/settings/parity.contract.json']).toContain('"slug": "settings"');
    expect(files['ui_kits/settings/performance.budget.json']).toContain('routeTransitionPerceivedMs');
    expect(files['ui_kits/settings/api-wiring.plan.md']).toContain('API wiring plan');
    expect(files['ui_kits/settings/qa.plan.md']).toContain('http://localhost:3000/settings');
    expect(files['.claude/skills/settings/SKILL.md']).toContain('name: parity-settings');
    expect(files['AGENTS.md']).toContain('Local MCP BYOK keys stay in local env');
  });

  it('stores source provenance without storing provider key values', () => {
    const contract = buildOperatingContract({
      slug: 'checkout',
      sourceHtml: '<main>Checkout</main>',
      prompt: 'Checkout flow',
      byokMode: 'local-mcp-byok',
    });

    expect(contract.source.htmlHash).toMatch(/^fnv1a32:/);
    expect(JSON.stringify(contract)).toContain('Local MCP BYOK');
    expect(JSON.stringify(contract)).not.toContain('sk-');
  });
});
