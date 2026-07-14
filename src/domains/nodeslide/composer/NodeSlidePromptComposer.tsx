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
import { Check, Paperclip, ShieldCheck, Sparkles } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useEffect,
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
  tools?: ReactNode;
  submitTools?: ReactNode;
  footerStatus?: ReactNode;
  header?: ReactNode;
  className?: string;
  composerClassName?: string;
}

const DATA_FILE_ACCEPT = '.csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown';

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
  tools,
  submitTools,
  footerStatus,
  header,
  className,
  composerClassName,
}: NodeSlidePromptComposerProps) {
  const attachmentControlDisabled = attachmentDisabled ?? status === 'submitted';
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

  const handleSubmit = async (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    try {
      const files = await promptInputMessageFiles(message.files);
      await onSubmit({ text: message.text, files }, event);
      onAttachmentError?.(null);
    } catch (error) {
      onAttachmentError?.(
        error instanceof Error ? error.message : 'The attached file could not be read.',
      );
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
        {...(attachmentInputTestId
          ? { fileInputProps: { 'data-testid': attachmentInputTestId } }
          : {})}
        id={formId}
        key={session.key}
        maxFileSize={NODESLIDE_DATA_ATTACHMENT_MAX_BYTES}
        maxFiles={attachmentMaxFiles}
        multiple
        onError={handleAttachmentInputError}
        onSubmit={handleSubmit}
      >
        <AttachmentSessionBridge
          session={session}
          {...(onAttachmentError ? { onError: onAttachmentError } : {})}
          {...(onAttachmentsChange ? { onAttachmentsChange } : {})}
        />
        {header ? <PromptInputHeader>{header}</PromptInputHeader> : null}
        <PromptInputAttachmentShelf />
        <PromptInputTextarea
          {...textareaAria}
          aria-label={textareaLabel}
          className="ns-prompt-textarea"
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
              model={model}
              onChange={onModelChange}
              portalContainer={portalContainer}
              testId={modelTestId}
            />
            {model !== 'deterministic' && effort && effortOptions.length > 0 && onEffortChange ? (
              <label className="ns-prompt-effort-wrap">
                <span className="sr-only">{effortLabel}</span>
                <select
                  aria-label={effortLabel}
                  className="ns-prompt-effort"
                  data-testid={effortTestId}
                  onChange={(event) =>
                    onEffortChange(event.currentTarget.value as NodeSlideReasoningEffort)
                  }
                  value={effort}
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
                disabled={disabled}
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
  label: string;
  model: NodeSlideComposerModelValue;
  onChange: (model: NodeSlideComposerModelValue) => void;
  portalContainer: HTMLElement | null;
  testId: string;
}

function NodeSlideModelSelector({
  label,
  model,
  onChange,
  portalContainer,
  testId,
}: NodeSlideModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = model === 'deterministic' ? null : nodeSlideAgentModel(model);
  const choose = (value: NodeSlideComposerModelValue) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton aria-label={label} data-testid={testId} className="ns-model-trigger">
          {model === 'deterministic' ? (
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          ) : (
            <Sparkles aria-hidden="true" className="size-3.5" />
          )}
          <ModelSelectorName>
            {model === 'deterministic' ? 'Deterministic' : selected?.label}
          </ModelSelectorName>
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        className="ns-ai-elements-portal ns-model-selector-content"
        portalContainer={portalContainer}
        title={label}
      >
        <ModelSelectorInput placeholder="Search models and providers…" />
        <ModelSelectorList>
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
              onSelect={() => choose('deterministic')}
              value="deterministic private fallback no external model"
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
              <span className="min-w-0 flex-1">
                <strong className="block">Deterministic</strong>
                <small className="block text-muted-foreground">No external model egress</small>
              </span>
              {model === 'deterministic' ? <Check aria-hidden="true" className="size-4" /> : null}
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
      onSelect={() => onSelect(model)}
      value={`${option.label} ${option.vendor} ${provider} ${model}`}
    >
      <Sparkles aria-hidden="true" className="size-4" />
      <span className="min-w-0 flex-1">
        <strong className="block">{option.label}</strong>
        <small className="block text-muted-foreground">
          {option.vendor} · {provider} · {option.bestFor}
        </small>
      </span>
      {selected ? <Check aria-hidden="true" className="size-4" /> : null}
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
}: {
  session: NodeSlideComposerSessionController;
  onError?: (message: string | null) => void;
  onAttachmentsChange?: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const { add, files } = attachments;
  const setSessionAttachments = session.setAttachments;
  const hydration = useRef<'pending' | 'requested' | 'ready'>('pending');
  const syncVersion = useRef(0);

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
    if (hydration.current !== 'ready') return;
    onAttachmentsChange?.();
    // A real attachment transition supersedes prior validation feedback. Clear
    // it at the start of this committed transition so an older async draft
    // conversion can never erase a newer max-files/accept error.
    onError?.(null);
    const version = ++syncVersion.current;
    const currentFiles = [...files];
    if (currentFiles.length === 0) {
      setSessionAttachments([]);
      return;
    }
    void Promise.all(currentFiles.map(attachmentDraftFromPart))
      .then((drafts) => {
        if (version !== syncVersion.current) return;
        setSessionAttachments(drafts);
      })
      .catch((error: unknown) => {
        if (version !== syncVersion.current) return;
        onError?.(error instanceof Error ? error.message : 'The attached file could not be saved.');
      });
  }, [files, onAttachmentsChange, onError, setSessionAttachments]);

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
