import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Archive,
  Brain,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NodeSlideAgentMemory,
  NodeSlideAgentMemoryCategory,
  NodeSlideAgentMemoryStatus,
} from '../../../../shared/nodeslide';

interface NodeSlideMemoryDialogProps {
  open: boolean;
  memories: readonly NodeSlideAgentMemory[];
  loading?: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
  onCreate: (category: NodeSlideAgentMemoryCategory, content: string) => Promise<void>;
  onUpdate: (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => Promise<void>;
  onDelete: (memoryId: string) => Promise<void>;
}

type MemoryAction = 'archive' | 'restore' | 'delete';
type MemoryOperation = 'create' | 'edit' | MemoryAction;

interface PendingAction {
  memoryId: string;
  action: MemoryAction;
}

interface BusyOperation {
  id: string;
  operation: MemoryOperation;
}

const categories: Array<{ id: NodeSlideAgentMemoryCategory; label: string }> = [
  { id: 'preference', label: 'Preference' },
  { id: 'instruction', label: 'Instruction' },
  { id: 'decision', label: 'Decision' },
  { id: 'fact', label: 'Fact' },
  { id: 'context', label: 'Context' },
];

const categoryLabels: Record<NodeSlideAgentMemoryCategory, string> = {
  preference: 'Preference',
  instruction: 'Instruction',
  decision: 'Decision',
  fact: 'Fact',
  context: 'Context',
};

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function NodeSlideMemoryDialog({
  open,
  memories,
  loading = false,
  enabled,
  onEnabledChange,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: NodeSlideMemoryDialogProps) {
  const firstInputRef = useRef<HTMLTextAreaElement>(null);
  const editingInputRef = useRef<HTMLTextAreaElement>(null);
  const editingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [status, setStatus] = useState<NodeSlideAgentMemoryStatus>('active');
  const [category, setCategory] = useState<NodeSlideAgentMemoryCategory>('preference');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState<BusyOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
    setEditingId(null);
    setPendingAction(null);
    editingTriggerRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!editingId) return;
    editingInputRef.current?.focus({ preventScroll: true });
    editingInputRef.current?.select();
  }, [editingId]);

  const visible = useMemo(
    () => memories.filter((memory) => memory.status === status),
    [memories, status],
  );
  const activeCount = memories.filter((memory) => memory.status === 'active').length;
  const archivedCount = memories.length - activeCount;

  if (!open) return null;

  const createMemory = async () => {
    const nextContent = content.trim();
    if (!nextContent) return;
    setBusy({ id: 'create', operation: 'create' });
    setError(null);
    setNotice(null);
    try {
      await onCreate(category, nextContent);
      setContent('');
      setNotice(
        'Memory added as Active. Memory use was not changed; this entry is used only when relevant memory is enabled.',
      );
    } catch (cause) {
      setError(
        `${errorText(cause, 'Memory could not be saved.')} Your draft is still here. If the request was interrupted, reopen Deck memory and verify whether it was saved before retrying.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const runUpdate = async (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
    operation: Exclude<MemoryOperation, 'create' | 'delete'>,
  ) => {
    setBusy({ id: memoryId, operation });
    setError(null);
    setNotice(null);
    try {
      await onUpdate(memoryId, update);
      if (operation === 'edit') {
        setEditingId(null);
        setNotice('Memory updated. Its retention and enabled state did not change.');
      } else {
        setPendingAction(null);
        setNotice(actionSuccessMessage(operation));
      }
    } catch (cause) {
      setError(
        `${errorText(cause, `Memory could not be ${operation}d.`)} Your ${operation === 'edit' ? 'edit' : 'confirmation'} remains here. If the request was interrupted, reopen Deck memory and verify its current status before retrying.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const removeMemory = async (memoryId: string) => {
    setBusy({ id: memoryId, operation: 'delete' });
    setError(null);
    setNotice(null);
    try {
      await onDelete(memoryId);
      setPendingAction(null);
      setNotice('Memory deleted permanently. It is no longer available to future runs.');
    } catch (cause) {
      setError(
        `${errorText(cause, 'Memory could not be deleted.')} Your confirmation remains here. If the request was interrupted, reopen Deck memory and verify whether the memory still exists before retrying.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const beginEdit = (memory: NodeSlideAgentMemory, trigger: HTMLButtonElement) => {
    setPendingAction(null);
    setError(null);
    setNotice(null);
    editingTriggerRef.current = trigger;
    setEditingId(memory.id);
    setEditingContent(memory.content);
  };

  const cancelEdit = () => {
    const trigger = editingTriggerRef.current;
    editingTriggerRef.current = null;
    // The edit trigger stays mounted while the textarea is visible. Move focus before removing
    // the focused editor so the parent Radix focus scope never needs to recover to its container.
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    setEditingId(null);
  };

  const beginAction = (memoryId: string, action: MemoryAction) => {
    editingTriggerRef.current = null;
    setEditingId(null);
    setError(null);
    setNotice(null);
    setPendingAction({ memoryId, action });
  };

  const cancelAction = () => {
    setPendingAction(null);
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    if (pendingAction.action === 'delete') {
      void removeMemory(pendingAction.memoryId);
      return;
    }
    void runUpdate(
      pendingAction.memoryId,
      { status: pendingAction.action === 'archive' ? 'archived' : 'active' },
      pendingAction.action,
    );
  };

  const selectStatus = (nextStatus: NodeSlideAgentMemoryStatus) => {
    editingTriggerRef.current = null;
    setEditingId(null);
    setPendingAction(null);
    setStatus(nextStatus);
  };

  const operationStatus = busy ? operationStatusMessage(busy.operation) : null;
  const panelId = `ns-memory-${status}-panel`;
  const selectedTabId = `ns-memory-${status}-tab`;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="ns-memory-dialog"
        overlayClassName="ns-modal-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio')
        }
        showCloseButton={false}
        data-testid="memory-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstInputRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pendingAction) {
            event.preventDefault();
            cancelAction();
          } else if (editingId) {
            event.preventDefault();
            cancelEdit();
          }
        }}
        onPointerDownOutside={(event) => {
          if (pendingAction || editingId) event.preventDefault();
        }}
      >
        <div className="ns-memory-shell">
          <header className="ns-memory-header">
            <span className="ns-memory-mark" aria-hidden="true">
              <Brain size={18} />
            </span>
            <div>
              <span className="ns-eyebrow">Deck memory</span>
              <DialogTitle asChild>
                <h1>What should this agent remember?</h1>
              </DialogTitle>
              <DialogDescription className="ns-sr-only">
                Manage persistent, owner-only memory for this deck.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button type="button" className="ns-icon-button" aria-label="Close">
                <X size={16} />
              </button>
            </DialogClose>
          </header>

          <div className="ns-memory-body">
            <aside className="ns-memory-trust" data-testid="memory-scope-disclosure">
              <ShieldCheck size={15} aria-hidden="true" />
              <Collapsible>
                <CollapsibleTrigger>
                  <strong>
                    Deck-scoped, not account-wide · owner-gated · relevant use only when enabled
                  </strong>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p>
                    Only someone with this deck&apos;s owner access can view or change these
                    entries. Public shares and exported snapshots never include memory.
                  </p>
                  <p>
                    Active and archived entries are retained until you delete them. Archiving or
                    turning use off keeps the entry stored. Only relevant active memory can be used
                    in a new run, and only while <strong>Use relevant memory in new runs</strong> is
                    on. Memory text leaves NodeSlide only with an explicitly consented
                    external-model request; Trace stores memory IDs and digests, not memory text.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </aside>

            <section className="ns-memory-compose" aria-label="Add memory">
              <div className="ns-memory-compose-copy">
                <strong>Add durable context</strong>
                <small id="ns-memory-compose-consequence">
                  Saved as Active and retained until you delete it. Adding does not turn on memory
                  use.
                </small>
              </div>
              <div className="ns-memory-compose-fields">
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as NodeSlideAgentMemoryCategory)}
                  disabled={busy !== null}
                >
                  <SelectTrigger aria-label="Memory category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    portalContainer={
                      typeof document === 'undefined'
                        ? null
                        : document.querySelector<HTMLElement>('.nodeslide-studio')
                    }
                  >
                    {categories.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <textarea
                  ref={firstInputRef}
                  rows={2}
                  maxLength={800}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Example: Prefer concise executive headlines and cite every market claim."
                  aria-label="Memory text"
                  aria-describedby="ns-memory-compose-consequence"
                  disabled={busy !== null}
                />
                <button
                  type="button"
                  onClick={() => void createMemory()}
                  disabled={!content.trim() || busy !== null}
                >
                  <Plus size={13} /> {busy?.operation === 'create' ? 'Adding…' : 'Add'}
                </button>
              </div>
            </section>

            <div className="ns-memory-controls">
              <Tabs
                value={status}
                onValueChange={(value) => selectStatus(value as NodeSlideAgentMemoryStatus)}
                unstyled
              >
                <TabsList className="ns-memory-tabs" aria-label="Memory status" unstyled>
                  <TabsTrigger
                    value="active"
                    id="ns-memory-active-tab"
                    aria-controls="ns-memory-active-panel"
                    className={status === 'active' ? 'is-active' : ''}
                    unstyled
                  >
                    Active <span>{activeCount}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="archived"
                    id="ns-memory-archived-tab"
                    aria-controls="ns-memory-archived-panel"
                    className={status === 'archived' ? 'is-active' : ''}
                    unstyled
                  >
                    Archived <span>{archivedCount}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="ns-memory-compose-copy">
                <div className="ns-memory-use-toggle">
                  <Checkbox
                    id="nodeslide-memory-use-toggle"
                    type="button"
                    checked={enabled}
                    disabled={activeCount === 0 || busy !== null}
                    aria-describedby="ns-memory-use-consequence"
                    onCheckedChange={(checked) => {
                      const nextEnabled = checked === true;
                      onEnabledChange(nextEnabled);
                      setError(null);
                      setNotice(
                        nextEnabled
                          ? 'Memory use enabled for future runs. Each run still receives only relevant active memory.'
                          : 'Memory use disabled for future runs. Entries remain stored until you archive or delete them.',
                      );
                    }}
                  />
                  <label htmlFor="nodeslide-memory-use-toggle">
                    Use relevant memory in new runs
                  </label>
                </div>
                <small id="ns-memory-use-consequence">
                  {memoryUseConsequence(enabled, activeCount)}
                </small>
              </div>
            </div>

            <section
              id={panelId}
              className="ns-memory-list"
              role="tabpanel"
              aria-labelledby={selectedTabId}
              aria-live="polite"
              aria-busy={loading || busy !== null}
            >
              {loading ? (
                <output className="ns-memory-empty">Loading deck memory…</output>
              ) : visible.length === 0 ? (
                <output className="ns-memory-empty">
                  <Brain size={20} />
                  <strong>
                    {status === 'active' ? 'No active memory yet' : 'Nothing archived'}
                  </strong>
                  <span>
                    {status === 'active'
                      ? 'Nothing will be retrieved until you add or restore an active memory.'
                      : 'Archived memories stay stored, are excluded from runs, and can be restored.'}
                  </span>
                </output>
              ) : (
                visible.map((memory) => {
                  const contentId = `ns-memory-${memory.id}-content`;
                  const retentionId = `ns-memory-${memory.id}-retention`;
                  return (
                    <article
                      key={memory.id}
                      className="ns-memory-item"
                      aria-describedby={retentionId}
                    >
                      <div className="ns-memory-item-meta">
                        <span>Category: {categoryLabels[memory.category]}</span>
                        <small title={memory.sourceRunId}>
                          Source: {memorySourceLabel(memory)} · Status:{' '}
                          {memory.status === 'active' ? 'Active' : 'Archived'} · Usage:{' '}
                          {memory.useCount > 0
                            ? `${memory.useCount} run${memory.useCount === 1 ? '' : 's'}`
                            : 'Never used'}
                        </small>
                      </div>
                      {editingId === memory.id ? (
                        <div className="ns-memory-edit">
                          <textarea
                            ref={editingInputRef}
                            rows={3}
                            maxLength={800}
                            value={editingContent}
                            onChange={(event) => setEditingContent(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                              event.preventDefault();
                              event.stopPropagation();
                              cancelEdit();
                            }}
                            aria-label={`Edit memory: ${memory.content}`}
                            disabled={busy !== null}
                          />
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                void runUpdate(
                                  memory.id,
                                  { content: editingContent.trim() },
                                  'edit',
                                )
                              }
                              disabled={!editingContent.trim() || busy !== null}
                            >
                              <Check size={12} />
                              {busy?.id === memory.id && busy.operation === 'edit'
                                ? 'Saving…'
                                : 'Save edit'}
                            </button>
                            <button type="button" onClick={cancelEdit} disabled={busy !== null}>
                              Cancel edit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p id={contentId}>{memory.content}</p>
                      )}
                      <div className="ns-memory-item-meta">
                        <small>
                          <MemoryTimestamp label="Captured" value={memory.createdAt} /> ·{' '}
                          <MemoryTimestamp label="Updated" value={memory.updatedAt} /> ·{' '}
                          <MemoryTimestamp label="Last used" value={memory.lastUsedAt} />
                        </small>
                      </div>
                      <div className="ns-memory-item-meta">
                        <small id={retentionId}>
                          <strong>Retention:</strong> {memoryRetentionText(memory.status)}
                        </small>
                      </div>
                      <div className="ns-memory-item-actions">
                        {status === 'active' ? (
                          <>
                            <button
                              id={`ns-memory-${memory.id}-edit-action`}
                              type="button"
                              onClick={(event) => beginEdit(memory, event.currentTarget)}
                              disabled={busy !== null}
                              aria-describedby={`${contentId} ${retentionId}`}
                              aria-label={`Edit memory: ${memory.content}`}
                            >
                              <Pencil size={12} /> Edit
                            </button>
                            <MemoryActionControl
                              action="archive"
                              busy={busy}
                              enabled={enabled}
                              icon={<Archive size={12} />}
                              memory={memory}
                              onBegin={() => beginAction(memory.id, 'archive')}
                              onCancel={cancelAction}
                              onConfirm={confirmAction}
                              open={
                                pendingAction?.memoryId === memory.id &&
                                pendingAction.action === 'archive'
                              }
                              retentionId={retentionId}
                            />
                          </>
                        ) : (
                          <MemoryActionControl
                            action="restore"
                            busy={busy}
                            enabled={enabled}
                            icon={<RotateCcw size={12} />}
                            memory={memory}
                            onBegin={() => beginAction(memory.id, 'restore')}
                            onCancel={cancelAction}
                            onConfirm={confirmAction}
                            open={
                              pendingAction?.memoryId === memory.id &&
                              pendingAction.action === 'restore'
                            }
                            retentionId={retentionId}
                          />
                        )}
                        <MemoryActionControl
                          action="delete"
                          busy={busy}
                          enabled={enabled}
                          icon={<Trash2 size={12} />}
                          memory={memory}
                          onBegin={() => beginAction(memory.id, 'delete')}
                          onCancel={cancelAction}
                          onConfirm={confirmAction}
                          open={
                            pendingAction?.memoryId === memory.id &&
                            pendingAction.action === 'delete'
                          }
                          retentionId={retentionId}
                        />
                      </div>
                    </article>
                  );
                })
              )}
            </section>

            {operationStatus ? (
              <output className="ns-memory-trust" aria-live="polite" aria-atomic="true">
                <RotateCcw size={15} aria-hidden="true" />
                <span>
                  <strong>{operationStatus}</strong> Keep this dialog open while the change
                  finishes. If this view is interrupted, reopen Deck memory and verify the current
                  state before retrying.
                </span>
              </output>
            ) : null}
            {notice ? (
              <output className="ns-memory-trust" aria-live="polite" aria-atomic="true">
                <Check size={15} aria-hidden="true" />
                <span>{notice}</span>
              </output>
            ) : null}
            {error ? (
              <output className="ns-memory-error" role="alert" aria-atomic="true">
                {error}
              </output>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface MemoryActionControlProps {
  action: MemoryAction;
  busy: BusyOperation | null;
  enabled: boolean;
  icon: ReactNode;
  memory: NodeSlideAgentMemory;
  onBegin: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  retentionId: string;
}

function MemoryActionControl({
  action,
  busy,
  enabled,
  icon,
  memory,
  onBegin,
  onCancel,
  onConfirm,
  open,
  retentionId,
}: MemoryActionControlProps) {
  const confirmationRef = useRef<HTMLButtonElement>(null);
  const visibleLabel =
    action === 'delete' ? 'Delete' : action === 'archive' ? 'Archive' : 'Restore';
  const accessibleLabel =
    action === 'delete'
      ? `Delete memory permanently: ${memory.content}`
      : `${visibleLabel} memory: ${memory.content}`;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onBegin();
        else if (busy === null) onCancel();
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          id={`ns-memory-${memory.id}-${action}-action`}
          type="button"
          className={action === 'delete' ? 'is-danger' : undefined}
          disabled={busy !== null}
          aria-describedby={`ns-memory-${memory.id}-content ${retentionId}`}
          aria-label={accessibleLabel}
        >
          {icon} {visibleLabel}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="ns-memory-confirmation-dialog ns-memory-edit"
        overlayClassName="ns-modal-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio')
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmationRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          if (busy !== null) event.preventDefault();
        }}
      >
        <AlertDialogTitle>{actionTitle(action)}</AlertDialogTitle>
        <AlertDialogDescription>{actionConsequence(action, enabled)}</AlertDialogDescription>
        <div>
          <button
            ref={confirmationRef}
            type="button"
            className={action === 'delete' ? 'is-danger' : undefined}
            onClick={onConfirm}
            disabled={busy !== null}
          >
            {busy?.id === memory.id && busy.operation === action
              ? operationButtonLabel(action)
              : `Confirm ${action}`}
          </button>
          <AlertDialogCancel disabled={busy !== null}>
            {cancelActionLabel(action)}
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemoryTimestamp({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return <span>{label}: Never</span>;
  const date = new Date(value);
  return (
    <span>
      {label}:{' '}
      <time dateTime={date.toISOString()} title={date.toISOString()}>
        {timestampFormatter.format(date)}
      </time>
    </span>
  );
}

function memorySourceLabel(memory: NodeSlideAgentMemory): string {
  if (memory.source === 'user') return 'Deck owner';
  if (!memory.sourceRunId) return 'Agent';
  const runId = memory.sourceRunId;
  const compactRunId = runId.length > 18 ? `${runId.slice(0, 10)}…${runId.slice(-5)}` : runId;
  return `Agent · run ${compactRunId}`;
}

function memoryRetentionText(status: NodeSlideAgentMemoryStatus): string {
  return status === 'active'
    ? 'Stored until permanently deleted. Archiving keeps it stored but excludes it from runs.'
    : 'Still stored until permanently deleted. It cannot be used unless you restore it.';
}

function memoryUseConsequence(enabled: boolean, activeCount: number): string {
  if (activeCount === 0) {
    return enabled
      ? 'On, but no active entries are eligible. Restore or add memory to make relevant use possible.'
      : 'Unavailable until this deck has an active entry. Archived entries remain stored.';
  }
  return enabled
    ? 'On: each new run may retrieve only relevant active entries. This does not change existing runs.'
    : 'Off: new runs receive no memory. Entries remain stored and their status does not change.';
}

function actionTitle(action: MemoryAction): string {
  if (action === 'archive') return 'Archive this memory?';
  if (action === 'restore') return 'Restore this memory?';
  return 'Delete this memory permanently?';
}

function actionConsequence(action: MemoryAction, enabled: boolean): string {
  if (action === 'archive') {
    return 'It stays stored in this deck and can be restored, but archived memory is excluded from new runs.';
  }
  if (action === 'restore') {
    return enabled
      ? 'It becomes active and eligible for relevance matching because memory use is on. Restoring does not send it by itself.'
      : 'It becomes active, but cannot be used until you turn on relevant memory. Restoring does not send it by itself.';
  }
  return 'This removes the entry from the deck, cannot be undone, and prevents all future use of this memory.';
}

function actionSuccessMessage(action: Exclude<MemoryAction, 'delete'>): string {
  return action === 'archive'
    ? 'Memory archived. It remains stored, is excluded from new runs, and can be restored.'
    : 'Memory restored as Active. It is eligible only when relevant memory use is enabled.';
}

function operationStatusMessage(operation: MemoryOperation): string {
  if (operation === 'create') return 'Saving new memory…';
  if (operation === 'edit') return 'Saving memory changes…';
  if (operation === 'archive') return 'Archiving memory…';
  if (operation === 'restore') return 'Restoring memory…';
  return 'Deleting memory…';
}

function operationButtonLabel(action: MemoryAction): string {
  if (action === 'archive') return 'Archiving…';
  if (action === 'restore') return 'Restoring…';
  return 'Deleting…';
}

function cancelActionLabel(action: MemoryAction): string {
  if (action === 'archive') return 'Keep active';
  if (action === 'restore') return 'Keep archived';
  return 'Keep memory';
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
