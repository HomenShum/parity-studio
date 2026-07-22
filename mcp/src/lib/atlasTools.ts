import { z } from 'zod';
import atlas from '../generated/atlas.json' with { type: 'json' };

/**
 * The Atlas taxonomy is owned by shared/nodeslideAtlasRegistry.ts and projected into
 * src/generated/atlas.json by `pnpm atlas:export`. This module must never redeclare it —
 * a second copy of the schema in the MCP package is the duplication rule we already learned.
 */

interface McpServerLike {
  registerTool: (
    name: string,
    definition: {
      title: string;
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
      annotations?: Record<string, boolean>;
    },
    handler: (args: never) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ) => void;
}

type Archetype = (typeof atlas.archetypes)[number];
type SourcePolicy = (typeof atlas.sourcePolicies)[number];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const MAX_RESULTS = 50;

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) ?? 'null' }],
  };
}

function findArchetype(id: string): Archetype | undefined {
  return atlas.archetypes.find((entry) => entry.id === id);
}

function findSource(id: string): SourcePolicy | undefined {
  return atlas.sourcePolicies.find((entry) => entry.id === id);
}

function searchArchetypes(options: {
  text?: string;
  family?: string;
  requiresArtifactKind?: string;
  limit: number;
}): Archetype[] {
  const needle = options.text?.trim().toLowerCase() ?? '';
  const scored: { archetype: Archetype; score: number }[] = [];
  for (const archetype of atlas.archetypes) {
    if (options.family && archetype.family !== options.family) continue;
    if (
      options.requiresArtifactKind &&
      !archetype.requiredArtifactKinds.includes(options.requiresArtifactKind)
    ) {
      continue;
    }
    let score = 0;
    if (needle) {
      const inTitle = archetype.title.toLowerCase().includes(needle);
      const inJob = archetype.narrativeJob.toLowerCase().includes(needle);
      const inId = archetype.id.toLowerCase().includes(needle);
      if (!inTitle && !inJob && !inId) continue;
      score = (inTitle ? 4 : 0) + (inJob ? 2 : 0) + (inId ? 1 : 0);
    }
    scored.push({ archetype, score });
  }
  scored.sort((left, right) =>
    left.score === right.score
      ? left.archetype.id < right.archetype.id
        ? -1
        : 1
      : right.score - left.score,
  );
  return scored.slice(0, options.limit).map((entry) => entry.archetype);
}

/** Mirrors evaluateAtlasUsage in shared/nodeslideAtlas.ts: fail-closed, reasons always present. */
function evaluateUsage(
  policy: SourcePolicy | undefined,
  intents: readonly string[],
): { allowed: boolean; reasons: string[]; attributionRequired: boolean } {
  if (!policy) {
    return {
      allowed: false,
      reasons: ['No source policy is registered; unreviewed sources are denied.'],
      attributionRequired: true,
    };
  }
  const reasons: string[] = [];
  if (policy.status !== 'approved') {
    reasons.push(`Source ${policy.id} is ${policy.status}, not approved.`);
  }
  if (intents.length === 0) reasons.push('At least one usage intent must be declared.');

  const permissionByIntent = atlas.permissionByIntent as Record<string, string>;
  const ceiling = (atlas.accessModeCeiling as Record<string, readonly string[]>)[policy.accessMode];
  const permissions = policy.permissions as Record<string, boolean>;

  for (const intent of intents) {
    const permission = permissionByIntent[intent];
    if (!permission) {
      reasons.push(`Unknown usage intent ${intent} is denied.`);
      continue;
    }
    if (!ceiling?.includes(permission)) {
      reasons.push(`${intent} is impossible under access mode ${policy.accessMode}.`);
      continue;
    }
    if (permissions[permission] !== true) {
      reasons.push(`${intent} is not granted by source ${policy.id}.`);
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    attributionRequired: policy.attributionRequired !== false,
  };
}

export function registerAtlasTools(server: McpServerLike): void {
  server.registerTool(
    'atlas.search_archetypes',
    {
      title: 'Search NodeSlide Atlas slide archetypes',
      description:
        'Find slide archetypes by narrative job. Each result names the artifact the slide must actually contain and the substitutes that do not satisfy it, so an agent picks a real chart or diagram rather than prose describing one. Read-only; results are deterministic and capped.',
      inputSchema: {
        text: z.string().max(200).optional(),
        family: z.enum(atlas.families as unknown as [string, ...string[]]).optional(),
        requiresArtifactKind: z
          .enum(atlas.artifactKinds as unknown as [string, ...string[]])
          .optional(),
        limit: z.number().int().min(1).max(MAX_RESULTS).default(20),
      },
      annotations: READ_ONLY,
    },
    async (args: {
      text?: string;
      family?: string;
      requiresArtifactKind?: string;
      limit?: number;
    }) => {
      const results = searchArchetypes({
        text: args.text,
        family: args.family,
        requiresArtifactKind: args.requiresArtifactKind,
        limit: Math.min(args.limit ?? 20, MAX_RESULTS),
      });
      return textResult({ count: results.length, capped: MAX_RESULTS, results });
    },
  );

  server.registerTool(
    'atlas.inspect_archetype',
    {
      title: 'Inspect one NodeSlide Atlas archetype',
      description:
        'Return one archetype: its narrative job, the artifact kinds that satisfy it, and the named substitutes the topology gate rejects.',
      inputSchema: { archetypeId: z.string().min(1).max(120) },
      annotations: READ_ONLY,
    },
    async (args: { archetypeId: string }) => {
      const archetype = findArchetype(args.archetypeId);
      if (!archetype) {
        return textResult({
          error: `Unknown archetype ${args.archetypeId}.`,
          hint: 'Call atlas.search_archetypes first.',
        });
      }
      return textResult(archetype);
    },
  );

  server.registerTool(
    'atlas.list_sources',
    {
      title: 'List NodeSlide Atlas source policies',
      description:
        'List every reviewed Atlas source with its access lane and review status. Sources absent from this list are denied by default.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      textResult(
        atlas.sourcePolicies.map((policy) => ({
          id: policy.id,
          name: policy.name,
          accessMode: policy.accessMode,
          status: policy.status,
          licenseId: policy.licenseId ?? null,
          attributionRequired: policy.attributionRequired,
          competitiveUseRestricted: policy.competitiveUseRestricted,
        })),
      ),
  );

  server.registerTool(
    'atlas.check_usage',
    {
      title: 'Check whether an Atlas source permits a use',
      description:
        'Fail-closed licence gate. Answers whether a specific source may be downloaded, cached, displayed, redistributed, indexed for retrieval, or used for training. An unregistered source, an unapproved status, or a use above the access lane all deny, and every denial carries its reason. Call this before ingesting or reusing any external asset.',
      inputSchema: {
        sourceId: z.string().min(1).max(120),
        intents: z
          .array(z.enum(atlas.usageIntents as unknown as [string, ...string[]]))
          .min(1)
          .max(atlas.usageIntents.length),
      },
      annotations: READ_ONLY,
    },
    async (args: { sourceId: string; intents: string[] }) => {
      const decision = evaluateUsage(findSource(args.sourceId), args.intents);
      return textResult({ sourceId: args.sourceId, intents: args.intents, ...decision });
    },
  );

  server.registerTool(
    'atlas.check_topology',
    {
      title: 'Check a produced slide against its Atlas archetype',
      description:
        'The topology gate. Given the artifact kinds a rendered slide actually contains, report whether the archetype is satisfied or whether the slide fell back to a forbidden substitute such as prose standing in for an architecture diagram. Returns an empty violation list when the slide passes.',
      inputSchema: {
        archetypeId: z.string().min(1).max(120),
        producedArtifactKinds: z.array(z.string().max(40)).max(32),
        detectedSubstitutes: z.array(z.string().max(80)).max(32).optional(),
      },
      annotations: READ_ONLY,
    },
    async (args: {
      archetypeId: string;
      producedArtifactKinds: string[];
      detectedSubstitutes?: string[];
    }) => {
      const archetype = findArchetype(args.archetypeId);
      if (!archetype) {
        return textResult({ violations: [`Unknown archetype ${args.archetypeId}.`] });
      }
      const produced = new Set(args.producedArtifactKinds);
      const violations: string[] = [];
      if (!archetype.requiredArtifactKinds.some((kind) => produced.has(kind))) {
        violations.push(
          `${archetype.id} requires one of ${archetype.requiredArtifactKinds.join(', ')} but the slide produced ${
            args.producedArtifactKinds.length > 0
              ? args.producedArtifactKinds.join(', ')
              : 'nothing'
          }.`,
        );
      }
      for (const substitute of args.detectedSubstitutes ?? []) {
        if (archetype.forbiddenSubstitutes.includes(substitute)) {
          violations.push(`${archetype.id} forbids the substitute ${substitute}.`);
        }
      }
      return textResult({ archetypeId: archetype.id, passed: violations.length === 0, violations });
    },
  );
}
