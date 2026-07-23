import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const approvedNode24Pins = new Map([
  ['actions/checkout', 'df4cb1c069e1874edd31b4311f1884172cec0e10'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

describe('GitHub Actions runtime policy', () => {
  it('pins every remote action and locks first-party actions to approved Node 24 commits', async () => {
    const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
    const workflowFiles = (await readdir(workflowDirectory))
      .filter((file) => /\.ya?ml$/u.test(file))
      .sort();
    const seenFirstPartyActions = new Set();

    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = await readFile(new URL(workflowFile, workflowDirectory), 'utf8');
      const actionReferences = workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)/gmu);

      for (const [, action, reference] of actionReferences) {
        expect(reference, `${workflowFile}: ${action} must use an immutable commit`).toMatch(
          /^[0-9a-f]{40}$/u,
        );
        if (!action.startsWith('actions/')) continue;

        expect(
          approvedNode24Pins.has(action),
          `${workflowFile}: ${action} needs an audited Node 24 runtime pin`,
        ).toBe(true);
        expect(reference, `${workflowFile}: ${action} uses an unapproved runtime pin`).toBe(
          approvedNode24Pins.get(action),
        );
        seenFirstPartyActions.add(action);
      }
    }

    expect([...seenFirstPartyActions].sort()).toEqual([...approvedNode24Pins.keys()].sort());
  });
});
