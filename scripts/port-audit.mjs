/**
 * Port audit — the gate that must pass before any NodeSlide code is deleted from parity-studio.
 *
 * Phase 2 of docs/DECOUPLING_PLAN.md. The plan's sequencing rule is that nothing is removed until
 * the phase that proves it is elsewhere has exited, and "looks done" does not exit a phase. So this
 * runner never reads a hand-written inventory. It derives both sides:
 *
 *   source      every exported symbol under src/domains/nodeslide/**, parsed with the TypeScript
 *               compiler API — a commented-out `export` is a comment, and never counts
 *   source      every scripts/nodeslide-* file
 *   destination every exported symbol under the destination repo's source roots, parsed the same
 *               way, plus its scripts/ listing
 *
 * An item is PORTED when the destination exports the same symbol (preferring the same relative
 * path, falling back to the same name anywhere in the destination), RENAMED when the RENAMES table
 * below maps it to a destination symbol that exists, and MISSING otherwise. Any MISSING exits 1.
 *
 * Usage:
 *   node scripts/port-audit.mjs [--destination <repo>] [--against <git-ref>]
 *                               [--receipt <path>] [--json]
 *
 * --against resolves the destination files from a git ref instead of its working tree, without
 * touching that checkout (ls-tree + cat-file, never a checkout). It exists so the gate can be shown
 * to fail: point it at a destination commit from before the ports landed and it must go red. An
 * audit that cannot fail is not a gate, so the revert probe is part of the contract, not a bonus.
 *
 * The default reads the destination working tree, but REFUSES it unless that tree is a clean
 * checkout of main. Pass --allow-working-tree to grade an in-flight port deliberately.
 *
 * That refusal exists because the permissive version produced a false PASS. On 2026-07-27 this
 * audit reported the agent-session cluster as 0 MISSING / 79 PORTED. It had read the shared
 * nodeslide checkout, which a concurrent agent had left dirty on a feature branch carrying an
 * unmerged copy of exactly those files. Measured against origin/main, all 79 were absent. The gate
 * was not wrong about what it read — it read something nobody ships, which is worse, because the
 * number looked like good news.
 *
 * The receipt always records which tree was read — ref, resolved sha, branch, dirty, and whether a
 * flag waived the check — so no reader can mistake one run for another.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const RECEIPT_SCHEMA_VERSION = 'parity.port-audit/v1';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything under here is what Phase 3 proposes to delete, so everything under here is audited. */
const SOURCE_DOMAIN_ROOT = 'src/domains/nodeslide';
/** Phase 1 item 3: the 37 gates that ship a product built from a different repo. */
const SOURCE_SCRIPT_PREFIX = 'nodeslide-';

/**
 * NodeSlide code that does NOT live under the domain root.
 *
 * The first version audited the domain directory and the gate scripts, and reported 780 items. The
 * triage then found 46 `shared/nodeslide*.ts` and 49 `convex/nodeslide*.ts` modules — the job
 * runner, the session store, the uploads path, the data export — that the audit had never looked
 * at. It could therefore have gone green while the backend behind half the interface was still
 * stranded here.
 *
 * That is the same defect this gate exists to prevent, one layer up: a check whose scope is
 * narrower than the claim it is used to support. The scope is now derived from the naming
 * convention rather than from a directory I happened to think of.
 */
const SOURCE_PREFIXED_ROOTS = [
  { root: 'shared', prefix: 'nodeslide' },
  { root: 'convex', prefix: 'nodeslide' },
  { root: 'mcp/src', prefix: 'nodeslide' },
];

/**
 * Where a ported symbol is allowed to land in the destination.
 *
 * Broader than the source root on purpose: a port is free to move a file. Narrowing this to
 * src/domains/nodeslide would report relocations as MISSING, which is a false red, and a gate that
 * cries wolf gets waived. The receipt records the destination path of every match, so a match found
 * outside the mirrored path is visible rather than silently accepted.
 */
const DESTINATION_SOURCE_ROOTS = ['src', 'convex', 'shared', 'contracts', 'packages', 'mcp/src'];
const DESTINATION_SCRIPT_ROOT = 'scripts';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * Renames, as reviewable data.
 *
 * Each entry is an assertion that a name changed in transit and that the change was intended. The
 * reason is required by convention here because an unexplained rename entry is indistinguishable
 * from a way to silence a real MISSING — which is the one thing this table must never become.
 *
 * `from` is the audit item id: `symbol:<source path>#<name>` or `script:<basename>`.
 * `to` is the destination symbol name, or for scripts the destination repo-relative path.
 *
 * Empty is the correct state until a port actually renames something. Do not pre-populate it.
 *
 * A NEAR MISS worth recording, because the next reader will be tempted by it. The jsonSpec port
 * found that `exportNodeSlideJson` (parity) and `downloadDeckJson` (destination) do overlapping
 * work, which looks exactly like a rename. It is not one, and adding it here would be the first
 * dishonest entry: the destination's symbol is the WEAKER of the two — no versioned envelope, no
 * schema validation — while carrying a compilation gate parity's lacks. Neither supersedes the
 * other. An entry here would mark the item PORTED and silence a real capability gap, which is
 * precisely the failure mode named above. Partial overlap belongs in docs/PORT_TRIAGE.md as a
 * divergence, not here as an equivalence.
 */
/**
 * Symbols that moved under a different name. A rename is only legitimate when the destination
 * genuinely EXPORTS the target — otherwise the entry marks a dropped symbol as ported, which is the
 * one thing this audit exists to prevent.
 *
 * Every entry below was verified twice before landing: the target must appear in an `export`
 * statement in a NON-TEST module of the destination. A first mechanical Workspace->Deck substitution
 * produced 20 candidates; 7 of them named symbols that were DELETED rather than renamed
 * (createWorkspace, createProject, getWorkspace, getProject, attachDeck, NodeSlideWorkspaceSummary,
 * NodeSlideWorkspaceProjectSummary) and would have inflated the pass count. One candidate,
 * `createDeck`, matched an unrelated pre-existing symbol in a test file — a word's presence is not
 * its role, and a grep for a bare name is not proof of an export.
 */
const RENAMES = [
  // OpenUI visual-material lab (docs/PORT_TRIAGE.md §6, owner decision 2026-07-28: "we keeping
  // openui"). Hazard 1 of that section is a name collision the audit is structurally blind to:
  // the destination already ships a `VisualMaterial` family — NodeSlideVisualMaterial,
  // NodeSlideVisualMaterialKind, NodeSlideVisualMaterialStatus, NodeSlideVisualMaterialInventory
  // in convex/lib/nodeslideStoryContext.ts, read by nodeslideDesignPlan.ts — that models the
  // EVIDENCE a deck can be built from. Parity's family models a RENDERABLE SLIDE SPEC. Two
  // vocabularies, one set of nouns. The destination's family keeps the name it shipped with and
  // the incoming one takes an `OpenUi` prefix, which is also the more accurate name for it: the
  // family exists to feed the OpenUI Lang renderer.
  //
  // Every `to` below was verified to appear in an `export` statement of a NON-TEST destination
  // module before this table was written — the docstring above explains why that order matters,
  // and the four symbols that did NOT change name (NODESLIDE_OPENUI_ACTION,
  // NODESLIDE_OPENUI_PROGRAM_VERSION, AI2027_OPENUI_PROGRAM, AI2027_TRANSFORMATION_LADDER) are
  // deliberately absent from this table: they resolve as PORTED on their own names, and adding
  // them here would be a rename entry asserting a change that never happened.
  ...[
    // src/domains/nodeslide/openui/visualMaterials.ts -> openui/openUiMaterials.ts
    ['NODESLIDE_VISUAL_MATERIAL_VERSION', 'NODESLIDE_OPENUI_MATERIAL_VERSION'],
    ['VisualMaterialClaim', 'OpenUiMaterialClaim'],
    ['VisualMaterialSpec', 'OpenUiMaterialSpec'],
    ['VisualMaterialValidation', 'OpenUiMaterialValidation'],
    ['validateVisualMaterialSpec', 'validateOpenUiMaterialSpec'],
    ['compileVisualMaterialProposal', 'compileOpenUiMaterialProposal'],
  ].map(([from, to]) => ({
    from: `symbol:src/domains/nodeslide/openui/visualMaterials.ts#${from}`,
    to,
    reason:
      'OpenUI port: destination already owns a VisualMaterial family for deck-building evidence; the incoming renderable-spec family takes the OpenUi prefix',
  })),

  ...[
    // src/domains/nodeslide/openui/VisualMaterialWorkbench.tsx -> openui/OpenUiMaterialWorkbench.tsx
    ['VisualMaterialWorkbench', 'OpenUiMaterialWorkbench'],
    ['VisualMaterialWorkbenchProps', 'OpenUiMaterialWorkbenchProps'],
    ['nodeslideVisualMaterialLibrary', 'nodeslideOpenUiMaterialLibrary'],
  ].map(([from, to]) => ({
    from: `symbol:src/domains/nodeslide/openui/VisualMaterialWorkbench.tsx#${from}`,
    to,
    reason:
      'OpenUI port: destination already owns a VisualMaterial family for deck-building evidence; the incoming renderable-spec family takes the OpenUi prefix',
  })),

  // D1 flat rewrite (DECOUPLING_PLAN.md §8): no workspace or project exists in the destination, so
  // the workspace>project>deck scope tree was re-rooted at the deck. Source module
  // convex/lib/nodeslideScopeAccess.ts became convex/lib/nodeslideDeckScopeAccess.ts.
  ...[
    ['NodeSlideWorkspaceRole', 'NodeSlideDeckRole'],
    ['NodeSlideWorkspaceCapability', 'NodeSlideDeckCapability'],
    ['NodeSlideWorkspaceAccessPolicy', 'NodeSlideDeckAccessPolicy'],
    ['NodeSlideWorkspaceAccessRequest', 'NodeSlideDeckAccessRequest'],
    ['NodeSlideWorkspaceAccessDecision', 'NodeSlideDeckAccessDecision'],
    ['normalizeNodeSlideWorkspaceAccessPolicy', 'normalizeNodeSlideDeckAccessPolicy'],
    ['isNodeSlideWorkspaceAccessPolicy', 'isNodeSlideDeckAccessPolicy'],
    ['narrowNodeSlideWorkspaceAccessPolicy', 'narrowNodeSlideDeckAccessPolicy'],
    ['evaluateNodeSlideWorkspaceAccess', 'evaluateNodeSlideDeckAccess'],
    ['nodeSlideWorkspaceCapabilitiesForRole', 'nodeSlideDeckCapabilitiesForRole'],
  ].map(([from, to]) => ({
    from: `symbol:convex/lib/nodeslideScopeAccess.ts#${from}`,
    to,
    reason: 'D1 flat rewrite: no workspace exists; scope re-rooted at the deck',
  })),

  // convex/nodeslideWorkspaceAccess.ts became convex/nodeslideDeckGrants.ts. Grant issuance,
  // revocation and listing survived; workspace and project CRUD was dropped, not renamed.
  {
    from: 'symbol:convex/nodeslideWorkspaceAccess.ts#NodeSlideWorkspaceGrantSummary',
    to: 'NodeSlideDeckGrantSummary',
    reason: 'D1 flat rewrite: grants are deck-scoped',
  },
  {
    from: 'symbol:convex/nodeslideWorkspaceAccess.ts#NodeSlideAttachedDeckSummary',
    to: 'NodeSlideGrantedDeckSummary',
    reason: 'D1 flat rewrite: a deck is granted, not attached to a project',
  },
  {
    from: 'symbol:convex/nodeslideWorkspaceAccess.ts#getAttachedDeck',
    to: 'getGrantedDeck',
    reason: 'D1 flat rewrite: a deck is granted, not attached to a project',
  },];

/**
 * Source items that must NOT move, with the reason each one stays.
 *
 * This is not a waiver list for things that are merely inconvenient to port. Every entry has to be
 * something whose correct home is parity, so that "MISSING from nodeslide" is the right answer
 * rather than a finding. The audit prints these separately from PORTED so that a reader can see
 * what was exempted and argue with it — an exemption folded into the pass count is indistinguishable
 * from a port that happened.
 *
 * Keep this short. A growing list here means the audit is being negotiated with.
 */
const STAYS_IN_PARITY = [
  {
    id: 'script:nodeslide-freeze-gate.mjs',
    reason:
      "It is parity's own gate: it refuses new NodeSlide work in this repo. Moving it to nodeslide would delete the freeze it enforces, and the audit would have been the thing that asked for it.",
  },
];

const { flags, showHelp } = parseArgs(process.argv.slice(2));
if (showHelp) {
  process.stdout.write(`${readUsage()}\n`);
  process.exit(0);
}

const destinationRoot = path.resolve(
  rootDirectory,
  flags.get('destination') ?? process.env.PORT_AUDIT_DESTINATION ?? '../nodeslide',
);
const against = typeof flags.get('against') === 'string' ? flags.get('against') : null;
const receiptPath = path.resolve(
  rootDirectory,
  typeof flags.get('receipt') === 'string'
    ? flags.get('receipt')
    : 'artifacts/port-audit/port-audit.json',
);
const emitJson = flags.get('json') === true;
/** Opt in to grading an unclean or off-main destination checkout. See resolveDestinationTree. */
const allowWorkingTree = flags.get('allow-working-tree') === true;

const destinationTree = await resolveDestinationTree(destinationRoot, against);
const sourceItems = await collectSourceItems();
const destinationIndex = await buildDestinationIndex(destinationTree);
const renameIndex = buildRenameIndex();

const staysIndex = new Map(STAYS_IN_PARITY.map((entry) => [entry.id, entry.reason]));
const items = sourceItems.map((item) => {
  const decided = decide(item, destinationIndex, renameIndex);
  const reason = staysIndex.get(item.id);
  // STAYS is applied only where the item would otherwise read MISSING. If something on this list
  // has in fact been ported, that is worth seeing, not overwriting with an exemption.
  if (reason && decided.status === 'MISSING') return { ...decided, status: 'STAYS', reason };
  return decided;
});
const counts = {
  total: items.length,
  ported: items.filter((item) => item.status === 'PORTED').length,
  renamed: items.filter((item) => item.status === 'RENAMED').length,
  stays: items.filter((item) => item.status === 'STAYS').length,
  missing: items.filter((item) => item.status === 'MISSING').length,
  symbols: items.filter((item) => item.kind === 'symbol').length,
  scripts: items.filter((item) => item.kind === 'script').length,
};

// An exemption that names nothing is a stale exemption, and a stale exemption is how a real
// MISSING gets silenced later. Fail rather than carry one quietly.
const unusedExemptions = STAYS_IN_PARITY.filter(
  (entry) => !items.some((item) => item.id === entry.id),
);
if (unusedExemptions.length > 0) {
  process.stderr.write(
    `STAYS_IN_PARITY names ${unusedExemptions.length} item(s) that do not exist in the source:\n${unusedExemptions.map((e) => `  ${e.id}`).join('\n')}\nRemove them, or fix the id. An exemption for something that is not there can only hide a future finding.\n`,
  );
  process.exit(2);
}

const receipt = {
  schemaVersion: RECEIPT_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  source: {
    repository: rootDirectory,
    head: gitCapture(rootDirectory, ['rev-parse', 'HEAD']) ?? 'unknown',
    domainRoot: SOURCE_DOMAIN_ROOT,
    scriptPrefix: `${DESTINATION_SCRIPT_ROOT}/${SOURCE_SCRIPT_PREFIX}*`,
  },
  destination: destinationTree.provenance,
  renames: RENAMES,
  staysInParity: STAYS_IN_PARITY,
  counts,
  verdict: counts.missing === 0 ? 'PASS' : 'FAIL',
  items,
};

await mkdir(path.dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

if (emitJson) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
else report(receipt);

process.exit(counts.missing === 0 ? 0 : 1);

// ---------------------------------------------------------------------------------------------
// Source side — derived, never listed by hand.
// ---------------------------------------------------------------------------------------------

async function collectSourceItems() {
  const items = [];
  const domainFiles = await walkFiles(path.join(rootDirectory, SOURCE_DOMAIN_ROOT));
  for (const absolute of domainFiles.sort()) {
    const relative = toPosix(path.relative(rootDirectory, absolute));
    if (!isParseableSource(relative)) continue;
    const text = await readFile(absolute, 'utf8');
    for (const name of collectExportedNames(relative, text)) {
      items.push({ kind: 'symbol', id: `symbol:${relative}#${name}`, name, sourcePath: relative });
    }
  }

  // The NodeSlide modules that live outside the domain root, found by naming convention rather
  // than by a directory list. Missing these is what let the first version of this gate report a
  // number that felt complete while the Convex layer went uncounted.
  for (const { root, prefix } of SOURCE_PREFIXED_ROOTS) {
    const files = await walkFiles(path.join(rootDirectory, root));
    for (const absolute of files.sort()) {
      const relative = toPosix(path.relative(rootDirectory, absolute));
      if (!isParseableSource(relative)) continue;
      if (!path.basename(relative).toLowerCase().startsWith(prefix)) continue;
      const text = await readFile(absolute, 'utf8');
      for (const name of collectExportedNames(relative, text)) {
        items.push({
          kind: 'symbol',
          id: `symbol:${relative}#${name}`,
          name,
          sourcePath: relative,
        });
      }
    }
  }

  const scriptDirectory = path.join(rootDirectory, DESTINATION_SCRIPT_ROOT);
  for (const entry of (await readdir(scriptDirectory, { withFileTypes: true })).sort(byName)) {
    if (!entry.isFile() || !entry.name.startsWith(SOURCE_SCRIPT_PREFIX)) continue;
    const relative = `${DESTINATION_SCRIPT_ROOT}/${entry.name}`;
    items.push({
      kind: 'script',
      id: `script:${entry.name}`,
      name: entry.name,
      sourcePath: relative,
    });
  }
  return items;
}

/**
 * `.d.ts` declares types for code that lives elsewhere, so it has nothing to port on its own.
 * Everything else — including tests — is in scope: Phase 1 carries the suites too, and a test that
 * exports a fixture is exactly the kind of thing a hand list forgets.
 */
function isParseableSource(relativePath) {
  if (relativePath.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

/**
 * Parse, do not grep.
 *
 * `// export function x` and `` `export const y` `` inside a template literal both match a regex
 * and neither is an export. The compiler API sees the statement list, so comments and strings are
 * structurally absent rather than filtered out afterwards.
 */
function collectExportedNames(relativePath, text) {
  const scriptKind = relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const names = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      // `export * from './x'` names nothing; the names it forwards are audited at their definition.
      if (!clause) continue;
      if (ts.isNamespaceExport(clause)) names.add(clause.name.text);
      else for (const element of clause.elements) names.add(element.name.text);
      continue;
    }
    if (!hasExportModifier(statement)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) names.add(name);
      }
      continue;
    }
    if (hasDefaultModifier(statement)) names.add('default');
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return [...names].sort();
}

function hasExportModifier(node) {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node) {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

/** `export const { a, b: [c] } = ...` exports a, b and c — all three have to be audited. */
function bindingNames(binding) {
  if (ts.isIdentifier(binding)) return [binding.text];
  const names = [];
  for (const element of binding.elements ?? []) {
    if (ts.isOmittedExpression(element)) continue;
    names.push(...bindingNames(element.name));
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Destination side — working tree by default, any git ref on demand, never a checkout.
// ---------------------------------------------------------------------------------------------

async function resolveDestinationTree(repository, ref) {
  const head = gitCapture(repository, ['rev-parse', 'HEAD']);
  if (head === null) {
    fail(`Destination is not a git repository: ${repository}`);
  }
  const branch = gitCapture(repository, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';

  if (ref === null) {
    const status = gitCapture(repository, ['status', '--porcelain']) ?? '';
    const dirty = status.trim().length > 0;

    // Refuse to grade a working tree that is not a clean checkout of the shipping branch.
    //
    // This cost a real false PASS. On 2026-07-27 the audit reported the agent-session cluster as
    // 0 MISSING / 79 PORTED. It had read the shared nodeslide checkout, which a concurrent agent
    // had dirty on a feature branch carrying an unmerged copy of exactly those files. Against
    // origin/main all 79 were genuinely missing. The gate did not lie about what it read; it read
    // something nobody ships.
    //
    // A dirty or off-branch tree must never satisfy this check. It stays available behind an
    // explicit --allow-working-tree, because inspecting an in-flight port is a real use — but it
    // has to be asked for, so a receipt can never quietly describe someone else's uncommitted work.
    if (!allowWorkingTree) {
      const reasons = [];
      if (dirty)
        reasons.push(`it has uncommitted changes (${status.trim().split('\n').length} paths)`);
      if (branch !== 'main')
        reasons.push(`it is on branch '${branch ?? 'detached HEAD'}', not main`);
      if (reasons.length > 0) {
        fail(
          `Refusing to audit the working tree of ${repository}: ${reasons.join(', ')}.\nGrading a tree nobody ships produces a number nobody can act on — this exact case once reported 79 ported symbols that were entirely absent from main.\nUse --against origin/main to grade what ships, or --allow-working-tree to grade this tree deliberately.`,
        );
      }
    }

    return {
      repository,
      readFile: async (relative) => readFile(path.join(repository, relative), 'utf8'),
      files: await listWorkingTreeFiles(repository),
      provenance: {
        repository,
        mode: 'worktree',
        ref: null,
        resolved: head,
        branch,
        dirty,
        allowedByFlag: allowWorkingTree,
      },
    };
  }

  const resolved = gitCapture(repository, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (resolved === null) fail(`Destination ref does not resolve in ${repository}: ${ref}`);
  const blobs = readTreeBlobs(repository, resolved);
  return {
    repository,
    readFile: async (relative) => {
      const blob = blobs.get(relative);
      if (blob === undefined) throw new Error(`Not in tree ${resolved}: ${relative}`);
      return blob;
    },
    files: [...blobs.keys()].filter(isAuditedDestinationPath).sort(),
    provenance: { repository, mode: 'ref', ref, resolved, branch: null, dirty: false },
  };
}

async function listWorkingTreeFiles(repository) {
  const files = [];
  for (const root of [...DESTINATION_SOURCE_ROOTS, DESTINATION_SCRIPT_ROOT]) {
    for (const absolute of await walkFiles(path.join(repository, root))) {
      files.push(toPosix(path.relative(repository, absolute)));
    }
  }
  return files.filter(isAuditedDestinationPath).sort();
}

function isAuditedDestinationPath(relative) {
  if (relative.includes('/node_modules/') || relative.startsWith('node_modules/')) return false;
  if (relative.startsWith(`${DESTINATION_SCRIPT_ROOT}/`)) return true;
  return DESTINATION_SOURCE_ROOTS.some((root) => relative.startsWith(`${root}/`));
}

/**
 * Read a whole tree through one `git cat-file --batch`.
 *
 * Per-file `git show` would be a spawn per file, which on Windows turns the revert probe into a
 * minute of process churn and discourages anyone from running it. `--batch` streams
 * `<sha> blob <size>\n<payload>\n`, so the payload is sliced by byte length rather than split on
 * newlines — content containing the header shape cannot desynchronise the parse.
 */
function readTreeBlobs(repository, commit) {
  const listing = gitCapture(repository, ['ls-tree', '-r', '-z', commit]);
  if (listing === null) fail(`Cannot list tree ${commit} in ${repository}`);

  const wanted = [];
  for (const record of listing.split('\0')) {
    if (record.length === 0) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = record.slice(0, tab).split(/\s+/);
    const relative = record.slice(tab + 1);
    if (type !== 'blob' || !isAuditedDestinationPath(relative)) continue;
    wanted.push({ sha, relative });
  }

  if (wanted.length === 0) return new Map();
  const batch = spawnSync('git', ['-C', repository, 'cat-file', '--batch'], {
    input: `${wanted.map((entry) => entry.sha).join('\n')}\n`,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (batch.status !== 0) fail(`git cat-file --batch failed in ${repository}`);

  const blobs = new Map();
  const buffer = batch.stdout;
  let offset = 0;
  for (const entry of wanted) {
    const newline = buffer.indexOf(0x0a, offset);
    const header = buffer.toString('utf8', offset, newline);
    const size = Number.parseInt(header.split(' ')[2], 10);
    if (!Number.isFinite(size)) fail(`Unreadable cat-file header for ${entry.relative}: ${header}`);
    const start = newline + 1;
    blobs.set(entry.relative, buffer.toString('utf8', start, start + size));
    offset = start + size + 1;
  }
  return blobs;
}

async function buildDestinationIndex(tree) {
  const byName = new Map();
  const byPath = new Map();
  const files = new Set(tree.files);

  for (const relative of tree.files) {
    if (!isParseableSource(relative)) continue;
    const text = await tree.readFile(relative);
    const names = collectExportedNames(relative, text);
    byPath.set(relative, new Set(names));
    for (const name of names) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(relative);
    }
  }
  return { byName, byPath, files, parsedFiles: byPath.size };
}

function buildRenameIndex() {
  const index = new Map();
  for (const entry of RENAMES) {
    if (!entry.from || !entry.to || !entry.reason) {
      fail(`RENAMES entry needs from, to and reason: ${JSON.stringify(entry)}`);
    }
    if (index.has(entry.from)) fail(`RENAMES maps ${entry.from} twice.`);
    index.set(entry.from, entry);
  }
  return index;
}

// ---------------------------------------------------------------------------------------------
// Verdicts.
// ---------------------------------------------------------------------------------------------

function decide(item, index, renames) {
  const rename = renames.get(item.id);
  if (rename) {
    // A rename is satisfied by EITHER name. Looking only for the new one broke the self-audit
    // probe: auditing parity against itself, a declared Workspace->Deck rename sent the audit
    // hunting for names only the destination has, and `--destination parity-studio` went from
    // exit 0 to FAIL on 13 items. The plan requires that probe to pass. "An audit that cannot
    // fail is not a gate" has a twin: an audit that cannot PASS is not a gate either.
    //
    // Accepting either name is also the honest semantics. The obligation is that the symbol has a
    // home, not that it has a particular spelling — if the destination still carries the original
    // name, the item is ported and the rename simply has not been applied there.
    const found =
      item.kind === 'script'
        ? index.files.has(rename.to)
          ? [rename.to]
          : index.files.has(item.name)
            ? [item.name]
            : []
        : (index.byName.get(rename.to) ?? index.byName.get(item.name) ?? []);
    if (found.length > 0) {
      return {
        ...item,
        status: 'RENAMED',
        match: 'rename',
        target: rename.to,
        destinationPaths: found,
        reason: rename.reason,
      };
    }
    return {
      ...item,
      status: 'MISSING',
      match: null,
      target: rename.to,
      destinationPaths: [],
      reason: `Rename target absent: ${rename.reason}`,
    };
  }

  if (item.kind === 'script') {
    const candidate = `${DESTINATION_SCRIPT_ROOT}/${item.name}`;
    if (index.files.has(candidate)) {
      return {
        ...item,
        status: 'PORTED',
        match: 'path',
        target: item.name,
        destinationPaths: [candidate],
      };
    }
    return { ...item, status: 'MISSING', match: null, target: item.name, destinationPaths: [] };
  }

  const mirrored = index.byPath.get(item.sourcePath);
  if (mirrored?.has(item.name)) {
    return {
      ...item,
      status: 'PORTED',
      match: 'path',
      target: item.name,
      destinationPaths: [item.sourcePath],
    };
  }
  const elsewhere = index.byName.get(item.name) ?? [];
  if (elsewhere.length > 0) {
    return {
      ...item,
      status: 'PORTED',
      match: 'name',
      target: item.name,
      destinationPaths: elsewhere,
    };
  }
  return { ...item, status: 'MISSING', match: null, target: item.name, destinationPaths: [] };
}

// ---------------------------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------------------------

function report(result) {
  const { counts, destination } = result;
  const tree =
    destination.mode === 'ref'
      ? `ref ${destination.ref} (${destination.resolved.slice(0, 7)})`
      : `worktree ${destination.branch} (${destination.resolved.slice(0, 7)})${destination.dirty ? ', dirty' : ''}`;
  process.stdout.write(`Port audit — destination ${destination.repository}, ${tree}\n`);
  process.stdout.write(
    `  ${counts.total} items (${counts.symbols} symbols, ${counts.scripts} scripts): ` +
      `${counts.ported} PORTED, ${counts.renamed} RENAMED, ${counts.missing} MISSING\n`,
  );

  for (const item of result.items) {
    if (item.status !== 'MISSING') continue;
    process.stdout.write(
      `  MISSING  ${item.sourcePath}  ${item.kind === 'script' ? '' : `#${item.name}`}\n`,
    );
  }

  process.stdout.write(`  receipt: ${toPosix(path.relative(rootDirectory, receiptPath))}\n`);
  process.stdout.write(
    counts.missing === 0
      ? '  PASS — every derived item has an equivalent in the destination.\n'
      : `  FAIL — ${counts.missing} item(s) have no equivalent. Deleting them from parity would strand them.\n`,
  );
}

// ---------------------------------------------------------------------------------------------
// Plumbing.
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = new Map();
  let showHelp = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      showHelp = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      parsed.set(token.slice(2), true);
      continue;
    }
    parsed.set(token.slice(2), next);
    i += 1;
  }
  return { flags: parsed, showHelp };
}

function readUsage() {
  return [
    'Usage: node scripts/port-audit.mjs [--destination <repo>] [--against <git-ref>]',
    '                                   [--receipt <path>] [--json]',
    '',
    'Exit 0 when every derived item has an equivalent in the destination; exit 1 otherwise.',
  ].join('\n');
}

async function walkFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walkFiles(absolute)));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

function gitCapture(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function byName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function fail(message) {
  process.stderr.write(`Port audit cannot run: ${message}\n`);
  process.exit(2);
}
