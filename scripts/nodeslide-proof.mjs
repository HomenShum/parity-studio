import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { createServer } from 'vite';
import { api } from '../convex/_generated/api.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-domain-v1');
const deckId = readArgument('--deck');
const suppliedOwnerAccessKey =
  readArgument('--owner-key') ?? process.env.NODESLIDE_OWNER_ACCESS_KEY;

const convexUrl = process.env.VITE_CONVEX_URL ?? (await readConvexUrl());
if (!convexUrl) throw new Error('VITE_CONVEX_URL is missing from the environment and .env.local.');

const client = new ConvexHttpClient(convexUrl);
let workspace;
if (deckId) {
  if (!suppliedOwnerAccessKey) {
    throw new Error(
      'Existing deck proof requires --owner-key <capability> or NODESLIDE_OWNER_ACCESS_KEY.',
    );
  }
  workspace = await client.query(api.nodeslide.getWorkspace, {
    deckId,
    ownerAccessKey: suppliedOwnerAccessKey,
  });
  if (!workspace) throw new Error(`NodeSlide deck ${deckId} was not found or access was denied.`);
} else {
  workspace = await client.mutation(api.nodeslide.ensureWorkspace, {
    clientSessionId: `nodeslide-artifact-proof-${Date.now().toString(36)}`,
  });
}
const workspaceOwnerAccessKey = workspace.ownerAccessKey ?? suppliedOwnerAccessKey;
if (process.argv.includes('--normalize-workflow-numbering')) {
  assert(workspaceOwnerAccessKey, 'Numbering normalization requires the owner capability.');
  workspace = await normalizeWorkflowNumbering(client, workspace, workspaceOwnerAccessKey);
  assert(workspace, 'Normalized workspace could not be reloaded.');
}

const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const adapter = await vite.ssrLoadModule('/src/domains/nodeslide/slidelang/index.ts');
  const snapshot = {
    deck: workspace.deck,
    slides: workspace.slides,
    elements: workspace.elements,
    sources: workspace.sources,
  };
  const html = adapter.renderDeckHtml(snapshot);
  const pptxBinary = await adapter.buildPptx(snapshot);
  const pptx = Buffer.from(
    pptxBinary instanceof ArrayBuffer
      ? new Uint8Array(pptxBinary)
      : pptxBinary instanceof Uint8Array
        ? pptxBinary
        : new Uint8Array(await pptxBinary.arrayBuffer()),
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'nodeslide-golden.html'), html, 'utf8');
  await writeFile(path.join(outputDirectory, 'nodeslide-golden.pptx'), pptx);

  const validation = [...workspace.validations].sort((a, b) => b.createdAt - a.createdAt)[0];
  const artifactProof = {
    generatedAt: new Date().toISOString(),
    deckId: workspace.deck.id,
    deckVersion: workspace.deck.version,
    slideCount: workspace.slides.length,
    elementCount: workspace.elements.length,
    latestValidation: validation
      ? {
          ok: validation.ok,
          publishOk: validation.publishOk,
          cleanOk: validation.cleanOk,
          issueCount: validation.issues.length,
        }
      : null,
    html: {
      bytes: Buffer.byteLength(html),
      slideRegions: (html.match(/data-slide-id=/g) ?? []).length,
      stableElementIds: (html.match(/data-element-id=/g) ?? []).length,
    },
    pptx: {
      bytes: pptx.byteLength,
      zipSignature: pptx.subarray(0, 2).toString('ascii'),
      editableElementClaims: workspace.elements.filter((element) =>
        element.exportCapabilities.includes('pptx_editable'),
      ).length,
      nativeChartClaims: workspace.elements.filter(
        (element) =>
          element.kind === 'chart' && element.exportCapabilities.includes('pptx_editable'),
      ).length,
    },
  };
  assert(artifactProof.latestValidation?.cleanOk === true, 'Live deck validation is not clean.');
  assert(artifactProof.html.slideRegions === workspace.slides.length, 'HTML slide count drifted.');
  assert(artifactProof.pptx.zipSignature === 'PK', 'PPTX output is not an OOXML ZIP.');
  await writeJson('artifact-proof.json', artifactProof);

  const conflictProof = await proveTwoClientCas(convexUrl);
  await writeJson('conflict-proof.json', conflictProof);

  process.stdout.write(
    `${JSON.stringify({ outputDirectory, artifactProof, conflictProof }, null, 2)}\n`,
  );
} finally {
  await vite.close();
}

async function proveTwoClientCas(url) {
  const clientA = new ConvexHttpClient(url);
  const clientB = new ConvexHttpClient(url);
  const clientSessionId = `nodeslide-conflict-proof-${Date.now().toString(36)}`;
  const base = await clientA.mutation(api.nodeslide.ensureWorkspace, { clientSessionId });
  const ownerAccessKey = base.ownerAccessKey;
  const firstSlide = base.slides[0];
  const secondSlide = base.slides[1];
  const firstElement = base.elements.find(
    (element) => element.slideId === firstSlide?.id && element.kind === 'text' && !element.locked,
  );
  const secondElement = base.elements.find(
    (element) => element.slideId === secondSlide?.id && element.kind === 'text' && !element.locked,
  );
  assert(
    firstSlide && secondSlide && firstElement && secondElement,
    'Conflict proof lacks targets.',
  );

  const firstText = `${firstElement.content ?? firstElement.name} [client A]`;
  const secondText = `${secondElement.content ?? secondElement.name} [client B]`;
  const firstPatch = patchFor(
    base,
    ownerAccessKey,
    firstSlide,
    firstElement,
    firstText,
    'Client A edit',
  );
  const secondPatch = patchFor(
    base,
    ownerAccessKey,
    secondSlide,
    secondElement,
    secondText,
    'Client B edit',
  );
  const overlappingPatch = patchFor(
    base,
    ownerAccessKey,
    firstSlide,
    firstElement,
    `${firstElement.content ?? firstElement.name} [stale overwrite]`,
    'Stale overlapping edit',
  );

  const acceptedA = await clientA.mutation(api.nodeslide.applyPatch, firstPatch);
  const rebasedB = await clientB.mutation(api.nodeslide.applyPatch, secondPatch);
  const staleOverlap = await clientB.mutation(api.nodeslide.applyPatch, overlappingPatch);
  const final = await clientA.query(api.nodeslide.getWorkspace, {
    deckId: base.deck.id,
    ownerAccessKey,
  });
  assert(final, 'Conflict proof workspace could not be reloaded.');
  const finalFirst = final.elements.find((element) => element.id === firstElement.id);
  const finalSecond = final.elements.find((element) => element.id === secondElement.id);

  assert(acceptedA.patch.status === 'accepted', 'Client A edit was not accepted.');
  assert(
    rebasedB.patch.status === 'accepted' && rebasedB.rebased,
    'Safe stale edit did not rebase.',
  );
  assert(staleOverlap.patch.status === 'stale', 'Overlapping stale edit was not blocked.');
  assert(finalFirst?.content === firstText, 'Blocked overlap changed client A content.');
  assert(finalSecond?.content === secondText, 'Rebased client B content was not retained.');

  return {
    generatedAt: new Date().toISOString(),
    deckId: base.deck.id,
    sharedBaseDeckVersion: base.deck.version,
    finalDeckVersion: final.deck.version,
    clientA: {
      slideId: firstSlide.id,
      elementId: firstElement.id,
      status: acceptedA.patch.status,
      rebased: acceptedA.rebased,
    },
    clientBNonOverlap: {
      slideId: secondSlide.id,
      elementId: secondElement.id,
      status: rebasedB.patch.status,
      rebased: rebasedB.rebased,
    },
    clientBOverlap: {
      slideId: firstSlide.id,
      elementId: firstElement.id,
      status: staleOverlap.patch.status,
      staleReasons: staleOverlap.staleReasons,
    },
    finalContentPreserved: {
      clientA: finalFirst?.content === firstText,
      clientB: finalSecond?.content === secondText,
    },
  };
}

async function normalizeWorkflowNumbering(client, workspace, ownerAccessKey) {
  const slide = workspace.slides.find((candidate) => candidate.section === 'Workflow / 04');
  if (!slide) return workspace;
  const replacements = workspace.elements.flatMap((element) => {
    if (element.slideId !== slide.id || element.kind !== 'text' || element.locked) return [];
    const match = element.content?.match(/^(0[1-3])\s+\1\s*·?\s*(.+)$/u);
    if (!match) return [];
    return [{ element, text: `${match[1]}  ${match[2]}` }];
  });
  if (replacements.length === 0) return workspace;

  const result = await client.mutation(api.nodeslide.applyPatch, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    baseDeckVersion: workspace.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: Object.fromEntries(
      replacements.map(({ element }) => [element.id, element.version]),
    ),
    scope: {
      kind: 'elements',
      deckId: workspace.deck.id,
      slideIds: [slide.id],
      elementIds: replacements.map(({ element }) => element.id),
      operationMode: 'copy',
    },
    operations: replacements.map(({ element, text }) => ({
      op: 'replace_text',
      slideId: slide.id,
      elementId: element.id,
      text,
    })),
    summary: 'Removed duplicate workflow numbering after PPTX visual QA',
  });
  assert(result.patch.status === 'accepted', 'Workflow numbering repair was not accepted.');
  return await client.query(api.nodeslide.getWorkspace, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  });
}

function patchFor(base, ownerAccessKey, slide, element, text, summary) {
  return {
    deckId: base.deck.id,
    ownerAccessKey,
    baseDeckVersion: base.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: {
      kind: 'elements',
      deckId: base.deck.id,
      slideIds: [slide.id],
      elementIds: [element.id],
      operationMode: 'copy',
    },
    operations: [{ op: 'replace_text', slideId: slide.id, elementId: element.id, text }],
    summary,
  };
}

async function readConvexUrl() {
  const envPath = path.join(rootDirectory, '.env.local');
  const content = await readFile(envPath, 'utf8').catch(() => '');
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('VITE_CONVEX_URL='));
  return line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(fileName, value) {
  await writeFile(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
