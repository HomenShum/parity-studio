/**
 * Atlas topology gate runner.
 *
 * Reads a PPTX shape-level inspection (NDJSON) and reports, per slide, whether the slide actually
 * contains the artifact its archetype requires.
 *
 * This exists because the current arena check is self-reported:
 *   scripts/render-artifact-arena.mjs:  result.plan?.artifactType === candidate.artifactType
 * That compares the generating model's own declaration against the request. A model that declares
 * "architecture" and emits three text boxes passes it. This runner never reads the plan — it reads
 * the shapes that ended up in the file.
 *
 * Usage:
 *   node scripts/nodeslide-atlas-topology-gate.mjs \
 *     --inspect <path.inspect.ndjson> \
 *     [--fixtures <atlas.json>] [--map <mapping.json>] [--json]
 *
 * Exit 1 on any violation. Slides whose archetype cannot be resolved are reported as UNGATED and
 * counted separately — an unknown type is never silently counted as a pass.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAtlasGates,
  resolveArchetypeId,
  resolveRequirementVerdict,
} from './lib/atlas-gates.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Map observed PPTX record kinds onto Atlas artifact kinds.
 *
 * Deliberately conservative. A drawing shape proves geometry exists; it does not prove the
 * geometry is a *correct* architecture. The gate's job is to catch the fallback-to-prose failure,
 * not to certify semantics — that remains the critics' job.
 */
/**
 * Artifact kinds a shape-level PPTX inspection can actually speak to.
 *
 * The inspection emits only `shape`, `textbox` and `image`. It cannot tell a screenshot from any
 * other picture, and it carries no signal at all for equations (OMML), code, evidence blocks or
 * scroll scenes. Those kinds are therefore *undetectable* at this inspection depth, and a slide
 * whose archetype requires one is reported INDETERMINATE — never violated. Accusing a slide on
 * the basis of an instrument that cannot see the thing would be a false positive.
 */
export const DETECTABLE_ARTIFACT_KINDS = Object.freeze([
  'text',
  'media',
  'diagram',
  'timeline',
  'chart',
  'table',
]);

/**
 * What a deep OOXML inspection can decide. Everything the shallow inspection can, plus the kinds
 * that have a distinct markup signature. `scrollytelling` is still absent and always will be:
 * a scroll-driven scene has no PowerPoint representation, so a PPTX can never evidence one.
 */
export const DEEP_DETECTABLE_ARTIFACT_KINDS = Object.freeze([
  ...DETECTABLE_ARTIFACT_KINDS,
  'equation',
  'code',
  'screenshot',
  // Engineered primitives — see nodeslide-pptx-inspect.mjs. `timeline` is a real c:dateAx time
  // axis; `evidence` is a claim hyperlinked to an external source relationship. Both were
  // previously undetectable, which made their archetypes unsatisfiable rather than merely unmet.
  'timeline',
  'evidence',
]);

/** Minimum drawn shapes before geometry is treated as a relationship artifact. */
const GEOMETRY_FLOOR = 3;

export function producedArtifactKindsFromRecords(records) {
  const kinds = new Set();
  let textShapes = 0;
  let drawnShapes = 0;
  let images = 0;

  for (const record of records) {
    if (record.kind === 'textbox') {
      textShapes += 1;
      kinds.add('text');
      continue;
    }
    if (record.kind === 'image') {
      images += 1;
      kinds.add('media');
      continue;
    }
    if (record.kind === 'shape') {
      drawnShapes += 1;
    }
  }

  // Weak evidence, and labelled as such by the caller. Drawn geometry proves shapes exist; it does
  // not prove they form a correct diagram. It is enough to catch the fallback-to-prose failure,
  // which is this gate's actual job.
  const geometryHeuristic = drawnShapes >= GEOMETRY_FLOOR;
  if (geometryHeuristic) {
    kinds.add('diagram');
    kinds.add('timeline');
    kinds.add('chart');
    kinds.add('table');
  }
  return {
    kinds: [...kinds].sort(),
    textShapes,
    drawnShapes,
    images,
    geometryHeuristic,
  };
}

/**
 * Atlas v2/v3 slide titles carry the artifact type after a chapter prefix, e.g.
 * "SYSTEMS · SYSTEM ARCHITECTURE" or "EVIDENCE TECHNICAL PROOF / OTEL TRACE".
 */
export function artifactTypeFromTitle(title) {
  if (typeof title !== 'string' || title.length === 0) return null;
  const tail = title.split(/[·/]/).at(-1) ?? title;
  const slug = tail
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : null;
}

function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    index += 1;
  }
  return flags;
}

export function groupRecordsBySlide(lines) {
  const slides = new Map();
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (record.kind === 'slide') {
      current = {
        slide: record.slide,
        title: record.title ?? '',
        counts: record.counts ?? null,
        records: [],
      };
      slides.set(record.slide, current);
      continue;
    }
    if (current) current.records.push(record);
  }
  return [...slides.values()].sort((left, right) => left.slide - right.slide);
}

/**
 * A deep inspection (scripts/nodeslide-pptx-inspect.mjs) emits `artifact` records that name the
 * kind directly, with the markup signal that justified it. When those are present they replace the
 * shape-count heuristic entirely — every kind is a direct observation.
 */
export function directObservation(records, counts) {
  const artifactRecords = records.filter((record) => record.kind === 'artifact');
  if (artifactRecords.length === 0) return null;

  // Presence and primacy are separate claims. A semantic object the inspection measured as
  // off-slide, negligible or fully occluded is present in the FILE and absent from the SLIDE, so
  // it must not satisfy an archetype — that is the hidden-decoy attack: a genuine 1x1 chart parked
  // at x=14in while 49 autoshapes draw the chart the audience actually sees. Only a kind whose
  // primacy was measured and failed is withdrawn; an unmeasured kind is left alone, because this
  // check must not silently start deciding kinds it cannot see.
  const hidden = new Map();
  for (const record of artifactRecords) {
    if (!record.primacy) continue;
    const current = hidden.get(record.artifactKind);
    // Any visible instance of a kind rescues it — a real chart plus a stray decoy is still a pass.
    if (record.primacy === 'visible') hidden.set(record.artifactKind, false);
    else if (current !== false) hidden.set(record.artifactKind, true);
  }

  const kinds = [...new Set(artifactRecords.map((record) => record.artifactKind))]
    .filter((kind) => hidden.get(kind) !== true)
    .sort();
  const withdrawn = [...hidden.entries()].filter(([, isHidden]) => isHidden).map(([kind]) => kind);

  return {
    kinds,
    withdrawnForPrimacy: withdrawn,
    evidence: artifactRecords.map((record) => `${record.artifactKind}: ${record.signal}`),
    textShapes: counts?.textRuns ?? 0,
    drawnShapes: counts?.shapes ?? 0,
    images: counts?.pictures ?? 0,
    geometryHeuristic: false,
    direct: true,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const json = flags.get('json') === true;
  const inspectPath = flags.get('inspect');
  if (typeof inspectPath !== 'string') {
    process.stderr.write('--inspect <path.inspect.ndjson> is required.\n');
    process.exit(1);
  }

  const atlas = JSON.parse(
    await readFile(path.join(rootDirectory, 'mcp', 'src', 'generated', 'atlas.json'), 'utf8'),
  );
  const gates = createAtlasGates(atlas);
  const archetypeIds = new Set(atlas.archetypes.map((entry) => entry.id));

  const mapping =
    typeof flags.get('map') === 'string'
      ? JSON.parse(await readFile(path.resolve(flags.get('map')), 'utf8'))
      : {};

  const fixturesByTitle = new Map();
  const fixturesBySlide = new Map();
  if (typeof flags.get('fixtures') === 'string') {
    const fixtureDoc = JSON.parse(await readFile(path.resolve(flags.get('fixtures')), 'utf8'));
    for (const fixture of fixtureDoc.fixtures ?? []) {
      if (fixture.title) fixturesByTitle.set(String(fixture.title).trim().toLowerCase(), fixture);
      const number = Number.parseInt(String(fixture.number ?? ''), 10);
      if (Number.isFinite(number)) fixturesBySlide.set(number, fixture);
    }
  }

  const slides = groupRecordsBySlide(
    (await readFile(path.resolve(inspectPath), 'utf8')).split('\n'),
  );

  const results = [];
  for (const slide of slides) {
    const observed =
      directObservation(slide.records, slide.counts) ??
      producedArtifactKindsFromRecords(slide.records);
    const fixture =
      fixturesByTitle.get(slide.title.trim().toLowerCase()) ?? fixturesBySlide.get(slide.slide);
    // The vocabulary map is keyed on short names ('hero-thesis'), but the v3 compiler emits fully
    // qualified ids ('narrative.hero-thesis'). Neither is wrong; nothing joined them, so every
    // slide fell to `ungated` — which reads as "no opinion" and is how 38 unjudged slides could
    // look like a clean run. An artifactType that IS a known archetype id needs no mapping.
    const knownArchetype = (value) =>
      typeof value === 'string' && archetypeIds.has(value) ? value : null;
    const archetypeId =
      resolveArchetypeId(fixture?.artifactType, mapping) ??
      knownArchetype(fixture?.artifactType) ??
      resolveArchetypeId(artifactTypeFromTitle(slide.title), mapping) ??
      null;

    if (!archetypeId) {
      results.push({
        slide: slide.slide,
        title: slide.title,
        status: 'ungated',
        observed,
        reason: fixture?.artifactType
          ? `artifactType ${fixture.artifactType} has no Atlas archetype mapping.`
          : 'No fixture or mapping resolved an archetype for this slide.',
      });
      continue;
    }

    // If this inspection cannot observe any kind the archetype requires, say so. A gate that
    // reports a violation it has no instrument to detect is worse than no gate.
    const archetype = gates.findArchetype(archetypeId);
    const detectable = observed.direct ? DEEP_DETECTABLE_ARTIFACT_KINDS : DETECTABLE_ARTIFACT_KINDS;
    const observable = archetype.requiredArtifactKinds.filter((kind) => detectable.includes(kind));
    if (observable.length === 0) {
      // Some artifacts cannot exist in PowerPoint at all — a scroll-driven scene has no OOXML
      // representation, so "richer inspection" would never help. For those the honest outcome is
      // not indeterminate forever: it is an accepted fallback, PROVIDED the recipe declared one in
      // advance AND the deck actually ships it (a real poster frame on the slide, not a promise).
      const undetectableFallback = fixture?.declaredFallback ?? null;
      // The deck must actually SHIP whatever it declared. A poster-frame fallback needs a real
      // image; a native-step-build fallback needs a real p:timing sequence. A slide that declares
      // either and ships neither is still a violation.
      const shipped =
        undetectableFallback?.capability === 'native-step-build'
          ? observed.kinds.includes('step-build')
          : observed.images > 0;
      if (undetectableFallback && shipped) {
        results.push({
          slide: slide.slide,
          title: slide.title,
          archetypeId,
          status: 'fallback-accepted',
          observed,
          reason: `${archetype.requiredArtifactKinds.join(' or ')} has no PowerPoint representation. The recipe declared a ${undetectableFallback.capability} fallback in advance and the slide ships it: ${undetectableFallback.behavior}`,
        });
        continue;
      }
      results.push({
        slide: slide.slide,
        title: slide.title,
        archetypeId,
        status: 'indeterminate',
        observed,
        reason: `A shape-level PPTX inspection cannot observe ${archetype.requiredArtifactKinds.join(' or ')}; richer inspection is required to gate this slide.`,
      });
      continue;
    }

    const violations = gates.topologyViolations({
      archetypeId,
      producedArtifactKinds: observed.kinds,
    });

    // Representation and verdict are orthogonal. `vector-flattened` describes WHAT WAS SEEN — real
    // drawn geometry standing in for a semantic object. It is not itself a verdict: a degraded
    // representation is a violation unless the recipe declared it as a fallback in advance.
    // Treating "flattened" as its own non-violating status was the rationalization this replaces.
    const observedRepresentation =
      violations.length === 0
        ? 'native-semantic'
        : observed.drawnShapes >= GEOMETRY_FLOOR
          ? 'vector-flattened'
          : 'absent';
    const declaredFallback = fixture?.declaredFallback ?? null;
    const decision = resolveRequirementVerdict({
      requiredArtifactKind: archetype.requiredArtifactKinds[0],
      observedRepresentation,
      declaredFallback,
    });

    if (decision.verdict !== 'pass') {
      results.push({
        slide: slide.slide,
        title: slide.title,
        archetypeId,
        status: decision.verdict,
        observedRepresentation,
        observed,
        reason: decision.reason,
        byteEvidence: {
          autoshapes: observed.drawnShapes,
          pictures: observed.images,
          semanticParts: 0,
        },
        violations,
      });
      continue;
    }

    results.push({
      slide: slide.slide,
      title: slide.title,
      archetypeId,
      status: 'passed',
      observedRepresentation,
      // A pass that leaned on the geometry heuristic is weaker than one backed by a direct
      // observation, and is reported as such rather than being folded into the pass count.
      evidenceStrength:
        violations.length === 0 && observed.geometryHeuristic && !observable.includes('text')
          ? 'geometry-heuristic'
          : 'direct',
      observed,
      violations,
    });
  }

  const violated = results.filter((entry) => entry.status === 'violation');
  const flattened = results.filter((entry) => entry.observedRepresentation === 'vector-flattened');
  const fallbackAccepted = results.filter((entry) => entry.status === 'fallback-accepted');
  const ungated = results.filter((entry) => entry.status === 'ungated');
  const indeterminate = results.filter((entry) => entry.status === 'indeterminate');
  const passed = results.filter((entry) => entry.status === 'passed');
  const heuristicPasses = passed.filter((entry) => entry.evidenceStrength === 'geometry-heuristic');

  const summary = {
    schemaVersion: 'nodeslide.atlas-topology-gate/v1',
    inspectPath,
    slides: results.length,
    passed: passed.length,
    passedByGeometryHeuristic: heuristicPasses.length,
    violated: violated.length,
    fallbackAccepted: fallbackAccepted.length,
    // A breakdown of the verdicts above, not a verdict of its own — every flattened slide is
    // already counted as a violation or an accepted fallback. Counting it separately would
    // double-count and push the decided fraction over 100%.
    observedVectorFlattened: flattened.length,
    indeterminate: indeterminate.length,
    ungated: ungated.length,
    // Coverage is stated so a run with few decided slides cannot read as a clean bill of health.
    gatedFraction:
      results.length === 0
        ? 0
        : (passed.length + violated.length + fallbackAccepted.length) / results.length,
    results,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `Atlas topology gate — ${inspectPath}`,
        `  slides        ${summary.slides}`,
        `  passed        ${summary.passed} (${summary.passedByGeometryHeuristic} on the geometry heuristic, not a direct observation)`,
        `  violated      ${summary.violated}`,
        `  fallback ok   ${summary.fallbackAccepted} (degraded, but the recipe declared it in advance)`,
        `  indeterminate ${summary.indeterminate} (this inspection cannot observe the required artifact)`,
        `  ungated       ${summary.ungated} (no archetype mapping)`,
        `  decided       ${(summary.gatedFraction * 100).toFixed(1)}% of slides — the rest are NOT passes`,
        '',
        `  of which observed as vector-flattened: ${summary.observedVectorFlattened}`,
        '  (real drawn geometry standing in for a semantic object — renders correctly,',
        '   carries no Edit Data, no series, no axis, no round-trip from structured input)',
        '',
        ...violated.map(
          (entry) =>
            `  VIOLATION slide ${entry.slide} "${entry.title}" — ${entry.archetypeId}\n    ${entry.reason}\n    bytes: ${entry.observed.drawnShapes} autoshapes, ${entry.observed.images} pictures, 0 semantic parts`,
        ),
        ...(indeterminate.length > 0
          ? [
              '',
              '  Indeterminate (needs richer inspection than shape counts):',
              ...indeterminate.map(
                (entry) => `    slide ${entry.slide} "${entry.title}" — ${entry.archetypeId}`,
              ),
            ]
          : []),
      ].join('\n'),
    );
    process.stdout.write('\n');
  }

  process.exit(violated.length > 0 ? 1 : 0);
}

if (
  import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
  process.argv[1]?.endsWith('nodeslide-atlas-topology-gate.mjs')
) {
  await main();
}
