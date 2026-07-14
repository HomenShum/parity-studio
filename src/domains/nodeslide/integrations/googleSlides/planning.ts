import type {
  BoundingBox,
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  Slide,
  SlideElement,
} from '../../../../../shared/nodeslide';
import {
  type CandidatePatchPlan,
  type NormalizedPresentationElement,
  type NormalizedPresentationSlide,
  type NormalizedPresentationState,
  type PresentationSyncBaseline,
  type StagedSyncObjectLink,
  type SyncConflict,
  type SyncDiagnostic,
  createCandidatePatchPlan,
  createSyncObjectMappingIndex,
  mappedLocalId,
  mappedRemoteId,
  syncSemanticEqual,
  syncSemanticFingerprint,
} from '../syncContracts';
import type {
  GoogleAffineTransform,
  GooglePageElementProperties,
  GoogleSlidesBatchUpdatePlan,
  GoogleSlidesRequest,
  GoogleTextStyle,
} from './types';

export interface GoogleSlidesThreeWaySyncInput {
  baseline: PresentationSyncBaseline;
  local: DeckSnapshot;
  remote: NormalizedPresentationState;
}

export interface GoogleSlidesThreeWaySyncPlan {
  provider: 'google_slides';
  inbound: CandidatePatchPlan;
  outbound: GoogleSlidesBatchUpdatePlan;
  conflicts: SyncConflict[];
  diagnostics: SyncDiagnostic[];
  stagedMappingLinks: StagedSyncObjectLink[];
}

export function planGoogleSlidesThreeWaySync(
  input: GoogleSlidesThreeWaySyncInput,
): GoogleSlidesThreeWaySyncPlan {
  validateInputs(input);
  const { local, remote } = input;
  const operations: PatchOperation[] = [];
  const requests: GoogleSlidesRequest[] = [];
  const conflicts: SyncConflict[] = [];
  const diagnostics: SyncDiagnostic[] = [];
  const stagedMappingLinks: StagedSyncObjectLink[] = [];
  const reconciled = reconcileChangedGoogleObjectIds(
    input.baseline,
    remote,
    conflicts,
    diagnostics,
    stagedMappingLinks,
  );
  const baseline = reconciled;
  const mapping = createSyncObjectMappingIndex(baseline.mapping);

  planDeckTitle(baseline, local, remote, operations, conflicts, diagnostics);
  planSlideStructure(
    baseline,
    local,
    remote,
    mapping,
    operations,
    requests,
    conflicts,
    diagnostics,
    stagedMappingLinks,
  );
  planMappedSlides(
    baseline,
    local,
    remote,
    mapping,
    operations,
    requests,
    conflicts,
    diagnostics,
    stagedMappingLinks,
  );
  planSlideOrder(baseline, local, remote, mapping, operations, requests, conflicts);

  const requiredRevisionId = remote.revisionId?.trim();
  const blockedReasons: string[] = [];
  if (requests.length > 0 && !requiredRevisionId) {
    blockedReasons.push(
      'presentations.get did not provide revisionId for this user; refusing an unguarded batchUpdate plan.',
    );
    diagnostics.push({
      code: 'google_outbound_revision_guard_missing',
      severity: 'error',
      message: blockedReasons[0] as string,
    });
  }

  const outbound: GoogleSlidesBatchUpdatePlan = {
    kind: 'google_slides_batch_update',
    provider: 'google_slides',
    presentationId: remote.remotePresentationId,
    requests,
    blocked: blockedReasons.length > 0,
    blockedReasons,
    ...(requiredRevisionId ? { requiredRevisionId } : {}),
    ...(requiredRevisionId && requests.length > 0
      ? {
          body: {
            requests,
            writeControl: { requiredRevisionId },
          },
        }
      : {}),
  };

  const inbound = createCandidatePatchPlan({
    provider: 'google_slides',
    snapshot: local,
    remotePresentationId: remote.remotePresentationId,
    operations,
    conflicts,
    diagnostics,
    stagedMappingLinks: stagedMappingLinks.filter((link) => link.commitAfter === 'inbound_patch'),
  });
  return {
    provider: 'google_slides',
    inbound,
    outbound,
    conflicts,
    diagnostics,
    stagedMappingLinks,
  };
}

function reconcileChangedGoogleObjectIds(
  baseline: PresentationSyncBaseline,
  currentRemote: NormalizedPresentationState,
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
  stagedMappingLinks: StagedSyncObjectLink[],
): PresentationSyncBaseline {
  const currentSlides = byRemoteId(currentRemote.slides);
  const currentElements = byRemoteId(currentRemote.slides.flatMap((slide) => slide.elements));
  const occupied = new Set<string>();
  for (const link of baseline.mapping.links) {
    if (
      (link.kind === 'slide' && currentSlides.has(link.remoteId)) ||
      (link.kind === 'element' && currentElements.has(link.remoteId))
    ) {
      occupied.add(`${link.kind}:${link.remoteId}`);
    }
  }

  const slideReplacements = new Map<string, string>();
  const elementReplacements = new Map<string, string>();
  const links = baseline.mapping.links.map((link) => {
    if (link.kind === 'deck') return link;
    const collection = link.kind === 'slide' ? currentRemote.slides : [...currentElements.values()];
    const hasExact =
      link.kind === 'slide' ? currentSlides.has(link.remoteId) : currentElements.has(link.remoteId);
    if (hasExact) return link;
    const matches = collection.filter((candidate) => {
      const fingerprint =
        link.kind === 'slide'
          ? remoteSlideFingerprint(candidate as NormalizedPresentationSlide)
          : remoteElementFingerprint(candidate as NormalizedPresentationElement);
      return (
        fingerprint === link.semanticFingerprint &&
        !occupied.has(`${link.kind}:${candidate.remoteId}`)
      );
    });
    if (matches.length > 1) {
      conflicts.push({
        code: 'mapping_collision',
        path: `mapping.${link.kind}.${link.localId}`,
        message: `Google object ${link.remoteId} disappeared and its semantic fingerprint matches multiple replacement objects.`,
        resolution: 'manual',
        localId: link.localId,
        remoteId: link.remoteId,
      });
      return link;
    }
    const replacement = matches[0];
    if (!replacement) return link;
    occupied.add(`${link.kind}:${replacement.remoteId}`);
    if (link.kind === 'slide') slideReplacements.set(link.remoteId, replacement.remoteId);
    else elementReplacements.set(link.remoteId, replacement.remoteId);
    const repaired = {
      ...link,
      remoteId: replacement.remoteId,
      ...(link.kind === 'element'
        ? { remoteSlideId: (replacement as NormalizedPresentationElement).remoteSlideId }
        : {}),
    };
    stagedMappingLinks.push({ ...repaired, commitAfter: 'verified_read' });
    diagnostics.push({
      code: 'google_object_id_reconciled',
      severity: 'info',
      path: `mapping.${link.kind}.${link.localId}`,
      localId: link.localId,
      remoteId: replacement.remoteId,
      message: `Recovered changed Google ${link.kind} objectId by a unique semantic fingerprint match.`,
    });
    return repaired;
  });

  if (slideReplacements.size === 0 && elementReplacements.size === 0) return baseline;
  const remoteSlides = baseline.remote.slides.map((slide) => {
    const remoteId = slideReplacements.get(slide.remoteId) ?? slide.remoteId;
    return {
      ...slide,
      remoteId,
      elements: slide.elements.map((element) => ({
        ...element,
        remoteId: elementReplacements.get(element.remoteId) ?? element.remoteId,
        remoteSlideId: remoteId,
      })),
    };
  });
  const repairedLinks = links.map((link) => {
    if (link.kind !== 'element' || !link.remoteSlideId) return link;
    const remoteSlideId = slideReplacements.get(link.remoteSlideId) ?? link.remoteSlideId;
    return remoteSlideId === link.remoteSlideId ? link : { ...link, remoteSlideId };
  });
  return {
    ...baseline,
    mapping: { ...baseline.mapping, links: repairedLinks },
    remote: { ...baseline.remote, slides: remoteSlides },
  };
}

function planDeckTitle(
  baseline: PresentationSyncBaseline,
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
  operations: PatchOperation[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
): void {
  const baseLocal = baseline.local.deck.title;
  const baseRemote = baseline.remote.title;
  const localValue = local.deck.title;
  const remoteValue = remote.title;
  const state = threeWayState(baseLocal, localValue, baseRemote, remoteValue);
  if (state === 'remote') {
    operations.push({ op: 'update_deck', properties: { title: remoteValue } });
  } else if (state === 'local') {
    diagnostics.push({
      code: 'google_presentation_title_push_unsupported',
      severity: 'warning',
      path: 'deck.title',
      message: 'The Google Slides API cannot rename the Drive file; local title remains unpushed.',
    });
  } else if (state === 'conflict') {
    conflicts.push(
      concurrentConflict('deck.title', baseLocal, localValue, remoteValue, undefined, undefined),
    );
  }
}

function planSlideStructure(
  baseline: PresentationSyncBaseline,
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
  mapping: ReturnType<typeof createSyncObjectMappingIndex>,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
  stagedMappingLinks: StagedSyncObjectLink[],
): void {
  const baseLocalSlides = byId(baseline.local.slides);
  const localSlides = byId(local.slides);
  const baseRemoteSlides = byRemoteId(baseline.remote.slides);
  const remoteSlides = byRemoteId(remote.slides);
  const reservedLocalSlideIds = new Set(local.slides.map((slide) => slide.id));
  const reservedLocalElementIds = new Set(local.elements.map((element) => element.id));

  for (const link of baseline.mapping.links.filter((candidate) => candidate.kind === 'slide')) {
    const baseLocal = baseLocalSlides.get(link.localId);
    const localSlide = localSlides.get(link.localId);
    const baseRemote = baseRemoteSlides.get(link.remoteId);
    const remoteSlide = remoteSlides.get(link.remoteId);
    if (!baseLocal || !baseRemote) continue;
    if (!localSlide && remoteSlide) {
      if (!same(slideValue(baseRemote), slideValue(remoteSlide))) {
        conflicts.push(
          deleteEditConflict(
            `slides.${link.localId}`,
            'NodeSlide deleted this slide while Google edited it.',
            link.localId,
            link.remoteId,
          ),
        );
      } else {
        requests.push({ deleteObject: { objectId: link.remoteId } });
      }
    } else if (localSlide && !remoteSlide) {
      if (!same(localSlideValue(baseLocal), localSlideValue(localSlide))) {
        conflicts.push(
          deleteEditConflict(
            `slides.${link.localId}`,
            'Google deleted this slide while NodeSlide edited it.',
            link.localId,
            link.remoteId,
          ),
        );
      } else if (local.slides.length <= 1) {
        conflicts.push({
          code: 'unsupported_change',
          path: `slides.${link.localId}`,
          message:
            'Google deleted the final mapped slide, but NodeSlide cannot remove its final slide.',
          resolution: 'manual',
          localId: link.localId,
          remoteId: link.remoteId,
        });
      } else {
        operations.push({ op: 'remove_slide', slideId: link.localId });
      }
    }
  }

  for (const [remoteId, remoteSlide] of remoteSlides) {
    if (mappedLocalId(mapping, 'slide', remoteId) || baseRemoteSlides.has(remoteId)) continue;
    const localSlideId = uniqueLocalId('gslide', remoteId, reservedLocalSlideIds);
    const bundled = remoteSlide.elements.flatMap((element) => {
      const localElementId = uniqueLocalId('gelement', element.remoteId, reservedLocalElementIds);
      const converted = remoteElementToLocal(element, localSlideId, localElementId);
      if (!converted) {
        diagnostics.push(unsupportedRemoteAddition(element));
        return [];
      }
      stagedMappingLinks.push({
        kind: 'element',
        localId: localElementId,
        remoteId: element.remoteId,
        semanticFingerprint: remoteElementFingerprint(element),
        localSlideId,
        remoteSlideId: remoteId,
        commitAfter: 'inbound_patch',
      });
      return [converted];
    });
    const slide: Slide = {
      id: localSlideId,
      deckId: local.deck.id,
      title: remoteSlide.title,
      background: remoteSlide.background,
      elementOrder: bundled.map((element) => element.id),
      version: 1,
      ...(remoteSlide.notes ? { notes: remoteSlide.notes } : {}),
    };
    operations.push({
      op: 'add_slide',
      slide,
      elements: bundled,
      index: Math.min(remote.slides.indexOf(remoteSlide), local.slides.length),
    });
    stagedMappingLinks.push({
      kind: 'slide',
      localId: localSlideId,
      remoteId,
      semanticFingerprint: remoteSlideFingerprint(remoteSlide),
      commitAfter: 'inbound_patch',
    });
  }

  for (const localSlide of local.slides) {
    if (mappedRemoteId(mapping, 'slide', localSlide.id) || baseLocalSlides.has(localSlide.id))
      continue;
    const remoteSlideId = googleObjectId('slide', localSlide.id);
    requests.push({
      createSlide: {
        objectId: remoteSlideId,
        insertionIndex: local.deck.slideOrder.indexOf(localSlide.id),
      },
    });
    stagedMappingLinks.push({
      kind: 'slide',
      localId: localSlide.id,
      remoteId: remoteSlideId,
      semanticFingerprint: localSlideFingerprint(localSlide),
      commitAfter: 'outbound_batch_update',
    });
    for (const element of local.elements.filter(
      (candidate) => candidate.slideId === localSlide.id,
    )) {
      planCreateRemoteElement(
        element,
        remoteSlideId,
        remote,
        requests,
        diagnostics,
        stagedMappingLinks,
      );
    }
  }
}

function planMappedSlides(
  baseline: PresentationSyncBaseline,
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
  mapping: ReturnType<typeof createSyncObjectMappingIndex>,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
  stagedMappingLinks: StagedSyncObjectLink[],
): void {
  const localSlides = byId(local.slides);
  const baseLocalSlides = byId(baseline.local.slides);
  const remoteSlides = byRemoteId(remote.slides);
  const baseRemoteSlides = byRemoteId(baseline.remote.slides);
  const localElements = byId(local.elements);
  const baseLocalElements = byId(baseline.local.elements);

  for (const link of baseline.mapping.links.filter((candidate) => candidate.kind === 'slide')) {
    const localSlide = localSlides.get(link.localId);
    const baseLocalSlide = baseLocalSlides.get(link.localId);
    const remoteSlide = remoteSlides.get(link.remoteId);
    const baseRemoteSlide = baseRemoteSlides.get(link.remoteId);
    if (!localSlide || !baseLocalSlide || !remoteSlide || !baseRemoteSlide) continue;

    planSlideFields(
      localSlide,
      baseLocalSlide,
      remoteSlide,
      baseRemoteSlide,
      operations,
      requests,
      conflicts,
      diagnostics,
    );
    planElementStructure(
      localSlide,
      baseLocalSlide,
      remoteSlide,
      baseRemoteSlide,
      local,
      remote,
      mapping,
      localElements,
      baseLocalElements,
      operations,
      requests,
      conflicts,
      diagnostics,
      stagedMappingLinks,
    );
  }
}

function planSlideFields(
  local: Slide,
  baseLocal: Slide,
  remote: NormalizedPresentationSlide,
  baseRemote: NormalizedPresentationSlide,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
): void {
  const properties: Partial<Pick<Slide, 'title' | 'notes' | 'background'>> = {};
  planField({
    path: `slides.${local.id}.title`,
    baseLocal: baseLocal.title,
    local: local.title,
    baseRemote: baseRemote.title,
    remote: remote.title,
    localId: local.id,
    remoteId: remote.remoteId,
    conflicts,
    onRemote: (value) => {
      properties.title = value;
    },
    onLocal: () =>
      diagnostics.push({
        code: 'google_synthetic_slide_title_not_pushable',
        severity: 'info',
        path: `slides.${local.id}.title`,
        localId: local.id,
        remoteId: remote.remoteId,
        message: 'NodeSlide slide titles are metadata; Google Slides has no page title field.',
      }),
  });
  planField({
    path: `slides.${local.id}.notes`,
    baseLocal: baseLocal.notes ?? '',
    local: local.notes ?? '',
    baseRemote: baseRemote.notes ?? '',
    remote: remote.notes ?? '',
    localId: local.id,
    remoteId: remote.remoteId,
    conflicts,
    onRemote: (value) => {
      properties.notes = value;
    },
    onLocal: () =>
      diagnostics.push({
        code: 'google_speaker_notes_push_requires_notes_object_mapping',
        severity: 'warning',
        path: `slides.${local.id}.notes`,
        localId: local.id,
        remoteId: remote.remoteId,
        message:
          'Speaker-note writes are withheld until the notes shape objectId is mapped explicitly.',
      }),
  });
  planField({
    path: `slides.${local.id}.background`,
    baseLocal: baseLocal.background,
    local: local.background,
    baseRemote: baseRemote.background,
    remote: remote.background,
    localId: local.id,
    remoteId: remote.remoteId,
    conflicts,
    onRemote: (value) => {
      properties.background = value;
    },
    onLocal: (value) => {
      const color = hexToRgb(value);
      if (!color) {
        diagnostics.push({
          code: 'google_background_color_unsupported',
          severity: 'warning',
          path: `slides.${local.id}.background`,
          message: `Google background planning requires a concrete #RRGGBB color; received ${value}.`,
          localId: local.id,
          remoteId: remote.remoteId,
        });
        return;
      }
      requests.push({
        updatePageProperties: {
          objectId: remote.remoteId,
          pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: color } } } },
          fields: 'pageBackgroundFill',
        },
      });
    },
  });
  if (Object.keys(properties).length > 0) {
    operations.push({ op: 'update_slide', slideId: local.id, properties });
  }
}

function planElementStructure(
  localSlide: Slide,
  baseLocalSlide: Slide,
  remoteSlide: NormalizedPresentationSlide,
  baseRemoteSlide: NormalizedPresentationSlide,
  localSnapshot: DeckSnapshot,
  remotePresentation: NormalizedPresentationState,
  mapping: ReturnType<typeof createSyncObjectMappingIndex>,
  localElements: Map<string, SlideElement>,
  baseLocalElements: Map<string, SlideElement>,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
  stagedMappingLinks: StagedSyncObjectLink[],
): void {
  const remoteElements = byRemoteId(remoteSlide.elements);
  const baseRemoteElements = byRemoteId(baseRemoteSlide.elements);
  const elementLinks = [...mapping.localToRemote.values()].filter(
    (link) => link.kind === 'element' && link.localSlideId === localSlide.id,
  );
  for (const link of elementLinks) {
    const localElement = localElements.get(link.localId);
    const baseLocalElement = baseLocalElements.get(link.localId);
    const remoteElement = remoteElements.get(link.remoteId);
    const baseRemoteElement = baseRemoteElements.get(link.remoteId);
    if (!baseLocalElement || !baseRemoteElement) continue;
    if (!localElement && remoteElement) {
      if (!same(remoteElementValue(baseRemoteElement), remoteElementValue(remoteElement))) {
        conflicts.push(
          deleteEditConflict(
            `elements.${link.localId}`,
            'NodeSlide deleted this element while Google edited it.',
            link.localId,
            link.remoteId,
          ),
        );
      } else {
        requests.push({ deleteObject: { objectId: link.remoteId } });
      }
    } else if (localElement && !remoteElement) {
      if (!same(localElementValue(baseLocalElement), localElementValue(localElement))) {
        conflicts.push(
          deleteEditConflict(
            `elements.${link.localId}`,
            'Google deleted this element while NodeSlide edited it.',
            link.localId,
            link.remoteId,
          ),
        );
      } else if (localElement.locked || localElement.groupId) {
        conflicts.push({
          code: 'unsupported_change',
          path: `elements.${link.localId}`,
          message:
            'The remotely deleted element is locked or grouped locally and cannot be removed safely.',
          resolution: 'manual',
          localId: link.localId,
          remoteId: link.remoteId,
        });
      } else {
        operations.push({ op: 'remove_element', slideId: localSlide.id, elementId: link.localId });
      }
    } else if (localElement && remoteElement) {
      planElementFields(
        baseLocalElement,
        localElement,
        baseRemoteElement,
        remoteElement,
        remotePresentation,
        operations,
        requests,
        conflicts,
        diagnostics,
      );
    }
  }

  const existingLocalIds = new Set([
    ...localSnapshot.elements.map((element) => element.id),
    ...stagedMappingLinks.filter((link) => link.kind === 'element').map((link) => link.localId),
  ]);
  for (const remoteElement of remoteSlide.elements) {
    if (
      mappedLocalId(mapping, 'element', remoteElement.remoteId) ||
      baseRemoteElements.has(remoteElement.remoteId)
    ) {
      continue;
    }
    const localId = uniqueLocalId('gelement', remoteElement.remoteId, existingLocalIds);
    const converted = remoteElementToLocal(remoteElement, localSlide.id, localId);
    if (!converted) {
      diagnostics.push(unsupportedRemoteAddition(remoteElement));
      continue;
    }
    operations.push({ op: 'add_element', slideId: localSlide.id, element: converted });
    stagedMappingLinks.push({
      kind: 'element',
      localId,
      remoteId: remoteElement.remoteId,
      semanticFingerprint: remoteElementFingerprint(remoteElement),
      localSlideId: localSlide.id,
      remoteSlideId: remoteSlide.remoteId,
      commitAfter: 'inbound_patch',
    });
    existingLocalIds.add(localId);
  }

  for (const localId of localSlide.elementOrder) {
    const element = localElements.get(localId);
    if (!element || mappedRemoteId(mapping, 'element', localId) || baseLocalElements.has(localId)) {
      continue;
    }
    planCreateRemoteElement(
      element,
      remoteSlide.remoteId,
      remotePresentation,
      requests,
      diagnostics,
      stagedMappingLinks,
    );
  }

  const localOrderChanged = !same(baseLocalSlide.elementOrder, localSlide.elementOrder);
  const baseRemoteOrder = baseRemoteSlide.elements.map((element) => element.remoteId);
  const remoteOrder = remoteSlide.elements.map((element) => element.remoteId);
  const remoteOrderChanged = !same(baseRemoteOrder, remoteOrder);
  if (remoteOrderChanged && !localOrderChanged) {
    const desired = remoteOrder.flatMap((remoteId) => {
      const localId = mappedLocalId(mapping, 'element', remoteId);
      return localId && localSlide.elementOrder.includes(localId) ? [localId] : [];
    });
    operations.push(...reorderElementOperations(localSlide, desired));
  } else if (localOrderChanged && !remoteOrderChanged) {
    diagnostics.push({
      code: 'google_element_z_order_push_unsupported',
      severity: 'warning',
      path: `slides.${localSlide.id}.elementOrder`,
      message:
        'Exact arbitrary element z-order planning is not enabled; local layer order remains unpushed.',
      localId: localSlide.id,
      remoteId: remoteSlide.remoteId,
    });
  } else if (localOrderChanged && remoteOrderChanged) {
    conflicts.push(
      concurrentConflict(
        `slides.${localSlide.id}.elementOrder`,
        baseLocalSlide.elementOrder,
        localSlide.elementOrder,
        remoteOrder,
        localSlide.id,
        remoteSlide.remoteId,
      ),
    );
  }
}

function planElementFields(
  baseLocal: SlideElement,
  local: SlideElement,
  baseRemote: NormalizedPresentationElement,
  remote: NormalizedPresentationElement,
  remotePresentation: NormalizedPresentationState,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
): void {
  if (local.locked) {
    const remoteChanged = !same(remoteElementValue(baseRemote), remoteElementValue(remote));
    if (remoteChanged) {
      conflicts.push({
        code: 'unsupported_change',
        path: `elements.${local.id}`,
        message: 'Google changed a locally locked element; no inbound operation was planned.',
        resolution: 'manual',
        localId: local.id,
        remoteId: remote.remoteId,
      });
    }
    return;
  }
  if (local.kind !== remote.kind && !(local.kind === 'shape' && remote.kind === 'text')) {
    diagnostics.push({
      code: 'google_element_kind_mismatch',
      severity: 'warning',
      path: `elements.${local.id}.kind`,
      message: `Mapped element kinds differ (${local.kind} vs ${remote.kind}); only common safe fields are planned.`,
      localId: local.id,
      remoteId: remote.remoteId,
    });
  }

  if ((local.kind === 'text' || local.kind === 'math') && remote.content !== undefined) {
    planField({
      path: `elements.${local.id}.content`,
      baseLocal: baseLocal.content ?? '',
      local: local.content ?? '',
      baseRemote: baseRemote.content ?? '',
      remote: remote.content,
      localId: local.id,
      remoteId: remote.remoteId,
      conflicts,
      onRemote: (value) =>
        operations.push({
          op: 'replace_text',
          slideId: local.slideId,
          elementId: local.id,
          text: value,
        }),
      onLocal: (value) => {
        requests.push({ deleteText: { objectId: remote.remoteId, textRange: { type: 'ALL' } } });
        if (value) {
          requests.push({
            insertText: { objectId: remote.remoteId, insertionIndex: 0, text: value },
          });
        }
      },
    });
  }

  planField({
    path: `elements.${local.id}.bbox`,
    baseLocal: canonicalBox(baseLocal.bbox),
    local: canonicalBox(local.bbox),
    baseRemote: canonicalBox(baseRemote.bbox),
    remote: canonicalBox(remote.bbox),
    localId: local.id,
    remoteId: remote.remoteId,
    conflicts,
    onRemote: (value) => {
      if (!samePosition(local.bbox, value)) {
        operations.push({
          op: 'move',
          slideId: local.slideId,
          elementId: local.id,
          x: value.x,
          y: value.y,
        });
      }
      if (!sameSize(local.bbox, value)) {
        operations.push({
          op: 'resize',
          slideId: local.slideId,
          elementId: local.id,
          width: Math.min(value.width, 1 - value.x),
          height: Math.min(value.height, 1 - value.y),
        });
      }
    },
    onLocal: (value) => {
      const transform = absoluteTransform(value, local.rotation, remote, remotePresentation);
      if (!transform) {
        diagnostics.push({
          code: 'google_geometry_basis_missing',
          severity: 'warning',
          path: `elements.${local.id}.bbox`,
          message: 'Cannot plan an absolute Google transform without intrinsic element dimensions.',
          localId: local.id,
          remoteId: remote.remoteId,
        });
        return;
      }
      requests.push({
        updatePageElementTransform: {
          objectId: remote.remoteId,
          transform,
          applyMode: 'ABSOLUTE',
        },
      });
    },
  });

  planElementStyle(
    baseLocal,
    local,
    baseRemote,
    remote,
    operations,
    requests,
    conflicts,
    diagnostics,
  );

  if (local.kind === 'image') {
    const baseLocalUrl = baseLocal.imageUrl ?? '';
    const localUrl = local.imageUrl ?? '';
    if (baseLocalUrl !== localUrl) {
      if (/^https:\/\//u.test(localUrl)) {
        requests.push({
          replaceImage: {
            imageObjectId: remote.remoteId,
            url: localUrl,
            imageReplaceMethod: 'CENTER_CROP',
          },
        });
      } else {
        diagnostics.push({
          code: 'google_image_url_not_fetchable',
          severity: 'warning',
          path: `elements.${local.id}.imageUrl`,
          message:
            'Google image replacement requires an HTTPS URL it can fetch; embedded data was not pushed.',
          localId: local.id,
          remoteId: remote.remoteId,
        });
      }
    }
    if (baseRemote.imageUrl !== remote.imageUrl) {
      diagnostics.push({
        code: 'google_remote_image_not_imported',
        severity: 'warning',
        path: `elements.${local.id}.imageUrl`,
        message:
          'The remote image source was not converted to update_image because NodeSlide requires a validated embedded image payload.',
        localId: local.id,
        remoteId: remote.remoteId,
      });
    }
  }
}

function planElementStyle(
  baseLocal: SlideElement,
  local: SlideElement,
  baseRemote: NormalizedPresentationElement,
  remote: NormalizedPresentationElement,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
  diagnostics: SyncDiagnostic[],
): void {
  const state = threeWayState(baseLocal.style, local.style, baseRemote.style, remote.style);
  if (state === 'remote') {
    if (Object.keys(remote.style).length > 0) {
      operations.push({
        op: 'update_style',
        slideId: local.slideId,
        elementId: local.id,
        properties: remote.style,
      });
    } else {
      diagnostics.push({
        code: 'google_style_clear_not_representable',
        severity: 'warning',
        path: `elements.${local.id}.style`,
        message:
          'Remote inherited style clearing cannot be represented as a concrete NodeSlide style patch.',
        localId: local.id,
        remoteId: remote.remoteId,
      });
    }
  } else if (state === 'local') {
    const request = textStyleRequest(remote.remoteId, local.style);
    if (request) requests.push(request);
    else if (Object.keys(local.style).length > 0) {
      diagnostics.push({
        code: 'google_style_fields_unsupported',
        severity: 'warning',
        path: `elements.${local.id}.style`,
        message: 'The changed local style has no safely supported Google text-style fields.',
        localId: local.id,
        remoteId: remote.remoteId,
      });
    }
  } else if (state === 'conflict') {
    conflicts.push(
      concurrentConflict(
        `elements.${local.id}.style`,
        baseLocal.style,
        local.style,
        remote.style,
        local.id,
        remote.remoteId,
      ),
    );
  }
}

function planSlideOrder(
  baseline: PresentationSyncBaseline,
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
  mapping: ReturnType<typeof createSyncObjectMappingIndex>,
  operations: PatchOperation[],
  requests: GoogleSlidesRequest[],
  conflicts: SyncConflict[],
): void {
  const baseLocalOrder = baseline.local.deck.slideOrder.flatMap((id) => {
    const remoteId = mappedRemoteId(mapping, 'slide', id);
    return remoteId ? [remoteId] : [];
  });
  const localOrder = local.deck.slideOrder.flatMap((id) => {
    const remoteId = mappedRemoteId(mapping, 'slide', id);
    return remoteId ? [remoteId] : [];
  });
  const mappedRemoteIds = new Set(baseLocalOrder);
  const baseRemoteOrder = baseline.remote.slides
    .map((slide) => slide.remoteId)
    .filter((id) => mappedRemoteIds.has(id));
  const remoteOrder = remote.slides
    .map((slide) => slide.remoteId)
    .filter((id) => mappedRemoteIds.has(id));
  const state = threeWayState(baseLocalOrder, localOrder, baseRemoteOrder, remoteOrder);
  if (state === 'remote') {
    const desiredLocal = remoteOrder.flatMap((remoteId) => {
      const localId = mappedLocalId(mapping, 'slide', remoteId);
      return localId ? [localId] : [];
    });
    operations.push(...reorderSlideOperations(local.deck.slideOrder, desiredLocal));
  } else if (state === 'local') {
    requests.push(...googleSlideReorderRequests(remoteOrder, localOrder));
  } else if (state === 'conflict') {
    conflicts.push(
      concurrentConflict(
        'deck.slideOrder',
        baseLocalOrder,
        localOrder,
        remoteOrder,
        local.deck.id,
        remote.remotePresentationId,
      ),
    );
  }
}

function planCreateRemoteElement(
  element: SlideElement,
  remoteSlideId: string,
  remote: NormalizedPresentationState,
  requests: GoogleSlidesRequest[],
  diagnostics: SyncDiagnostic[],
  stagedMappingLinks: StagedSyncObjectLink[],
): void {
  const remoteId = googleObjectId('element', element.id);
  const properties = googleElementProperties(element.bbox, remoteSlideId, remote);
  if (element.rotation !== 0) {
    diagnostics.push({
      code: 'google_created_element_rotation_not_preserved',
      severity: 'warning',
      path: `elements.${element.id}.rotation`,
      localId: element.id,
      message: 'New Google element creation currently preserves its box but not local rotation.',
    });
  }
  if (element.kind === 'text' || element.kind === 'shape') {
    requests.push({
      createShape: {
        objectId: remoteId,
        shapeType: element.kind === 'text' ? 'TEXT_BOX' : 'RECTANGLE',
        elementProperties: properties,
      },
    });
    if (element.content) {
      requests.push({
        insertText: { objectId: remoteId, insertionIndex: 0, text: element.content },
      });
    }
    const style = textStyleRequest(remoteId, element.style);
    if (style) requests.push(style);
  } else if (element.kind === 'image' && /^https:\/\//u.test(element.imageUrl ?? '')) {
    requests.push({
      createImage: {
        objectId: remoteId,
        url: element.imageUrl as string,
        elementProperties: properties,
      },
    });
  } else {
    diagnostics.push({
      code: 'google_local_element_creation_unsupported',
      severity: 'warning',
      path: `elements.${element.id}`,
      localId: element.id,
      message: `Creating local ${element.kind} elements in Google Slides is not safely supported.`,
    });
    return;
  }
  stagedMappingLinks.push({
    kind: 'element',
    localId: element.id,
    remoteId,
    semanticFingerprint: localElementFingerprint(element),
    localSlideId: element.slideId,
    remoteSlideId,
    commitAfter: 'outbound_batch_update',
  });
}

function remoteElementToLocal(
  remote: NormalizedPresentationElement,
  localSlideId: string,
  localElementId: string,
): SlideElement | null {
  if (
    !remote.writable ||
    (remote.kind !== 'text' && remote.kind !== 'shape' && remote.kind !== 'connector')
  ) {
    return null;
  }
  const kind: 'text' | 'shape' | 'connector' = remote.kind;
  return {
    id: localElementId,
    slideId: localSlideId,
    name: remote.name,
    kind,
    bbox: fitBox(remote.bbox),
    rotation: remote.rotation,
    style: remote.style,
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native', 'google_importable'],
    version: 1,
    ...(remote.content !== undefined ? { content: remote.content } : {}),
    ...(remote.altText ? { altText: remote.altText } : {}),
  };
}

function unsupportedRemoteAddition(element: NormalizedPresentationElement): SyncDiagnostic {
  return {
    code: 'google_remote_element_addition_unsupported',
    severity: 'warning',
    remoteId: element.remoteId,
    message: `Remote ${element.rawKind} ${element.remoteId} was not imported because it lacks a lossless NodeSlide representation.`,
  };
}

function absoluteTransform(
  box: BoundingBox,
  rotation: number,
  remote: NormalizedPresentationElement,
  presentation: NormalizedPresentationState,
): Required<GoogleAffineTransform> | null {
  if (!remote.intrinsicWidthEmu || !remote.intrinsicHeightEmu) return null;
  const width = box.width * presentation.pageWidthEmu;
  const height = box.height * presentation.pageHeightEmu;
  const scaleX = width / remote.intrinsicWidthEmu;
  const scaleY = height / remote.intrinsicHeightEmu;
  const radians = (rotation * Math.PI) / 180;
  return {
    scaleX: Math.cos(radians) * scaleX,
    scaleY: Math.cos(radians) * scaleY,
    shearX: -Math.sin(radians) * scaleY,
    shearY: Math.sin(radians) * scaleX,
    translateX: box.x * presentation.pageWidthEmu,
    translateY: box.y * presentation.pageHeightEmu,
    unit: 'EMU',
  };
}

function googleElementProperties(
  box: BoundingBox,
  remoteSlideId: string,
  presentation: NormalizedPresentationState,
): GooglePageElementProperties {
  const fitted = fitBox(box);
  return {
    pageObjectId: remoteSlideId,
    size: {
      width: { magnitude: fitted.width * presentation.pageWidthEmu, unit: 'EMU' },
      height: { magnitude: fitted.height * presentation.pageHeightEmu, unit: 'EMU' },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      translateX: fitted.x * presentation.pageWidthEmu,
      translateY: fitted.y * presentation.pageHeightEmu,
      unit: 'EMU',
    },
  };
}

function textStyleRequest(objectId: string, style: ElementStyle): GoogleSlidesRequest | null {
  const googleStyle: GoogleTextStyle = {};
  const fields: string[] = [];
  if (style.fontFamily) {
    googleStyle.fontFamily = style.fontFamily;
    fields.push('fontFamily');
  }
  if (style.fontSize !== undefined) {
    googleStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
    fields.push('fontSize');
  }
  if (style.fontWeight !== undefined) {
    googleStyle.bold = style.fontWeight >= 600;
    fields.push('bold');
  }
  const color = style.color ? hexToRgb(style.color) : null;
  if (color) {
    googleStyle.foregroundColor = { opaqueColor: { rgbColor: color } };
    fields.push('foregroundColor');
  }
  if (fields.length === 0) return null;
  return {
    updateTextStyle: {
      objectId,
      style: googleStyle,
      textRange: { type: 'ALL' },
      fields: fields.join(','),
    },
  };
}

function googleSlideReorderRequests(
  currentOrder: readonly string[],
  desiredOrder: readonly string[],
): GoogleSlidesRequest[] {
  const working = [...currentOrder];
  const requests: GoogleSlidesRequest[] = [];
  desiredOrder.forEach((remoteId, desiredIndex) => {
    const from = working.indexOf(remoteId);
    if (from < 0 || from === desiredIndex) return;
    requests.push({
      updateSlidesPosition: {
        slideObjectIds: [remoteId],
        insertionIndex: from < desiredIndex ? desiredIndex + 1 : desiredIndex,
      },
    });
    working.splice(from, 1);
    working.splice(desiredIndex, 0, remoteId);
  });
  return requests;
}

function reorderSlideOperations(
  currentOrder: readonly string[],
  desiredMappedOrder: readonly string[],
): PatchOperation[] {
  const working = [...currentOrder];
  const operations: PatchOperation[] = [];
  desiredMappedOrder.forEach((slideId, desiredIndex) => {
    const currentIndex = working.indexOf(slideId);
    if (currentIndex < 0 || currentIndex === desiredIndex) return;
    operations.push({ op: 'reorder_slide', slideId, index: desiredIndex });
    working.splice(currentIndex, 1);
    working.splice(desiredIndex, 0, slideId);
  });
  return operations;
}

function reorderElementOperations(
  slide: Slide,
  desiredMappedOrder: readonly string[],
): PatchOperation[] {
  const working = [...slide.elementOrder];
  const operations: PatchOperation[] = [];
  desiredMappedOrder.forEach((elementId, desiredIndex) => {
    const currentIndex = working.indexOf(elementId);
    if (currentIndex < 0 || currentIndex === desiredIndex) return;
    operations.push({
      op: 'reorder_element_v1',
      slideId: slide.id,
      elementId,
      index: desiredIndex,
    });
    working.splice(currentIndex, 1);
    working.splice(desiredIndex, 0, elementId);
  });
  return operations;
}

type ThreeWayState = 'none' | 'same' | 'local' | 'remote' | 'conflict';

function threeWayState<T>(baseLocal: T, local: T, baseRemote: T, remote: T): ThreeWayState {
  const localChanged = !same(baseLocal, local);
  const remoteChanged = !same(baseRemote, remote);
  if (!localChanged && !remoteChanged) return 'none';
  if (localChanged && remoteChanged) return same(local, remote) ? 'same' : 'conflict';
  return localChanged ? 'local' : 'remote';
}

function planField<T>(input: {
  path: string;
  baseLocal: T;
  local: T;
  baseRemote: T;
  remote: T;
  localId?: string;
  remoteId?: string;
  conflicts: SyncConflict[];
  onRemote(value: T): void;
  onLocal(value: T): void;
}): void {
  const state = threeWayState(input.baseLocal, input.local, input.baseRemote, input.remote);
  if (state === 'remote') input.onRemote(input.remote);
  else if (state === 'local') input.onLocal(input.local);
  else if (state === 'conflict') {
    input.conflicts.push(
      concurrentConflict(
        input.path,
        input.baseLocal,
        input.local,
        input.remote,
        input.localId,
        input.remoteId,
      ),
    );
  }
}

function concurrentConflict(
  path: string,
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  localId: string | undefined,
  remoteId: string | undefined,
): SyncConflict {
  return {
    code: 'concurrent_change',
    path,
    message: `NodeSlide and Google Slides changed ${path} differently since the sync baseline.`,
    resolution: 'manual',
    baseValue,
    localValue,
    remoteValue,
    ...(localId ? { localId } : {}),
    ...(remoteId ? { remoteId } : {}),
  };
}

function deleteEditConflict(
  path: string,
  message: string,
  localId: string,
  remoteId: string,
): SyncConflict {
  return { code: 'delete_vs_edit', path, message, resolution: 'manual', localId, remoteId };
}

function localSlideValue(slide: Slide): unknown {
  return { title: slide.title, notes: slide.notes ?? '', background: slide.background };
}

function localSlideFingerprint(slide: Slide): string {
  return syncSemanticFingerprint(localSlideValue(slide));
}

function slideValue(slide: NormalizedPresentationSlide): unknown {
  return { title: slide.title, notes: slide.notes ?? '', background: slide.background };
}

function remoteSlideFingerprint(slide: NormalizedPresentationSlide): string {
  return syncSemanticFingerprint(slideValue(slide));
}

function localElementValue(element: SlideElement): unknown {
  return {
    kind: element.kind,
    bbox: canonicalBox(element.bbox),
    rotation: canonicalNumber(element.rotation),
    content: element.content ?? '',
    style: element.style,
    imageUrl: element.imageUrl ?? '',
    altText: element.altText ?? '',
  };
}

function localElementFingerprint(element: SlideElement): string {
  return syncSemanticFingerprint(localElementValue(element));
}

function remoteElementValue(element: NormalizedPresentationElement): unknown {
  return {
    kind: element.kind,
    bbox: canonicalBox(element.bbox),
    rotation: canonicalNumber(element.rotation),
    content: element.content ?? '',
    style: element.style,
    imageUrl: element.imageUrl ?? '',
    altText: element.altText ?? '',
  };
}

function remoteElementFingerprint(element: NormalizedPresentationElement): string {
  return syncSemanticFingerprint(remoteElementValue(element));
}

function canonicalBox(box: BoundingBox): BoundingBox {
  return {
    x: canonicalNumber(box.x),
    y: canonicalNumber(box.y),
    width: canonicalNumber(box.width),
    height: canonicalNumber(box.height),
  };
}

function canonicalNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function samePosition(left: BoundingBox, right: BoundingBox): boolean {
  return (
    canonicalNumber(left.x) === canonicalNumber(right.x) &&
    canonicalNumber(left.y) === canonicalNumber(right.y)
  );
}

function sameSize(left: BoundingBox, right: BoundingBox): boolean {
  return (
    canonicalNumber(left.width) === canonicalNumber(right.width) &&
    canonicalNumber(left.height) === canonicalNumber(right.height)
  );
}

function same(left: unknown, right: unknown): boolean {
  return syncSemanticEqual(left, right);
}

function fitBox(box: BoundingBox): BoundingBox {
  const x = Math.max(0, Math.min(1, box.x));
  const y = Math.max(0, Math.min(1, box.y));
  return {
    x,
    y,
    width: Math.max(0.000_001, Math.min(box.width, 1 - x)),
    height: Math.max(0.000_001, Math.min(box.height, 1 - y)),
  };
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function byRemoteId<T extends { remoteId: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.remoteId, item]));
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (!match?.[1]) return null;
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16) / 255,
    green: Number.parseInt(match[1].slice(2, 4), 16) / 255,
    blue: Number.parseInt(match[1].slice(4, 6), 16) / 255,
  };
}

function googleObjectId(kind: 'slide' | 'element', localId: string): string {
  const stem = localId.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 30) || 'object';
  return `ns_${kind}_${stem}_${fnv1a(localId)}`.slice(0, 50);
}

function uniqueLocalId(prefix: string, remoteId: string, existing: Set<string>): string {
  const stem = remoteId.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 64) || 'object';
  const base = `${prefix}:${stem}`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}:${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function validateInputs(input: GoogleSlidesThreeWaySyncInput): void {
  const { baseline, local, remote } = input;
  if (baseline.mapping.provider !== 'google_slides' || remote.provider !== 'google_slides') {
    throw new Error('Google Slides planning requires google_slides baseline and remote state.');
  }
  if (baseline.local.deck.id !== local.deck.id || baseline.mapping.localDeckId !== local.deck.id) {
    throw new Error('Sync baseline, mapping, and current local snapshot must reference one deck.');
  }
  if (
    baseline.remote.remotePresentationId !== remote.remotePresentationId ||
    baseline.mapping.remotePresentationId !== remote.remotePresentationId
  ) {
    throw new Error(
      'Sync baseline, mapping, and current remote state must reference one presentation.',
    );
  }
}
