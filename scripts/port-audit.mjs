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
 * The default is the destination *working tree*, deliberately. NodeSlide PR #73 carries the PPTX
 * importer and is not on main yet, so an audit against `main` today reports the importer MISSING
 * and would be telling the truth about main while lying about the port. The receipt therefore
 * always records which tree was read — ref, resolved sha, and whether it was dirty — so no reader
 * can mistake one run for another.
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
 */
const RENAMES = [];

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

const destinationTree = await resolveDestinationTree(destinationRoot, against);
const sourceItems = await collectSourceItems();
const destinationIndex = await buildDestinationIndex(destinationTree);
const renameIndex = buildRenameIndex();

const items = sourceItems.map((item) => decide(item, destinationIndex, renameIndex));
const counts = {
  total: items.length,
  ported: items.filter((item) => item.status === 'PORTED').length,
  renamed: items.filter((item) => item.status === 'RENAMED').length,
  missing: items.filter((item) => item.status === 'MISSING').length,
  symbols: items.filter((item) => item.kind === 'symbol').length,
  scripts: items.filter((item) => item.kind === 'script').length,
};

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
        dirty: status.trim().length > 0,
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
    const found =
      item.kind === 'script'
        ? index.files.has(rename.to)
          ? [rename.to]
          : []
        : (index.byName.get(rename.to) ?? []);
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
