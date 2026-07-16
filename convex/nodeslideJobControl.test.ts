import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./nodeslideJobControl.ts', import.meta.url)),
  'utf8',
);
const jobsSource = readFileSync(
  fileURLToPath(new URL('./nodeslideJobs.ts', import.meta.url)),
  'utf8',
);

describe('NodeSlide owner-authorized durable job controls', () => {
  it.each(['pause', 'resume', 'getFreshness'])(
    'gates %s by the job owner capability digest',
    (operation) => {
      const start = source.indexOf(`export const ${operation}`);
      const nextExport = source.indexOf('\nexport const ', start + 1);
      const body = source.slice(start, nextExport < 0 ? undefined : nextExport);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(body).toContain('findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey)');
    },
  );

  it('resumes the same workflow action instead of starting a duplicate job', () => {
    expect(source).toContain('workflow.restart(ctx, row.workflowId as WorkflowId');
    expect(source).toContain("'execute-create-deck'");
    expect(source).toContain("'execute-edit-proposal'");
    expect(source).not.toContain('workflow.start(');
  });

  it('keeps duplicate resume requests idempotent and preserves the existing receipt', () => {
    expect(source).toContain(
      "if (row.status !== 'paused') return publicNodeSlideJob(jobFromRow(row));",
    );
  });

  it('retains the existing owner-authorized terminal cancellation path', () => {
    const start = jobsSource.indexOf('export const cancel = mutation');
    const end = jobsSource.indexOf('\nexport const retry = mutation', start);
    const cancelBody = jobsSource.slice(start, end);
    expect(cancelBody).toContain('findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey)');
    expect(cancelBody).toContain('cancelNodeSlideJob(current, Date.now())');
    expect(cancelBody).toContain('workflow.cancel(ctx');
  });

  it('does not route pause or resume through acceptance or patch mutation code', () => {
    expect(source).not.toContain('acceptPatch');
    expect(source).not.toContain('applyPatch');
    expect(source).not.toContain('applyOps');
  });
});
