import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';

function projectTitle(input: string | undefined, fallback: string): string {
  const trimmed = input?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

export const list = query({
  args: {
    clientSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clientSessionId, limit }) => {
    const cap = Math.min(Math.max(limit ?? 24, 1), 100);
    let projects: Doc<'projects'>[];
    try {
      projects =
        clientSessionId !== undefined
          ? await ctx.db
              .query('projects')
              .withIndex('by_session_updated', (q) => q.eq('clientSessionId', clientSessionId))
              .order('desc')
              .take(cap)
          : await ctx.db.query('projects').withIndex('by_updated').order('desc').take(cap);
    } catch {
      const rows = await ctx.db
        .query('projects')
        .order('desc')
        .take(cap * 10);
      projects =
        clientSessionId !== undefined
          ? rows.filter((project) => project.clientSessionId === clientSessionId).slice(0, cap)
          : rows.slice(0, cap);
    }

    return await Promise.all(
      projects.map(async (project) => {
        let runs: Doc<'runs'>[];
        try {
          runs = await ctx.db
            .query('runs')
            .withIndex('by_project', (q) => q.eq('projectId', project._id))
            .order('desc')
            .take(50);
        } catch {
          runs = (await ctx.db.query('runs').order('desc').take(250))
            .filter((run) => run.projectId === project._id)
            .slice(0, 50);
        }
        const latest = runs[0] ?? null;
        return {
          ...project,
          latestRunId: latest?._id ?? null,
          latestStatus: latest?.status ?? null,
          runCount: runs.length,
          totalCostMicroUsd: runs.reduce((sum, run) => sum + run.costMicroUsd, 0),
        };
      }),
    );
  },
});

export const rename = mutation({
  args: {
    projectId: v.id('projects'),
    title: v.string(),
    clientSessionId: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, title, clientSessionId }) => {
    const project = await ctx.db.get(projectId);
    if (project === null) throw new Error('projects:rename - project not found');
    if (clientSessionId !== undefined && project.clientSessionId !== clientSessionId) {
      throw new Error('projects:rename - session mismatch');
    }
    await ctx.db.patch(projectId, {
      title: projectTitle(title, project.title),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const toggleStar = mutation({
  args: {
    projectId: v.id('projects'),
    clientSessionId: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, clientSessionId }) => {
    const project = await ctx.db.get(projectId);
    if (project === null) throw new Error('projects:toggleStar - project not found');
    if (clientSessionId !== undefined && project.clientSessionId !== clientSessionId) {
      throw new Error('projects:toggleStar - session mismatch');
    }
    await ctx.db.patch(projectId, {
      starred: !project.starred,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});
