import type {
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
} from '../../../../../shared/nodeslide';
import { NODESLIDE_SCOPE_SLIDE_LIMIT } from '../../../../../shared/nodeslide';
import {
  type LayerZOrderAction,
  SlideNavigator,
  type SlideNavigatorTab,
  normalizeSelectedSlideIds,
} from '../SlideNavigator';
import { createBlankSlide, duplicateSlide, elementScope, uniqueClientId } from './editorActions';

type ApplyOperations = (
  operations: PatchOperation[],
  scope: PatchScope,
  summary: string,
) => Promise<boolean>;

interface EditorNavigatorProps {
  workspace: NodeSlideWorkspace;
  orderedSlides: Slide[];
  activeSlide: Slide;
  activeSlideIndex: number;
  collapsed: boolean;
  activeTab: SlideNavigatorTab;
  collapsedSections: string[];
  propagationSlideIds: string[];
  selectedSlideIds: string[];
  selectedElementIds: string[];
  onSelectSlide: (slideId: string) => void;
  onSelectedSlideIdsChange: (slideIds: string[]) => void;
  onRemoveSelectedSlide: (slideId: string) => void;
  onToggleCollapsed: () => void;
  onTabChange: (tab: SlideNavigatorTab) => void;
  onCollapsedSectionsChange: (sections: string[] | ((current: string[]) => string[])) => void;
  onSelectedElementIdsChange: (elementIds: string[]) => void;
  applyOperations: ApplyOperations;
  onChangeElementZOrder: (elementIds: readonly string[], action: LayerZOrderAction) => void;
}

/** Owns navigator-only command wiring; Studio retains canonical workspace and mutation ownership. */
export function EditorNavigator({
  workspace,
  orderedSlides,
  activeSlide,
  activeSlideIndex,
  collapsed,
  activeTab,
  collapsedSections,
  propagationSlideIds,
  selectedSlideIds,
  selectedElementIds,
  onSelectSlide,
  onSelectedSlideIdsChange,
  onRemoveSelectedSlide,
  onToggleCollapsed,
  onTabChange,
  onCollapsedSectionsChange,
  onSelectedElementIdsChange,
  applyOperations,
  onChangeElementZOrder,
}: EditorNavigatorProps) {
  return (
    <SlideNavigator
      slides={orderedSlides}
      elements={workspace.elements}
      theme={workspace.deck.theme}
      activeSlideId={activeSlide.id}
      collapsed={collapsed}
      activeTab={activeTab}
      comments={workspace.comments}
      patches={workspace.patches}
      sources={workspace.sources}
      validations={workspace.validations}
      collapsedSections={collapsedSections}
      propagationSlideIds={propagationSlideIds}
      selectedSlideIds={selectedSlideIds}
      selectedElementIds={selectedElementIds}
      canAddSlide
      canDeleteSlide={orderedSlides.length > 1}
      onSelectSlide={onSelectSlide}
      onSelectedSlideIdsChange={(slideIds) =>
        onSelectedSlideIdsChange(
          normalizeSelectedSlideIds(
            orderedSlides.map((slide) => slide.id),
            slideIds.slice(0, NODESLIDE_SCOPE_SLIDE_LIMIT),
          ),
        )
      }
      onToggleCollapsed={onToggleCollapsed}
      onTabChange={onTabChange}
      onToggleSection={(section) =>
        onCollapsedSectionsChange((current) =>
          current.includes(section)
            ? current.filter((candidate) => candidate !== section)
            : [...current, section],
        )
      }
      onSelectedElementIdsChange={onSelectedElementIdsChange}
      onRenameSlide={(slideId, currentTitle) => {
        const title = window.prompt('Rename slide', currentTitle)?.trim();
        if (!title || title === currentTitle) return;
        void applyOperations(
          [{ op: 'update_slide', slideId, properties: { title } }],
          {
            kind: 'slide',
            deckId: workspace.deck.id,
            slideIds: [slideId],
            operationMode: 'unrestricted',
          },
          `Renamed slide to ${title}`,
        );
      }}
      onAddSlide={() => {
        const added = createBlankSlide(workspace, activeSlideIndex + 1);
        void applyOperations(
          [
            {
              op: 'add_slide',
              slide: added.slide,
              elements: added.elements,
              index: added.index,
            },
          ],
          { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
          `Added slide ${added.index + 1}`,
        ).then((accepted) => {
          if (accepted) onSelectSlide(added.slide.id);
        });
      }}
      onDuplicateSlide={(slideId) => {
        const added = duplicateSlide(workspace, slideId);
        if (!added) return;
        void applyOperations(
          [
            {
              op: 'add_slide',
              slide: added.slide,
              elements: added.elements,
              index: added.index,
            },
          ],
          { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
          `Duplicated ${added.slide.title}`,
        ).then((accepted) => {
          if (accepted) onSelectSlide(added.slide.id);
        });
      }}
      onDeleteSlide={(slideId) => {
        const index = orderedSlides.findIndex((slide) => slide.id === slideId);
        const fallback = orderedSlides[index + 1] ?? orderedSlides[index - 1];
        void applyOperations(
          [{ op: 'remove_slide', slideId }],
          { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
          `Deleted slide ${index + 1}`,
        ).then((accepted) => {
          if (!accepted) return;
          onRemoveSelectedSlide(slideId);
          if (fallback) onSelectSlide(fallback.id);
        });
      }}
      onReorderSlide={(slideId, index) =>
        void applyOperations(
          [{ op: 'reorder_slide', slideId, index }],
          {
            kind: 'slide',
            deckId: workspace.deck.id,
            slideIds: [slideId],
            operationMode: 'layout',
          },
          `Moved slide to position ${index + 1}`,
        )
      }
      onToggleElementVisibility={(elementId, visible) => {
        const element = workspace.elements.find((candidate) => candidate.id === elementId);
        if (!element) return;
        void applyOperations(
          [{ op: 'set_visibility_v1', slideId: element.slideId, elementId, visible }],
          elementScope(workspace.deck.id, [element]),
          `${visible ? 'Showed' : 'Hid'} ${element.name}`,
        );
      }}
      onGroupElements={(elementIds) => {
        const targets = elementIds
          .map((id) => workspace.elements.find((element) => element.id === id))
          .filter((element): element is SlideElement => element !== undefined);
        if (targets.length < 2 || targets.some((element) => element.slideId !== activeSlide.id)) {
          return;
        }
        void applyOperations(
          [
            {
              op: 'group_elements_v1',
              slideId: activeSlide.id,
              elementIds: targets.map((element) => element.id),
              groupId: uniqueClientId('group'),
            },
          ],
          elementScope(workspace.deck.id, targets),
          `Grouped ${targets.length} layers`,
        );
      }}
      onUngroupElements={(elementIds) => {
        const groupIds = new Set(
          elementIds.flatMap((id) => {
            const groupId = workspace.elements.find((element) => element.id === id)?.groupId;
            return groupId ? [groupId] : [];
          }),
        );
        const operations: PatchOperation[] = [];
        const members: SlideElement[] = [];
        for (const groupId of groupIds) {
          const groupMembers = workspace.elements.filter(
            (element) => element.slideId === activeSlide.id && element.groupId === groupId,
          );
          members.push(...groupMembers);
          operations.push({
            op: 'ungroup_elements_v1',
            slideId: activeSlide.id,
            elementIds: groupMembers.map((element) => element.id),
            groupId,
          });
        }
        void applyOperations(
          operations,
          elementScope(workspace.deck.id, members),
          `Ungrouped ${groupIds.size} layer group${groupIds.size === 1 ? '' : 's'}`,
        );
      }}
      onChangeElementZOrder={onChangeElementZOrder}
    />
  );
}
