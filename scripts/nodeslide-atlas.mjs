import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `nodeslide atlas — search and audit the NodeSlide Artifact Atlas

Usage:
  node scripts/nodeslide-atlas.mjs search [text]        Find archetypes by narrative job
    --family <family>       Restrict to one artifact family
    --kind <artifactKind>   Require an archetype that demands this artifact kind
    --limit <n>             Cap results (default 20, hard cap 50)

  node scripts/nodeslide-atlas.mjs inspect <archetypeId>
      Show one archetype: its job, required artifact, forbidden substitutes

  node scripts/nodeslide-atlas.mjs sources
      List every registered source policy and its lane

  node scripts/nodeslide-atlas.mjs explain-license <sourceId>
      Show exactly which uses a source permits and which its lane forbids

  node scripts/nodeslide-atlas.mjs check-usage <sourceId> <intent> [intent...]
      Run the fail-closed usage gate. Exit 1 when the use is not permitted.

  node scripts/nodeslide-atlas.mjs validate
      Validate the seeded registry. Exit 1 on any violation.

  node scripts/nodeslide-atlas.mjs export [--out <path>]
      Emit the canonical Atlas as JSON for consumers that cannot import shared/.
      Defaults to mcp/src/generated/atlas.json. Validates before writing.

Global:
  --json    Emit machine-readable JSON instead of text
`;

function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  return { positional, flags };
}

function emit(json, payload, renderText) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderText()}\n`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];
const json = flags.get('json') === true;

if (!command || command === 'help' || flags.get('help') === true) {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 1);
}

const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  logLevel: 'silent',
  server: { hmr: false, middlewareMode: true },
  // This CLI only SSR-loads a few shared modules. Client dep discovery would crawl every HTML
  // entry in the repo and write its scan errors into the output an agent is meant to parse.
  optimizeDeps: { noDiscovery: true, include: [] },
});

let exitCode = 0;
try {
  const [atlas, registry, validation] = await Promise.all([
    vite.ssrLoadModule('/shared/nodeslideAtlas.ts'),
    vite.ssrLoadModule('/shared/nodeslideAtlasRegistry.ts'),
    vite.ssrLoadModule('/shared/nodeslideAtlasValidation.ts'),
  ]);

  switch (command) {
    case 'search': {
      const text = positional.slice(1).join(' ').trim();
      const limitFlag = Number.parseInt(String(flags.get('limit') ?? '20'), 10);
      const results = registry.searchAtlasArchetypes({
        text: text || undefined,
        family: typeof flags.get('family') === 'string' ? flags.get('family') : undefined,
        requiresArtifactKind: typeof flags.get('kind') === 'string' ? flags.get('kind') : undefined,
        limit: Number.isFinite(limitFlag) ? limitFlag : 20,
      });
      if (results.length === 0) exitCode = 1;
      emit(json, { query: text, count: results.length, results }, () =>
        results.length === 0
          ? `No archetype matches ${JSON.stringify(text)}.`
          : results
              .map(
                (entry) =>
                  `${entry.id}\n  family    ${entry.family}\n  job       ${entry.narrativeJob}\n  requires  ${entry.requiredArtifactKinds.join(' | ')}`,
              )
              .join('\n\n'),
      );
      break;
    }

    case 'inspect': {
      const id = positional[1];
      const archetype = id ? registry.findAtlasArchetype(id) : undefined;
      if (!archetype) {
        exitCode = 1;
        emit(
          json,
          { error: `Unknown archetype ${id ?? '<missing>'}.` },
          () => `Unknown archetype ${id ?? '<missing>'}.`,
        );
        break;
      }
      emit(json, archetype, () =>
        [
          archetype.id,
          `  title              ${archetype.title}`,
          `  family             ${archetype.family}`,
          `  narrative job      ${archetype.narrativeJob}`,
          `  required artifact  ${archetype.requiredArtifactKinds.join(' | ')}`,
          `  forbidden          ${archetype.forbiddenSubstitutes.join(', ')}`,
        ].join('\n'),
      );
      break;
    }

    case 'sources': {
      const policies = registry.NODESLIDE_ATLAS_SOURCE_POLICIES;
      emit(json, policies, () =>
        policies
          .map(
            (policy) =>
              `${policy.id.padEnd(30)} ${policy.accessMode.padEnd(20)} ${policy.status}${
                policy.competitiveUseRestricted ? '  [competitive use restricted]' : ''
              }`,
          )
          .join('\n'),
      );
      break;
    }

    case 'explain-license': {
      const id = positional[1];
      const policy = id ? registry.findAtlasSourcePolicy(id) : undefined;
      if (!policy) {
        exitCode = 1;
        emit(
          json,
          { error: `Unknown source ${id ?? '<missing>'}.` },
          () => `Unknown source ${id ?? '<missing>'}. Unreviewed sources are denied by default.`,
        );
        break;
      }
      const ceiling = atlas.ATLAS_ACCESS_MODE_CEILING[policy.accessMode] ?? [];
      const rows = atlas.ATLAS_USAGE_INTENTS.map((intent) => {
        const permission = atlas.ATLAS_PERMISSION_BY_INTENT[intent];
        const decision = atlas.evaluateAtlasUsage(policy, [intent]);
        const blockedByLane = !ceiling.includes(permission);
        return {
          intent,
          allowed: decision.allowed,
          blockedBy: decision.allowed
            ? null
            : blockedByLane
              ? `access mode ${policy.accessMode}`
              : 'source permission',
        };
      });
      emit(json, { policy, rows }, () =>
        [
          `${policy.name} (${policy.id})`,
          `  lane          ${policy.accessMode}`,
          `  status        ${policy.status}`,
          `  licence       ${policy.licenseId ?? 'not declared'}`,
          `  attribution   ${policy.attributionRequired ? 'required' : 'not required'}`,
          `  competitive   ${policy.competitiveUseRestricted ? 'restricted' : 'unrestricted'}`,
          '',
          ...rows.map(
            (row) =>
              `  ${row.allowed ? 'ALLOW' : 'DENY '} ${row.intent.padEnd(24)}${
                row.blockedBy ? `blocked by ${row.blockedBy}` : ''
              }`,
          ),
        ].join('\n'),
      );
      break;
    }

    case 'check-usage': {
      const id = positional[1];
      const intents = positional.slice(2);
      const policy = id ? registry.findAtlasSourcePolicy(id) : undefined;
      const decision = atlas.evaluateAtlasUsage(policy, intents);
      if (!decision.allowed) exitCode = 1;
      emit(json, { sourceId: id, intents, ...decision }, () =>
        decision.allowed
          ? `ALLOWED: ${intents.join(', ')} on ${id}${
              decision.attributionRequired ? ' (attribution required)' : ''
            }`
          : `DENIED: ${intents.join(', ')} on ${id ?? '<missing>'}\n${decision.reasons
              .map((reason) => `  - ${reason}`)
              .join('\n')}`,
      );
      break;
    }

    case 'validate': {
      const failures = [];
      for (const policy of registry.NODESLIDE_ATLAS_SOURCE_POLICIES) {
        const result = validation.validateAtlasSourcePolicy(policy);
        if (!result.ok) failures.push({ subject: `source:${policy.id}`, errors: result.errors });
      }
      const seenArchetypes = new Set();
      for (const archetype of registry.NODESLIDE_ATLAS_ARCHETYPES) {
        const errors = [];
        if (seenArchetypes.has(archetype.id)) errors.push('Duplicate archetype id.');
        seenArchetypes.add(archetype.id);
        if (!atlas.ATLAS_ARTIFACT_FAMILIES.includes(archetype.family)) {
          errors.push(`Unknown family ${archetype.family}.`);
        }
        if (archetype.requiredArtifactKinds.length === 0) {
          errors.push('Archetype requires no artifact, so nothing can satisfy it.');
        }
        for (const kind of archetype.requiredArtifactKinds) {
          if (!atlas.ATLAS_ARTIFACT_KINDS.includes(kind)) {
            errors.push(`Unknown required artifact kind ${kind}.`);
          }
        }
        if (!archetype.id.startsWith(`${archetype.family}.`)) {
          errors.push('Archetype id must be namespaced by its family.');
        }
        if (errors.length > 0) failures.push({ subject: `archetype:${archetype.id}`, errors });
      }
      if (failures.length > 0) exitCode = 1;
      emit(
        json,
        {
          ok: failures.length === 0,
          archetypes: registry.NODESLIDE_ATLAS_ARCHETYPES.length,
          sources: registry.NODESLIDE_ATLAS_SOURCE_POLICIES.length,
          failures,
        },
        () =>
          failures.length === 0
            ? `Atlas registry is valid: ${registry.NODESLIDE_ATLAS_ARCHETYPES.length} archetypes, ${registry.NODESLIDE_ATLAS_SOURCE_POLICIES.length} source policies.`
            : failures
                .map(
                  (failure) =>
                    `${failure.subject}\n${failure.errors.map((e) => `  - ${e}`).join('\n')}`,
                )
                .join('\n\n'),
      );
      break;
    }

    case 'export': {
      // The MCP package cannot import shared/, so it consumes a generated projection instead of
      // holding a second copy of the taxonomy. shared/ stays the only owner of the schema.
      const invalid = registry.NODESLIDE_ATLAS_SOURCE_POLICIES.map((policy) => ({
        id: policy.id,
        result: validation.validateAtlasSourcePolicy(policy),
      })).filter((entry) => !entry.result.ok);
      if (invalid.length > 0) {
        exitCode = 1;
        emit(
          json,
          { error: 'Refusing to export an invalid registry.', invalid },
          () =>
            `Refusing to export: ${invalid.map((entry) => entry.id).join(', ')} failed validation.`,
        );
        break;
      }
      const outPath = path.resolve(
        rootDirectory,
        typeof flags.get('out') === 'string'
          ? flags.get('out')
          : path.join('mcp', 'src', 'generated', 'atlas.json'),
      );
      const payload = {
        generatedFrom: 'shared/nodeslideAtlasRegistry.ts',
        schemaVersion: atlas.NODESLIDE_ATLAS_SCHEMA_VERSION,
        sourcePolicyVersion: atlas.NODESLIDE_ATLAS_SOURCE_POLICY_VERSION,
        families: atlas.ATLAS_ARTIFACT_FAMILIES,
        artifactKinds: atlas.ATLAS_ARTIFACT_KINDS,
        usageIntents: atlas.ATLAS_USAGE_INTENTS,
        permissionByIntent: atlas.ATLAS_PERMISSION_BY_INTENT,
        accessModeCeiling: atlas.ATLAS_ACCESS_MODE_CEILING,
        archetypes: registry.NODESLIDE_ATLAS_ARCHETYPES,
        sourcePolicies: registry.NODESLIDE_ATLAS_SOURCE_POLICIES,
      };
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      emit(
        json,
        {
          written: outPath,
          archetypes: payload.archetypes.length,
          sources: payload.sourcePolicies.length,
        },
        () =>
          `Exported ${payload.archetypes.length} archetypes and ${payload.sourcePolicies.length} source policies to ${path.relative(rootDirectory, outPath)}.`,
      );
      break;
    }

    default: {
      exitCode = 1;
      process.stderr.write(`Unknown command ${command}.\n\n${USAGE}`);
    }
  }
} catch (error) {
  exitCode = 1;
  process.stderr.write(
    `nodeslide atlas failed: ${error instanceof Error ? error.message : error}\n`,
  );
} finally {
  await vite.close();
}

process.exit(exitCode);
