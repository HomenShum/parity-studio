import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import type { ChatStatus, FileUIPart } from 'ai';
import { Check, ChevronsUpDown, Paperclip, ShieldCheck, Sparkles } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_DEFAULT_AGENT_MODEL,
  type NodeSlideAgentModelId,
  type NodeSlideReasoningEffort,
  nodeSlideAgentModel,
  nodeSlideProviderModeForModel,
} from '../../../../shared/nodeslide';
import {
  NODESLIDE_CREATE_ATTACHMENT_MAX_FILES,
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
} from '../../../../shared/nodeslideAttachments';
import { useOptionalAgentSession } from '../session/AgentSessionProvider';
import {
  type NodeSlideComposerAttachmentDraft,
  type NodeSlideComposerSessionController,
  createNodeSlideComposerAttachmentDraft,
} from './nodeSlideComposerSession';

export type NodeSlideComposerModelValue = 'deterministic' | NodeSlideAgentModelId;

export const NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT: NodeSlideReasoningEffort = 'medium';

export interface NodeSlidePromptComposerSubmit {
  text: string;
  files: File[];
}

export interface NodeSlidePromptComposerProps {
  session: NodeSlideComposerSessionController;
  model: NodeSlideComposerModelValue;
  onModelChange: (model: NodeSlideComposerModelValue) => void;
  modelLabel: string;
  modelTestId: string;
  effort?: NodeSlideReasoningEffort;
  effortOptions?: readonly { id: NodeSlideReasoningEffort }[];
  onEffortChange?: (effort: NodeSlideReasoningEffort) => void;
  effortLabel?: string;
  effortTestId?: string;
  onSubmit: (
    message: NodeSlidePromptComposerSubmit,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
  placeholder: string;
  textareaLabel: string;
  textareaId?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaRows?: number;
  textareaMaxLength?: number;
  onTextChange?: (value: string, cursor: number) => void;
  onTextareaSelect?: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  textareaAria?: {
    'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both';
    'aria-controls'?: string;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
  };
  status?: ChatStatus;
  /** Locks every submission-defining control while a request is being prepared. */
  interactionDisabled?: boolean;
  disabled?: boolean;
  submitLabel: string;
  submitTestId?: string;
  submitContent?: ReactNode;
  showSubmit?: boolean;
  formId?: string;
  clearAttachmentsOnSubmit?: boolean;
  allowAttachments?: boolean;
  /**
   * Attachment availability is intentionally independent from submit readiness.
   * A fresh user must be able to begin with evidence before writing an instruction.
   */
  attachmentDisabled?: boolean;
  attachmentInputTestId?: string;
  attachButtonTestId?: string;
  attachLabel?: string;
  attachmentAccept?: string;
  attachmentMaxFiles?: number;
  onAttachmentError?: (message: string | null) => void;
  onAttachmentsChange?: () => void;
  onAttachmentSyncingChange?: (syncing: boolean) => void;
  /** Invalidates an in-flight attachment conversion when authority or scope changes. */
  submissionRevision?: string | number;
  onSubmissionPreparingChange?: (preparing: boolean) => void;
  tools?: ReactNode;
  submitTools?: ReactNode;
  footerStatus?: ReactNode;
  header?: ReactNode;
  className?: string;
  composerClassName?: string;
}

const DATA_FILE_ACCEPT =
  '.csv,.json,.txt,.md,.pdf,text/csv,application/json,text/plain,text/markdown,application/pdf';

const NATIVE_EFFORT_LABELS: Record<NodeSlideReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

export function nodeSlideNativeEffortLabel(effort: NodeSlideReasoningEffort): string {
  return NATIVE_EFFORT_LABELS[effort];
}

export function NodeSlidePromptComposer({
  session,
  model,
  onModelChange,
  modelLabel,
  modelTestId,
  effort,
  effortOptions = [],
  onEffortChange,
  effortLabel = 'Reasoning effort',
  effortTestId,
  onSubmit,
  placeholder,
  textareaLabel,
  textareaId,
  textareaRef,
  textareaRows = 3,
  textareaMaxLength,
  onTextChange,
  onTextareaSelect,
  onTextareaKeyDown,
  textareaAria,
  status = 'ready',
  interactionDisabled = false,
  disabled = false,
  submitLabel,
  submitTestId,
  submitContent,
  showSubmit = true,
  formId,
  clearAttachmentsOnSubmit = true,
  allowAttachments = true,
  attachmentDisabled,
  attachmentInputTestId,
  attachButtonTestId,
  attachLabel = 'Attach data file',
  attachmentAccept = DATA_FILE_ACCEPT,
  attachmentMaxFiles = NODESLIDE_CREATE_ATTACHMENT_MAX_FILES,
  onAttachmentError,
  onAttachmentsChange,
  onAttachmentSyncingChange,
  submissionRevision,
  onSubmissionPreparingChange,
  tools,
  submitTools,
  footerStatus,
  header,
  className,
  composerClassName,
}: NodeSlidePromptComposerProps) {
  const generatedFormId = useId();
  const resolvedFormId = formId ?? `nodeslide-prompt-${generatedFormId.replace(/:/g, '')}`;
  const agentSession = useOptionalAgentSession();
  const authoritativeModel = agentSession?.state.controls.model ?? model;
  const authoritativeEffort = agentSession?.state.controls.effort ?? effort;
  const authoritativeEffortLabel = authoritativeEffort
    ? nodeSlideNativeEffortLabel(authoritativeEffort)
    : undefined;
  const attachmentControlDisabled =
    interactionDisabled || Boolean(attachmentDisabled) || status === 'submitted';
  const submissionRevisionRef = useRef(submissionRevision);
  submissionRevisionRef.current = submissionRevision;
  const preparingRevisionRef = useRef<string | number | undefined>(undefined);
  const lifecycleRevisionRef = useRef(0);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const capturePortalContainer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const owner = node.closest<HTMLElement>('dialog, .nodeslide-studio');
    setPortalContainer(owner ?? node.ownerDocument.body);
  }, []);
  const handleAttachmentInputError = useCallback(
    (error: { message: string }) => onAttachmentError?.(error.message),
    [onAttachmentError],
  );

  useEffect(
    () => () => {
      lifecycleRevisionRef.current += 1;
      preparingRevisionRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (!agentSession || model === authoritativeModel) return;
    onModelChange(authoritativeModel);
  }, [agentSession, authoritativeModel, model, onModelChange]);

  useEffect(() => {
    if (
      !agentSession ||
      !effort ||
      !authoritativeEffort ||
      effort === authoritativeEffort ||
      !onEffortChange
    ) {
      return;
    }
    onEffortChange(authoritativeEffort);
  }, [agentSession, authoritativeEffort, effort, onEffortChange]);

  const chooseModel = useCallback(
    (next: NodeSlideComposerModelValue) => {
      agentSession?.updateControls({ model: next });
      onModelChange(next);
    },
    [agentSession, onModelChange],
  );
  const chooseEffort = useCallback(
    (next: NodeSlideReasoningEffort) => {
      agentSession?.updateControls({ effort: next });
      onEffortChange?.(next);
    },
    [agentSession, onEffortChange],
  );

  const handleSubmissionPreparingChange = useCallback(
    (preparing: boolean) => {
      if (preparing) preparingRevisionRef.current = submissionRevisionRef.current;
      onSubmissionPreparingChange?.(preparing);
      if (!preparing) preparingRevisionRef.current = undefined;
    },
    [onSubmissionPreparingChange],
  );

  const handleSubmit = async (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    const submittedRevision = preparingRevisionRef.current ?? submissionRevisionRef.current;
    const submittedLifecycleRevision = lifecycleRevisionRef.current;
    onAttachmentError?.(null);
    try {
      const files = await promptInputMessageFiles(message.files);
      if (
        submittedLifecycleRevision !== lifecycleRevisionRef.current ||
        (submittedRevision !== undefined && submittedRevision !== submissionRevisionRef.current)
      ) {
        throw new Error(
          'Change handling changed while attachments were being prepared. Review and submit again.',
        );
      }
      await onSubmit({ text: message.text, files }, event);
    } catch (error) {
      if (submittedLifecycleRevision === lifecycleRevisionRef.current) {
        onAttachmentError?.(
          error instanceof Error ? error.message : 'The attached file could not be read.',
        );
      }
      throw error;
    }
  };

  return (
    <div
      className={`ns-ai-elements ns-node-prompt-composer ${composerClassName ?? ''}`.trim()}
      ref={capturePortalContainer}
    >
      <PromptInput
        {...(allowAttachments ? { accept: attachmentAccept } : {})}
        className={`ns-prompt-input ${className ?? ''}`.trim()}
        clearOnSubmit={clearAttachmentsOnSubmit}
        fileInputProps={{
          ...(attachmentInputTestId ? { 'data-testid': attachmentInputTestId } : {}),
          id: `${resolvedFormId}-attachments`,
          name: `${resolvedFormId}-attachments`,
        }}
        id={resolvedFormId}
        key={session.key}
        maxFileSize={NODESLIDE_DATA_ATTACHMENT_MAX_BYTES}
        maxFiles={attachmentMaxFiles}
        multiple
        onError={handleAttachmentInputError}
        onSubmissionPreparingChange={handleSubmissionPreparingChange}
        onSubmit={handleSubmit}
      >
        <AttachmentSessionBridge
          session={session}
          {...(onAttachmentError ? { onError: onAttachmentError } : {})}
          {...(onAttachmentsChange ? { onAttachmentsChange } : {})}
          {...(onAttachmentSyncingChange ? { onSyncingChange: onAttachmentSyncingChange } : {})}
        />
        {header ? (
          <PromptInputHeader className="ns-prompt-header">{header}</PromptInputHeader>
        ) : null}
        <PromptInputAttachmentShelf />
        <PromptInputTextarea
          {...textareaAria}
          aria-label={textareaLabel}
          className="ns-prompt-textarea"
          disabled={interactionDisabled}
          id={textareaId}
          maxLength={textareaMaxLength}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const cursor = event.currentTarget.selectionStart;
            session.setText(value);
            onTextChange?.(value, cursor);
          }}
          onKeyDown={onTextareaKeyDown}
          onSelect={onTextareaSelect}
          placeholder={placeholder}
          ref={textareaRef}
          rows={textareaRows}
          value={session.text}
        />
        <PromptInputFooter className="ns-prompt-footer">
          <PromptInputTools className="ns-prompt-tools">
            {allowAttachments ? (
              <PromptInputAttachmentButton
                ariaLabel={attachLabel}
                disabled={attachmentControlDisabled}
                {...(attachButtonTestId ? { testId: attachButtonTestId } : {})}
              />
            ) : null}
            <NodeSlideModelSelector
              label={modelLabel}
              model={authoritativeModel}
              onChange={chooseModel}
              portalContainer={portalContainer}
              testId={modelTestId}
              disabled={interactionDisabled}
            />
            {authoritativeModel !== 'deterministic' &&
            authoritativeEffort &&
            effortOptions.length > 0 &&
            onEffortChange ? (
              <label className="ns-prompt-effort-wrap">
                <span className="sr-only">{effortLabel}</span>
                <select
                  aria-label={`${effortLabel}: ${authoritativeEffortLabel}`}
                  className="ns-prompt-effort"
                  data-testid={effortTestId}
                  disabled={interactionDisabled}
                  onChange={(event) =>
                    chooseEffort(event.currentTarget.value as NodeSlideReasoningEffort)
                  }
                  title={`${effortLabel}: ${authoritativeEffortLabel}`}
                  value={authoritativeEffort}
                >
                  {effortOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {nodeSlideNativeEffortLabel(option.id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {tools}
            {footerStatus ? <span className="ns-prompt-footer-status">{footerStatus}</span> : null}
          </PromptInputTools>
          {showSubmit ? (
            <div className="ns-prompt-submit-tools">
              {submitTools}
              <PromptInputSubmit
                aria-label={submitLabel}
                data-testid={submitTestId}
                disabled={disabled || interactionDisabled}
                size={submitContent ? 'sm' : 'icon-sm'}
                status={status}
              >
                {submitContent}
              </PromptInputSubmit>
            </div>
          ) : null}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

interface NodeSlideModelSelectorProps {
  disabled: boolean;
  label: string;
  model: NodeSlideComposerModelValue;
  onChange: (model: NodeSlideComposerModelValue) => void;
  portalContainer: HTMLElement | null;
  testId: string;
}

function NodeSlideModelSelector({
  disabled,
  label,
  model,
  onChange,
  portalContainer,
  testId,
}: NodeSlideModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const selected = model === 'deterministic' ? null : nodeSlideAgentModel(model);
  const currentProvider =
    model === 'deterministic'
      ? 'Private fallback'
      : providerName(nodeSlideProviderModeForModel(model));
  const currentLabel = model === 'deterministic' ? 'Deterministic' : selected?.label;
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const choose = (value: NodeSlideComposerModelValue) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <ModelSelector onOpenChange={(next) => !disabled && setOpen(next)} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton
          aria-label={label}
          data-testid={testId}
          className="ns-model-trigger"
          disabled={disabled}
        >
          {model === 'deterministic' ? (
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          ) : (
            <Sparkles aria-hidden="true" className="size-3.5" />
          )}
          <ModelSelectorName>
            {model === 'deterministic' ? 'Deterministic' : selected?.label}
          </ModelSelectorName>
          <ChevronsUpDown aria-hidden="true" className="ns-model-trigger-chevron" />
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        aria-describedby={descriptionId}
        className="ns-ai-elements-portal ns-model-selector-content"
        overlayClassName="ns-model-selector-overlay"
        portalContainer={portalContainer}
        title={label}
      >
        <header className="ns-model-selector-header">
          <span className="ns-model-selector-eyebrow">Model routing</span>
          <h2>Choose the agent model</h2>
          <p id={descriptionId}>Applies to this session. Nothing runs until you propose.</p>
          <div
            aria-label={`Current route: ${currentLabel} via ${currentProvider}`}
            className="ns-model-current-route"
          >
            <span>Current</span>
            <strong>{currentLabel}</strong>
            <small>via {currentProvider}</small>
          </div>
        </header>
        <ModelSelectorInput
          className="ns-model-selector-search"
          placeholder="Search models or providers"
        />
        <ModelSelectorList className="ns-model-selector-list">
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Recommended">
            <ModelOption
              model={NODESLIDE_DEFAULT_AGENT_MODEL}
              onSelect={choose}
              selected={model === NODESLIDE_DEFAULT_AGENT_MODEL}
            />
          </ModelSelectorGroup>
          <ModelSelectorGroup heading="More live models">
            {NODESLIDE_AGENT_MODELS.filter(
              (option) => option.id !== NODESLIDE_DEFAULT_AGENT_MODEL,
            ).map((option) => (
              <ModelOption
                key={option.id}
                model={option.id}
                onSelect={choose}
                selected={model === option.id}
              />
            ))}
          </ModelSelectorGroup>
          <ModelSelectorGroup heading="Private fallback">
            <ModelSelectorItem
              aria-current={model === 'deterministic' ? 'true' : undefined}
              className={`ns-model-option ${model === 'deterministic' ? 'is-current' : ''}`.trim()}
              onSelect={() => choose('deterministic')}
              value="deterministic private fallback no external model"
            >
              <span className="ns-model-option-icon is-private">
                <ShieldCheck aria-hidden="true" />
              </span>
              <span className="ns-model-option-copy">
                <span className="ns-model-option-title">
                  <strong>Deterministic</strong>
                  <small>Private</small>
                </span>
                <span className="ns-model-option-meta">No external model egress</span>
              </span>
              {model === 'deterministic' ? (
                <span className="ns-model-current-badge">
                  <Check aria-hidden="true" />
                  Current
                </span>
              ) : null}
            </ModelSelectorItem>
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function ModelOption({
  model,
  onSelect,
  selected,
}: {
  model: NodeSlideAgentModelId;
  onSelect: (model: NodeSlideComposerModelValue) => void;
  selected: boolean;
}) {
  const option = nodeSlideAgentModel(model);
  const provider = providerName(nodeSlideProviderModeForModel(model));
  return (
    <ModelSelectorItem
      aria-current={selected ? 'true' : undefined}
      className={`ns-model-option ${selected ? 'is-current' : ''}`.trim()}
      onSelect={() => onSelect(model)}
      value={`${option.label} ${option.vendor} ${provider} ${model}`}
    >
      <span className="ns-model-option-icon">
        <Sparkles aria-hidden="true" />
      </span>
      <span className="ns-model-option-copy">
        <span className="ns-model-option-title">
          <strong>{option.label}</strong>
          <small>{provider}</small>
        </span>
        <span className="ns-model-option-meta">
          {option.vendor} · {option.bestFor}
        </span>
      </span>
      {selected ? (
        <span className="ns-model-current-badge">
          <Check aria-hidden="true" />
          Current
        </span>
      ) : null}
    </ModelSelectorItem>
  );
}

function PromptInputAttachmentButton({
  ariaLabel,
  disabled,
  testId,
}: {
  ariaLabel: string;
  disabled: boolean;
  testId?: string;
}) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={() => attachments.openFileDialog()}
      title={ariaLabel}
    >
      <Paperclip aria-hidden="true" className="size-3.5" />
    </PromptInputButton>
  );
}

function PromptInputAttachmentShelf() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <PromptInputHeader className="ns-prompt-attachments" data-testid="composer-attachments">
      <Attachments aria-label="Attached data files" variant="inline">
        {attachments.files.map((file) => (
          <Attachment
            className="ns-prompt-attachment"
            data={file}
            key={file.id}
            onRemove={() => attachments.remove(file.id)}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove className="opacity-100" label={`Remove ${file.filename ?? 'file'}`} />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

function AttachmentSessionBridge({
  session,
  onError,
  onAttachmentsChange,
  onSyncingChange,
}: {
  session: NodeSlideComposerSessionController;
  onError?: (message: string | null) => void;
  onAttachmentsChange?: () => void;
  onSyncingChange?: (syncing: boolean) => void;
}) {
  const attachments = usePromptInputAttachments();
  const { add, files } = attachments;
  const setSessionAttachments = session.setAttachments;
  const hydration = useRef<'pending' | 'requested' | 'ready'>('pending');
  const syncVersion = useRef(0);
  const committedFilesSignature = useRef<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const filesSignature = files
    .map((file) => [file.id, file.filename, file.mediaType].join('\u001f'))
    .join('\u001e');

  useEffect(() => {
    if (hydration.current === 'ready') return;
    if (session.attachments.length > 0 && files.length === 0) {
      if (hydration.current === 'pending') {
        hydration.current = 'requested';
        add(session.attachments.map(fileFromAttachmentDraft));
      }
      return;
    }
    hydration.current = 'ready';
  }, [add, files.length, session.attachments]);

  useEffect(() => {
    void filesSignature;
    if (hydration.current !== 'ready') return;
    // Parent callbacks can legitimately change identity after an attachment
    // validation error updates the surrounding surface. Only a real file-list
    // transition may clear that feedback or start another persistence pass.
    // Otherwise a rejected fourth file (whose signature is unchanged) can
    // briefly report the cap and then erase its own explanation on rerender.
    if (committedFilesSignature.current === filesSignature) return;
    committedFilesSignature.current = filesSignature;
    onAttachmentsChange?.();
    // A real attachment transition supersedes prior validation feedback. Clear
    // it at the start of this committed transition so an older async draft
    // conversion can never erase a newer max-files/accept error.
    onError?.(null);
    const version = ++syncVersion.current;
    const currentFiles = [...filesRef.current];
    onSyncingChange?.(currentFiles.length > 0);
    if (currentFiles.length === 0) {
      setSessionAttachments([]);
      onSyncingChange?.(false);
      return;
    }
    void Promise.all(currentFiles.map(attachmentDraftFromPart))
      .then((drafts) => {
        if (version !== syncVersion.current) return;
        setSessionAttachments(drafts);
        onSyncingChange?.(false);
      })
      .catch((error: unknown) => {
        if (version !== syncVersion.current) return;
        onError?.(error instanceof Error ? error.message : 'The attached file could not be saved.');
        onSyncingChange?.(false);
      });
  }, [filesSignature, onAttachmentsChange, onError, onSyncingChange, setSessionAttachments]);

  return null;
}

async function attachmentDraftFromPart(
  part: FileUIPart & { id: string },
): Promise<NodeSlideComposerAttachmentDraft> {
  const blob = await blobFromFilePart(part);
  return createNodeSlideComposerAttachmentDraft({
    id: part.id,
    name: part.filename ?? 'attachment.txt',
    mediaType: part.mediaType || blob.type || 'text/plain',
    content: await blob.text(),
  });
}

function fileFromAttachmentDraft(draft: NodeSlideComposerAttachmentDraft): File {
  return new File([draft.content], draft.name, {
    type: draft.mediaType,
    lastModified: draft.lastModified,
  });
}

export async function promptInputMessageFiles(parts: readonly FileUIPart[]): Promise<File[]> {
  return Promise.all(
    parts.map(async (part, index) => {
      const blob = await blobFromFilePart(part);
      return new File([blob], part.filename ?? `attachment-${index + 1}.txt`, {
        type: part.mediaType || blob.type || 'text/plain',
        lastModified: Date.now(),
      });
    }),
  );
}

async function blobFromFilePart(part: FileUIPart): Promise<Blob> {
  if (!part.url) throw new Error(`${part.filename ?? 'The attachment'} has no readable content.`);
  if (part.url.startsWith('data:')) return blobFromDataUrl(part.url, part.mediaType);
  const response = await fetch(part.url);
  if (!response.ok) throw new Error(`${part.filename ?? 'The attachment'} could not be read.`);
  return response.blob();
}

function blobFromDataUrl(dataUrl: string, fallbackType?: string): Blob {
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('The attachment data URL is malformed.');
  const header = dataUrl.slice(5, separator);
  const payload = dataUrl.slice(separator + 1);
  const base64 = header.endsWith(';base64');
  const mediaType = header.replace(/;base64$/u, '') || fallbackType || 'application/octet-stream';
  const decoded = base64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}

function providerName(mode: 'deterministic' | 'openrouter_free' | 'nebius'): string {
  if (mode === 'nebius') return 'Nebius';
  return mode === 'openrouter_free' ? 'OpenRouter' : 'Private';
}
