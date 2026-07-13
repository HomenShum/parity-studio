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
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NodeSlideAgentMemory,
  NodeSlideAgentMemoryCategory,
} from '../../../../shared/nodeslide';
import { useModalDialog } from './useModalDialog';

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

const categories: Array<{ id: NodeSlideAgentMemoryCategory; label: string }> = [
  { id: 'preference', label: 'Preference' },
  { id: 'instruction', label: 'Instruction' },
  { id: 'decision', label: 'Decision' },
  { id: 'fact', label: 'Fact' },
  { id: 'context', label: 'Context' },
];

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
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef: firstInputRef,
  });
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [category, setCategory] = useState<NodeSlideAgentMemoryCategory>('preference');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEditingId(null);
  }, [open]);

  const visible = useMemo(
    () => memories.filter((memory) => memory.status === status),
    [memories, status],
  );
  const activeCount = memories.filter((memory) => memory.status === 'active').length;
  const archivedCount = memories.length - activeCount;

  if (!open) return null;

  const createMemory = async () => {
    if (!content.trim()) return;
    setBusyId('create');
    setError(null);
    try {
      await onCreate(category, content);
      setContent('');
      onEnabledChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Memory could not be saved.');
    } finally {
      setBusyId(null);
    }
  };

  const runUpdate = async (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => {
    setBusyId(memoryId);
    setError(null);
    try {
      await onUpdate(memoryId, update);
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Memory could not be updated.');
    } finally {
      setBusyId(null);
    }
  };

  const removeMemory = async (memoryId: string) => {
    setBusyId(memoryId);
    setError(null);
    try {
      await onDelete(memoryId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Memory could not be deleted.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="ns-memory-dialog"
      aria-labelledby="ns-memory-title"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      data-testid="memory-dialog"
    >
      <div className="ns-memory-shell">
        <header className="ns-memory-header">
          <span className="ns-memory-mark" aria-hidden="true">
            <Brain size={18} />
          </span>
          <div>
            <span className="ns-eyebrow">Deck memory</span>
            <h1 id="ns-memory-title">What should this agent remember?</h1>
          </div>
          <button type="button" className="ns-icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="ns-memory-body">
          <section className="ns-memory-compose" aria-label="Add memory">
            <div className="ns-memory-compose-copy">
              <strong>Add durable context</strong>
              <small>
                Short, specific memories work best. You can edit or remove them anytime.
              </small>
            </div>
            <div className="ns-memory-compose-fields">
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as NodeSlideAgentMemoryCategory)
                }
                aria-label="Memory category"
              >
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <textarea
                ref={firstInputRef}
                rows={2}
                maxLength={800}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Example: Prefer concise executive headlines and cite every market claim."
              />
              <button
                type="button"
                onClick={() => void createMemory()}
                disabled={!content.trim() || busyId !== null}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </section>

          <div className="ns-memory-controls">
            <div className="ns-memory-tabs" role="tablist" aria-label="Memory status">
              <button
                type="button"
                role="tab"
                aria-selected={status === 'active'}
                className={status === 'active' ? 'is-active' : ''}
                onClick={() => setStatus('active')}
              >
                Active <span>{activeCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={status === 'archived'}
                className={status === 'archived' ? 'is-active' : ''}
                onClick={() => setStatus('archived')}
              >
                Archived <span>{archivedCount}</span>
              </button>
            </div>
            <label className="ns-memory-use-toggle">
              <input
                type="checkbox"
                checked={enabled && activeCount > 0}
                disabled={activeCount === 0}
                onChange={(event) => onEnabledChange(event.target.checked)}
              />
              <span>Use relevant memory in new runs</span>
            </label>
          </div>

          <section className="ns-memory-list" aria-live="polite">
            {loading ? (
              <div className="ns-memory-empty">Loading deck memory…</div>
            ) : visible.length === 0 ? (
              <div className="ns-memory-empty">
                <Brain size={20} />
                <strong>{status === 'active' ? 'No active memory yet' : 'Nothing archived'}</strong>
                <span>
                  {status === 'active'
                    ? 'Add a preference, decision, fact, or standing instruction above.'
                    : 'Archived memories remain private and can be restored.'}
                </span>
              </div>
            ) : (
              visible.map((memory) => (
                <article key={memory.id} className="ns-memory-item">
                  <div className="ns-memory-item-meta">
                    <span>{memory.category}</span>
                    <small>
                      {memory.useCount > 0
                        ? `used ${memory.useCount} time${memory.useCount === 1 ? '' : 's'}`
                        : 'not used yet'}
                    </small>
                  </div>
                  {editingId === memory.id ? (
                    <div className="ns-memory-edit">
                      <textarea
                        rows={3}
                        maxLength={800}
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                        aria-label="Edit memory"
                      />
                      <div>
                        <button
                          type="button"
                          onClick={() => void runUpdate(memory.id, { content: editingContent })}
                          disabled={!editingContent.trim() || busyId !== null}
                        >
                          <Check size={12} /> Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>{memory.content}</p>
                  )}
                  <div className="ns-memory-item-actions">
                    {status === 'active' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditingContent(memory.content);
                          }}
                          disabled={busyId !== null}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void runUpdate(memory.id, { status: 'archived' })}
                          disabled={busyId !== null}
                        >
                          <Archive size={12} /> Archive
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void runUpdate(memory.id, { status: 'active' })}
                        disabled={busyId !== null}
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => void removeMemory(memory.id)}
                      disabled={busyId !== null}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>

          <aside className="ns-memory-trust">
            <ShieldCheck size={15} />
            <span>
              <strong>Private to this deck.</strong> Public shares never include memory. When
              enabled, only a bounded relevant subset is sent with an explicitly consented
              external-model request. Trace stores IDs and digests—not memory text.
            </span>
          </aside>
          {error ? <output className="ns-memory-error">{error}</output> : null}
        </div>
      </div>
    </dialog>
  );
}
