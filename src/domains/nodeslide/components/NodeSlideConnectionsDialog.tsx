import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  Bot,
  Check,
  Clipboard,
  Code2,
  ExternalLink,
  KeyRound,
  Laptop,
  LoaderCircle,
  Presentation,
  ServerCog,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../convex/_generated/api';
import type { DeckSnapshot } from '../../../../shared/nodeslide';
import { nodeSlideSnapshotToPptxSyncDocument } from '../../../../shared/nodeslidePptxLink';
import {
  SESSION_BYOK_KEYS,
  clearSessionByok,
  maskKey,
  readSessionByok,
  readSessionByokRouting,
  writeSessionByok,
  writeSessionByokRouting,
} from '../../../lib/sessionByok';
import { listStoredDeckAccess } from '../../../lib/sessionIdentity';

interface NodeSlideConnectionsDialogProps {
  open: boolean;
  onClose: () => void;
  deckId?: string;
}

type ClientKind = 'claude' | 'codex';

export const NODESLIDE_MCP_PACKAGE =
  'https://parity-studio.vercel.app/downloads/parity-studio-mcp-0.4.0.tgz';
export const NODESLIDE_CONVEX_URL = 'https://blissful-pig-998.convex.cloud';

export function NodeSlideConnectionsDialog({
  open,
  onClose,
  deckId,
}: NodeSlideConnectionsDialogProps) {
  if (!open) return null;

  return <NodeSlideConnectionsDialogContent onClose={onClose} deckId={deckId} />;
}

function NodeSlideConnectionsDialogContent({
  onClose,
  deckId,
}: {
  onClose: () => void;
  deckId: string | undefined;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [routing, setRouting] = useState({ model: 'z-ai/glm-5.2', baseUrl: '' });
  const [client, setClient] = useState<ClientKind>('claude');
  const [notice, setNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [googleSyncBusy, setGoogleSyncBusy] = useState<
    | 'create'
    | 'attach'
    | 'pull'
    | 'finalize-pull'
    | 'plan-push'
    | 'execute-push'
    | 'cancel'
    | 'reset'
    | null
  >(null);
  const [googlePresentation, setGooglePresentation] = useState('');
  const [pptxBusy, setPptxBusy] = useState<'link' | 'plan' | 'verify' | 'finalize' | null>(null);

  const ownerAccessKey = listStoredDeckAccess().find(
    (entry) => entry.deckId === deckId,
  )?.ownerAccessKey;
  const googleStatus = useQuery(
    api.nodeslideGoogleAuth.getStatus,
    deckId && ownerAccessKey ? { deckId, ownerAccessKey } : 'skip',
  );
  const deckWorkspace = useQuery(
    api.nodeslide.getWorkspace,
    deckId && ownerAccessKey ? { deckId, ownerAccessKey } : 'skip',
  );
  const pptxLink = useQuery(
    api.nodeslidePptxSync.getLink,
    deckId && ownerAccessKey ? { deckId, ownerAccessKey } : 'skip',
  );
  const attachPptxBaseline = useMutation(api.nodeslidePptxSync.attachImportedBaseline);
  const planPptxImport = useMutation(api.nodeslidePptxSync.planImportedSnapshot);
  const verifyPptxOutbound = useMutation(api.nodeslidePptxSync.verifyOutboundSnapshot);
  const finalizePptxPlan = useMutation(api.nodeslidePptxSync.finalizePlan);
  const proposePptxPatch = useMutation(api.nodeslide.proposePatch);
  const beginGoogleAuth = useAction(api.nodeslideGoogleAuth.begin);
  const disconnectGoogleAuth = useAction(api.nodeslideGoogleAuth.disconnect);
  const googleRuntime = useQuery(
    api.nodeslideGoogleSlidesRuntime.getState,
    deckId && ownerAccessKey && googleStatus?.connected ? { deckId, ownerAccessKey } : 'skip',
  );
  const createGooglePresentation = useAction(api.nodeslideGoogleSlidesRuntime.createPresentation);
  const attachGooglePresentation = useAction(api.nodeslideGoogleSlidesRuntime.attachPresentation);
  const planGooglePull = useAction(api.nodeslideGoogleSlidesRuntime.planPull);
  const finalizeGooglePull = useAction(api.nodeslideGoogleSlidesRuntime.finalizePull);
  const planGooglePush = useAction(api.nodeslideGoogleSlidesRuntime.planPush);
  const executeGooglePush = useAction(api.nodeslideGoogleSlidesRuntime.executePush);
  const cancelGooglePending = useAction(api.nodeslideGoogleSlidesRuntime.cancelPending);
  const resetGoogleAttachment = useAction(api.nodeslideGoogleSlidesRuntime.resetAttachment);

  useEffect(() => {
    setKeys(readSessionByok());
    setRouting(readSessionByokRouting());
    setNotice(null);
  }, []);

  const configuredCount = SESSION_BYOK_KEYS.filter((key) => keys[key.envVar]?.trim()).length;
  const googleCanPlan =
    googleRuntime !== undefined &&
    googleRuntime !== null &&
    (googleRuntime.status === 'active' ||
      googleRuntime.status === 'conflict' ||
      googleRuntime.status === 'error') &&
    googleRuntime.errorCode !== 'bootstrap_mismatch';

  const save = () => {
    writeSessionByok(keys);
    writeSessionByokRouting(routing);
    setKeys(readSessionByok());
    setRouting(readSessionByokRouting());
    setNotice('Saved in this browser tab only. Nothing was sent to NodeSlide.');
  };

  const revoke = () => {
    clearSessionByok();
    setKeys({});
    setRouting({ model: 'z-ai/glm-5.2', baseUrl: '' });
    setNotice('Local connection values revoked from this tab.');
  };

  const connectGoogleSlides = async () => {
    if (!deckId || !ownerAccessKey) {
      setNotice('Open a deck owned by this browser before connecting Google Slides.');
      return;
    }
    setGoogleBusy('connect');
    setNotice(null);
    try {
      const returnTo = new URL(window.location.href);
      returnTo.searchParams.delete('nodeslideGoogle');
      const receipt = await beginGoogleAuth({
        deckId,
        ownerAccessKey,
        returnTo: returnTo.toString(),
      });
      window.location.assign(receipt.authorizationUrl);
    } catch {
      setNotice(
        'Google Slides connection could not start. Check the deployment configuration and try again.',
      );
      setGoogleBusy(null);
    }
  };

  const disconnectGoogleSlides = async () => {
    if (!deckId || !ownerAccessKey) return;
    setGoogleBusy('disconnect');
    setNotice(null);
    try {
      const receipt = await disconnectGoogleAuth({ deckId, ownerAccessKey });
      setNotice(
        receipt.providerRevoked
          ? 'Google Slides access was revoked for this deck.'
          : 'Google Slides was disconnected locally. Google did not confirm remote revocation.',
      );
    } catch {
      setNotice('Google Slides could not be disconnected. Try again.');
    } finally {
      setGoogleBusy(null);
    }
  };

  const runGoogleSyncAction = async (
    busy: NonNullable<typeof googleSyncBusy>,
    syncAction: () => Promise<{
      result?: string;
      operationCount?: number;
      verified?: boolean;
      presentationUrl?: string;
      cancelled?: boolean;
      reset?: boolean;
    }>,
  ) => {
    setGoogleSyncBusy(busy);
    setNotice(null);
    try {
      const receipt = await syncAction();
      setNotice(googleSyncNotice(busy, receipt));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google Slides sync could not complete.');
    } finally {
      setGoogleSyncBusy(null);
    }
  };

  const readPptxSyncFile = async (file: File) => {
    if (!deckId || !ownerAccessKey || !deckWorkspace) {
      throw new Error('Open an owned deck before linking PowerPoint.');
    }
    const baseSnapshot: DeckSnapshot = {
      deck: deckWorkspace.deck,
      slides: deckWorkspace.slides,
      elements: deckWorkspace.elements,
      sources: deckWorkspace.sources,
    };
    const payload = await file.arrayBuffer();
    const { createPptxImportCandidate } = await import('../slidelang/pptxImport');
    const imported = await createPptxImportCandidate(baseSnapshot, payload, {
      fileName: file.name,
    });
    if (!imported.ok) throw new Error(`PowerPoint import stopped: ${imported.error.message}`);
    const packageDigest = await sha256Digest(payload);
    const remoteDocument = nodeSlideSnapshotToPptxSyncDocument(imported.candidate.snapshot, {
      documentId: `nodeslide-pptx-${deckId}`,
      packageDigest,
    });
    return { candidate: imported.candidate, remoteDocument };
  };

  const linkOrPlanPptx = async (file: File) => {
    if (!deckId || !ownerAccessKey) return;
    setPptxBusy(pptxLink ? 'plan' : 'link');
    setNotice(null);
    try {
      const { candidate, remoteDocument } = await readPptxSyncFile(file);
      if (!pptxLink) {
        await attachPptxBaseline({ deckId, ownerAccessKey, importedSnapshot: remoteDocument });
        setNotice(
          'PowerPoint linked from an exact semantic match. Future file changes now produce a three-way review plan.',
        );
        return;
      }
      const planned = await planPptxImport({
        deckId,
        ownerAccessKey,
        expectedStateVersion: pptxLink.stateVersion,
        expectedBaselineDigest: pptxLink.baselineDigest,
        importedSnapshot: remoteDocument,
      });
      if (planned.status === 'conflict') {
        setNotice(
          `${planned.pendingPlan?.conflicts.length ?? 0} PowerPoint conflict${planned.pendingPlan?.conflicts.length === 1 ? '' : 's'} detected. Nothing was written.`,
        );
        return;
      }
      if ((planned.pendingPlan?.inbound.length ?? 0) > 0) {
        await proposePptxPatch({
          deckId: candidate.deckId,
          ownerAccessKey,
          baseDeckVersion: candidate.baseDeckVersion,
          baseSlideVersions: candidate.baseSlideVersions,
          baseElementVersions: candidate.baseElementVersions,
          scope: candidate.scope,
          operations: candidate.operations,
          summary: `Synchronize reviewed changes from ${file.name}.`,
        });
      }
      setNotice(
        `${planned.pendingPlan?.inbound.length ?? 0} inbound and ${planned.pendingPlan?.outbound.length ?? 0} outbound PowerPoint change${(planned.pendingPlan?.inbound.length ?? 0) + (planned.pendingPlan?.outbound.length ?? 0) === 1 ? '' : 's'} prepared. Review NodeSlide changes before finalizing.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PowerPoint sync could not be prepared.');
    } finally {
      setPptxBusy(null);
    }
  };

  const verifyPptxFile = async (file: File) => {
    if (!deckId || !ownerAccessKey || !pptxLink?.pendingPlanDigest) return;
    setPptxBusy('verify');
    setNotice(null);
    try {
      const { remoteDocument } = await readPptxSyncFile(file);
      await verifyPptxOutbound({
        deckId,
        ownerAccessKey,
        expectedStateVersion: pptxLink.stateVersion,
        planDigest: pptxLink.pendingPlanDigest,
        importedSnapshot: remoteDocument,
      });
      setNotice('The exported PowerPoint was re-imported and matched the reviewed outbound plan.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PowerPoint verification failed.');
    } finally {
      setPptxBusy(null);
    }
  };

  const finalizePptxSync = async () => {
    if (!deckId || !ownerAccessKey || !pptxLink?.pendingPlanDigest) return;
    setPptxBusy('finalize');
    setNotice(null);
    try {
      await finalizePptxPlan({
        deckId,
        ownerAccessKey,
        expectedStateVersion: pptxLink.stateVersion,
        expectedBaselineDigest: pptxLink.baselineDigest,
        planDigest: pptxLink.pendingPlanDigest,
      });
      setNotice('PowerPoint and NodeSlide now share a new verified three-way baseline.');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'PowerPoint finalization failed. Accept inbound work or verify the export first.',
      );
    } finally {
      setPptxBusy(null);
    }
  };

  const copyConfig = async () => {
    save();
    const env = Object.fromEntries(
      SESSION_BYOK_KEYS.flatMap((key) => {
        const value = keys[key.envVar]?.trim();
        return value ? [[key.envVar, value]] : [];
      }),
    );
    const fullEnv = {
      ...env,
      PARITY_CONVEX_URL: NODESLIDE_CONVEX_URL,
      PARITY_DASHBOARD: 'disabled',
      NODESLIDE_BYOK_MODEL: routing.model.trim() || 'z-ai/glm-5.2',
      ...(routing.baseUrl.trim() ? { NODESLIDE_BYOK_BASE_URL: routing.baseUrl.trim() } : {}),
      ...(ownerAccessKey ? { NODESLIDE_OWNER_ACCESS_KEY: ownerAccessKey } : {}),
    };
    const command = navigator.userAgent.includes('Windows') ? 'npx.cmd' : 'npx';
    const config =
      client === 'codex'
        ? buildNodeSlideCodexConfig(fullEnv, command)
        : buildNodeSlideMcpJson(fullEnv, command);
    await navigator.clipboard.writeText(config);
    setNotice(
      `${client === 'codex' ? 'Codex config.toml' : 'Claude Code / Cursor .mcp.json'} snippet copied. It contains the values shown here—treat the clipboard as sensitive.`,
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="ns-connections-dialog"
        overlayClassName="ns-modal-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio')
        }
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstInputRef.current?.focus();
        }}
      >
        <div className="ns-connections-shell">
        <header className="ns-connections-header">
          <span className="ns-connections-mark" aria-hidden="true">
            <ServerCog size={18} />
          </span>
          <div>
            <span className="ns-eyebrow">Models & agents</span>
            <DialogTitle asChild>
              <h1 id="ns-connections-title">Connect your own runtime</h1>
            </DialogTitle>
            <DialogDescription className="ns-sr-only">
              Configure PowerPoint, Google Slides, local provider keys, and coding-agent
              connections.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" className="ns-icon-button" aria-label="Close">
              <X size={16} />
            </button>
          </DialogClose>
        </header>

        <div className="ns-connections-body">
          {notice ? <output className="ns-connection-notice">{notice}</output> : null}
          <section className="ns-connection-section" aria-labelledby="ns-powerpoint-sync-title">
            <div className="ns-connection-heading">
              <span>
                <Presentation size={14} /> PowerPoint
              </span>
              <small>
                {pptxLink
                  ? `${pptxLink.status.replaceAll('_', ' ')} · baseline v${pptxLink.baselineLocalDeckVersion}`
                  : 'Review-gated three-way sync'}
              </small>
            </div>
            <h2 id="ns-powerpoint-sync-title">Keep an editable PPTX linked to this deck</h2>
            <p>
              Link an exported semantic match once. Later imports are compared against the exact
              shared baseline, so PowerPoint-only and NodeSlide-only edits become a bounded review
              plan. Conflicts stop before mutation; outbound files must be re-imported and verified.
            </p>
            <div className="ns-google-sync-actions" data-testid="nodeslide-pptx-sync">
              <label className="ns-connection-file-action">
                <input
                  type="file"
                  hidden
                  aria-label={pptxLink ? 'Import changed PowerPoint' : 'Link matching PowerPoint'}
                  accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                  disabled={!deckWorkspace || pptxBusy !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void linkOrPlanPptx(file);
                  }}
                />
                <span>
                  {pptxBusy === 'link' || pptxBusy === 'plan' ? (
                    <LoaderCircle className="ns-spin" size={13} />
                  ) : (
                    <Presentation size={13} />
                  )}
                  {pptxLink ? 'Import changed PPTX' : 'Link matching PPTX'}
                </span>
              </label>
              {pptxLink?.status === 'awaiting_outbound_verification' ? (
                <label className="ns-connection-file-action">
                  <input
                    type="file"
                    hidden
                    aria-label="Verify exported PowerPoint"
                    accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                    disabled={pptxBusy !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void verifyPptxFile(file);
                    }}
                  />
                  <span>
                    {pptxBusy === 'verify' ? (
                      <LoaderCircle className="ns-spin" size={13} />
                    ) : (
                      <Check size={13} />
                    )}
                    Verify exported PPTX
                  </span>
                </label>
              ) : null}
              {pptxLink?.pendingPlanDigest &&
              (pptxLink.status === 'awaiting_review' || pptxLink.status === 'ready_to_finalize') ? (
                <button
                  type="button"
                  className="is-primary"
                  disabled={pptxBusy !== null}
                  onClick={() => void finalizePptxSync()}
                >
                  {pptxBusy === 'finalize' ? (
                    <LoaderCircle className="ns-spin" size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                  Finalize verified sync
                </button>
              ) : null}
              {pptxLink?.pendingPlan ? (
                <output>
                  {pptxLink.pendingPlan.inbound.length} inbound ·{' '}
                  {pptxLink.pendingPlan.outbound.length} outbound ·{' '}
                  {pptxLink.pendingPlan.conflicts.length} conflicts
                </output>
              ) : null}
            </div>
          </section>

          <section
            className="ns-connection-section ns-google-connection-section"
            aria-labelledby="ns-google-slides-title"
          >
            <div className="ns-connection-heading">
              <span>
                <Presentation size={14} /> Google Slides
              </span>
              <small>
                {!deckId || !ownerAccessKey
                  ? 'Open an owned deck'
                  : googleStatus?.connected
                    ? 'OAuth authorized'
                    : googleStatus === undefined
                      ? 'Checking…'
                      : 'Not connected'}
              </small>
            </div>
            <h2 id="ns-google-slides-title">Authorize app-scoped Google Slides access</h2>
            <p>
              NodeSlide requests Google&apos;s <code>drive.file</code> scope. It covers
              presentations NodeSlide creates or that are explicitly opened with this app; it does
              not make an arbitrary pasted Drive ID readable. An existing target can link only when
              it is already app-authorized and is an exact semantic match for this deck. NodeSlide
              then stores the exact three-way baseline server-side. Conflicts stop before any write,
              and every remote write is read back and verified.
            </p>
            <div className="ns-google-connection-card" data-testid="nodeslide-google-connection">
              <div>
                <strong>
                  {googleStatus?.connected
                    ? googleRuntime
                      ? `Linked · ${googleRuntime.status.replaceAll('_', ' ')}`
                      : 'OAuth authorized · create or link a compatible target'
                    : 'Explicit Google consent'}
                </strong>
                <small>
                  {googleStatus?.connected
                    ? googleRuntime
                      ? `Baseline revision ${googleRuntime.baselineRemoteRevision}`
                      : 'Create an app-owned blank target, or link an exact app-authorized match.'
                    : 'drive.file is not broad Drive access and does not authorize arbitrary files.'}
                </small>
              </div>
              {googleStatus?.connected ? (
                <button
                  type="button"
                  className="is-danger"
                  disabled={googleBusy !== null}
                  onClick={() => void disconnectGoogleSlides()}
                >
                  {googleBusy === 'disconnect' ? (
                    <LoaderCircle className="ns-spin" size={13} />
                  ) : (
                    <Unplug size={13} />
                  )}
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!deckId || !ownerAccessKey || googleBusy !== null}
                  onClick={() => void connectGoogleSlides()}
                >
                  {googleBusy === 'connect' ? (
                    <LoaderCircle className="ns-spin" size={13} />
                  ) : (
                    <ExternalLink size={13} />
                  )}
                  Continue to Google
                </button>
              )}
            </div>
            {googleStatus?.connected ? (
              <div className="ns-google-sync-workbench">
                {!googleRuntime ? (
                  <>
                    <div className="ns-google-sync-actions">
                      <button
                        type="button"
                        className="is-primary"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('create', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await createGooglePresentation({ deckId, ownerAccessKey });
                          })
                        }
                      >
                        {googleSyncBusy === 'create' ? (
                          <LoaderCircle className="ns-spin" size={13} />
                        ) : (
                          <Presentation size={13} />
                        )}
                        Create compatible target
                      </button>
                    </div>
                    <label>
                      <span>Or link an exact, already app-authorized presentation</span>
                      <span>
                        <input
                          value={googlePresentation}
                          placeholder="Google Slides URL or presentation ID"
                          onChange={(event) => setGooglePresentation(event.target.value)}
                        />
                        <button
                          type="button"
                          disabled={!googlePresentation.trim() || googleSyncBusy !== null}
                          onClick={() =>
                            void runGoogleSyncAction('attach', async () => {
                              if (!deckId || !ownerAccessKey)
                                throw new Error('Open an owned deck.');
                              await attachGooglePresentation({
                                deckId,
                                ownerAccessKey,
                                presentationId: googlePresentationId(googlePresentation),
                              });
                              return {};
                            })
                          }
                        >
                          {googleSyncBusy === 'attach' ? (
                            <LoaderCircle className="ns-spin" size={13} />
                          ) : (
                            <Presentation size={13} />
                          )}
                          Link exact match
                        </button>
                      </span>
                      <small>
                        A URL or ID identifies the file; it does not grant <code>drive.file</code>
                        access or establish a baseline by itself.
                      </small>
                    </label>
                  </>
                ) : (
                  <div className="ns-google-sync-actions">
                    <button
                      type="button"
                      disabled={googleSyncBusy !== null || !googleCanPlan}
                      onClick={() =>
                        void runGoogleSyncAction('pull', async () => {
                          if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                          return await planGooglePull({ deckId, ownerAccessKey });
                        })
                      }
                    >
                      {googleRuntime.status === 'conflict' || googleRuntime.status === 'error'
                        ? 'Re-plan Google pull'
                        : 'Check Google changes'}
                    </button>
                    <button
                      type="button"
                      disabled={googleSyncBusy !== null || !googleCanPlan}
                      onClick={() =>
                        void runGoogleSyncAction('plan-push', async () => {
                          if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                          return await planGooglePush({ deckId, ownerAccessKey });
                        })
                      }
                    >
                      {googleRuntime.status === 'conflict' || googleRuntime.status === 'error'
                        ? 'Re-plan NodeSlide push'
                        : 'Plan NodeSlide push'}
                    </button>
                    {googleRuntime.status === 'awaiting_pull_review' &&
                    googleRuntime.pendingPlanDigest &&
                    googleRuntime.pendingPatchStatus === 'accepted' ? (
                      <button
                        type="button"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('finalize-pull', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await finalizeGooglePull({
                              deckId,
                              ownerAccessKey,
                              planDigest: googleRuntime.pendingPlanDigest as string,
                            });
                          })
                        }
                      >
                        Verify accepted pull
                      </button>
                    ) : null}
                    {googleRuntime.status === 'awaiting_pull_review' &&
                    googleRuntime.pendingPatchStatus !== 'accepted' ? (
                      <button
                        type="button"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('cancel', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await cancelGooglePending({
                              deckId,
                              ownerAccessKey,
                              expectedStateVersion: googleRuntime.stateVersion,
                            });
                          })
                        }
                      >
                        {googleRuntime.pendingPatchStatus === 'rejected'
                          ? 'Reset rejected pull'
                          : googleRuntime.pendingPatchStatus === 'stale'
                            ? 'Reset stale pull'
                            : 'Cancel pull proposal'}
                      </button>
                    ) : null}
                    {(googleRuntime.status === 'awaiting_push_review' ||
                      googleRuntime.status === 'executing' ||
                      googleRuntime.status === 'verifying' ||
                      googleRuntime.status === 'error') &&
                    googleRuntime.pendingPlanDigest ? (
                      <button
                        type="button"
                        className="is-primary"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('execute-push', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await executeGooglePush({
                              deckId,
                              ownerAccessKey,
                              planDigest: googleRuntime.pendingPlanDigest as string,
                            });
                          })
                        }
                      >
                        {googleRuntime.status === 'awaiting_push_review'
                          ? 'Push and verify'
                          : 'Resume verification'}
                      </button>
                    ) : null}
                    {googleRuntime.status === 'awaiting_push_review' ? (
                      <button
                        type="button"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('cancel', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await cancelGooglePending({
                              deckId,
                              ownerAccessKey,
                              expectedStateVersion: googleRuntime.stateVersion,
                            });
                          })
                        }
                      >
                        Cancel pending push
                      </button>
                    ) : null}
                    {googleRuntime.status === 'conflict' || googleRuntime.status === 'error' ? (
                      <button
                        type="button"
                        disabled={googleSyncBusy !== null}
                        onClick={() =>
                          void runGoogleSyncAction('reset', async () => {
                            if (!deckId || !ownerAccessKey) throw new Error('Open an owned deck.');
                            return await resetGoogleAttachment({
                              deckId,
                              ownerAccessKey,
                              expectedStateVersion: googleRuntime.stateVersion,
                            });
                          })
                        }
                      >
                        Reset attachment
                      </button>
                    ) : null}
                    <a
                      href={`https://docs.google.com/presentation/d/${encodeURIComponent(googleRuntime.remotePresentationId)}/edit`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Google Slides <ExternalLink size={12} />
                    </a>
                    {googleRuntime.status === 'conflict' || googleRuntime.status === 'error' ? (
                      <output role="alert">
                        {googleRuntime.errorMessage ?? 'Re-plan required.'}
                      </output>
                    ) : null}
                    {googleRuntime.status === 'awaiting_pull_review' &&
                    googleRuntime.pendingPatchStatus !== 'accepted' ? (
                      <output>
                        {googleRuntime.pendingPatchStatus === 'rejected'
                          ? 'The pull proposal was rejected. Reset it before planning again.'
                          : googleRuntime.pendingPatchStatus === 'stale'
                            ? 'The pull proposal became stale. Reset it before planning again.'
                            : 'Review and accept the NodeSlide proposal before verification, or cancel it.'}
                      </output>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section className="ns-connection-section" aria-labelledby="ns-byok-title">
            <div className="ns-connection-heading">
              <span>
                <KeyRound size={14} /> Local BYOK
              </span>
              <small>{configuredCount ? `${configuredCount} configured` : 'Optional'}</small>
            </div>
            <h2 id="ns-byok-title">Use your provider, without giving NodeSlide the key</h2>
            <p>
              Values live in this tab’s session storage, then run in the local MCP process you
              launch. They are never sent to Convex, written into Trace, or returned by a tool.
              Every model request still needs explicit per-call consent; copied config never grants
              it.
            </p>
            <div className="ns-byok-grid">
              {SESSION_BYOK_KEYS.filter((key) => key.provider !== 'google').map((key, index) => (
                <label key={key.envVar}>
                  <span>
                    {key.label}
                    <small>{maskKey(keys[key.envVar])}</small>
                  </span>
                  <input
                    ref={index === 0 ? firstInputRef : undefined}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keys[key.envVar] ?? ''}
                    placeholder={key.placeholder}
                    onChange={(event) =>
                      setKeys((current) => ({ ...current, [key.envVar]: event.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                <span>
                  Model ID <small>pi-ai routing</small>
                </span>
                <input
                  value={routing.model}
                  onChange={(event) =>
                    setRouting((current) => ({ ...current, model: event.target.value }))
                  }
                  placeholder="z-ai/glm-5.2"
                />
              </label>
              <label className="is-wide">
                <span>
                  OpenAI-compatible endpoint <small>optional · local or HTTPS</small>
                </span>
                <input
                  value={routing.baseUrl}
                  onChange={(event) =>
                    setRouting((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="http://127.0.0.1:11434/v1"
                />
              </label>
            </div>
            <div className="ns-connection-actions">
              <button type="button" onClick={save}>
                <Check size={13} /> Save in this tab
              </button>
              <button type="button" className="is-danger" onClick={revoke}>
                <Trash2 size={13} /> Revoke all
              </button>
            </div>
          </section>

          <section className="ns-connection-section" aria-labelledby="ns-mcp-title">
            <div className="ns-connection-heading">
              <span>
                <Bot size={14} /> Coding agents
              </span>
              <small>stdio · production package</small>
            </div>
            <h2 id="ns-mcp-title">Let Claude Code, Codex, or Cursor drive NodeSlide</h2>
            <p>
              The agent can read decks and traces, upload evidence, and propose edits. Proposals
              remain unapplied until a separate accept call; the server rechecks owner authority,
              scope, clocks, quotas, and candidate validation. The copied config contains no consent
              grant: external-model and web tools require <code>consent: true</code> on that exact
              call after user approval.
            </p>
            <Tabs value={client} onValueChange={(value) => setClient(value as ClientKind)} unstyled>
              <TabsList className="ns-agent-client-tabs" aria-label="Agent client" unstyled>
                <TabsTrigger value="claude" unstyled>
                  <Code2 size={13} /> Claude Code / Cursor
                </TabsTrigger>
                <TabsTrigger value="codex" unstyled>
                  <Laptop size={13} /> Codex
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="ns-agent-connect-card">
              <div>
                <strong>{client === 'codex' ? '~/.codex/config.toml' : '.mcp.json'}</strong>
                <small>
                  {ownerAccessKey
                    ? 'This deck’s owner capability will be included.'
                    : 'Open an owned deck before copying to include its owner capability.'}
                </small>
              </div>
              <button type="button" onClick={() => void copyConfig()}>
                <Clipboard size={13} /> Copy config
              </button>
            </div>
            <a
              className="ns-connection-doc-link"
              href="https://github.com/HomenShum/parity-studio/tree/main/mcp"
              target="_blank"
              rel="noreferrer"
            >
              Setup and tool reference <ExternalLink size={12} />
            </a>
            <a
              className="ns-connection-doc-link"
              href="/downloads/parity-studio-mcp-0.4.0.sha256"
              target="_blank"
              rel="noreferrer"
            >
              Verify v0.4.0 checksum <ExternalLink size={12} />
            </a>
          </section>

          <aside className="ns-connection-trust">
            <ShieldCheck size={15} />
            <span>
              <strong>Same locks, second front door.</strong>
              The UI checkbox and MCP’s per-call consent field each authorize one request. Server
              scope, proposals, validation receipts, version clocks, and honest failures stay the
              same.
            </span>
          </aside>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function googlePresentationId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/u);
  return match?.[1] ?? trimmed;
}

async function sha256Digest(payload: ArrayBuffer): Promise<string> {
  const { sha256Hex } = await import('../signature/extractor');
  return `sha256:${await sha256Hex(new Uint8Array(payload))}`;
}

function googleSyncNotice(
  action:
    | 'create'
    | 'attach'
    | 'pull'
    | 'finalize-pull'
    | 'plan-push'
    | 'execute-push'
    | 'cancel'
    | 'reset',
  receipt: {
    result?: string;
    operationCount?: number;
    verified?: boolean;
    presentationUrl?: string;
    cancelled?: boolean;
    reset?: boolean;
  },
): string {
  if (action === 'create') {
    return 'Created an app-authorized blank Google Slides target. Plan a NodeSlide push to review its first write.';
  }
  if (action === 'attach') {
    return 'Linked the already authorized, exact-match presentation with an exact baseline.';
  }
  if (receipt.cancelled) return 'Cancelled the pending review. You can plan again.';
  if (receipt.reset)
    return 'Reset the Google Slides attachment. Create or link a compatible target.';
  if (receipt.verified) return 'Synchronization verified against NodeSlide and Google Slides.';
  if (receipt.result === 'no_change') return 'Both versions are already synchronized.';
  if (receipt.result === 'conflict') return 'A conflict was detected. Nothing was written.';
  if (action === 'pull') {
    return `${receipt.operationCount ?? 0} Google change${receipt.operationCount === 1 ? '' : 's'} prepared in NodeSlide for review.`;
  }
  return `${receipt.operationCount ?? 0} NodeSlide change${receipt.operationCount === 1 ? '' : 's'} prepared for Google Slides.`;
}

export function buildNodeSlideMcpJson(env: Record<string, string>, command = 'npx'): string {
  return JSON.stringify(
    {
      mcpServers: {
        nodeslide: {
          command,
          args: ['-y', NODESLIDE_MCP_PACKAGE],
          env,
        },
      },
    },
    null,
    2,
  );
}

export function buildNodeSlideCodexConfig(env: Record<string, string>, command = 'npx'): string {
  const lines = [
    '[mcp_servers.nodeslide]',
    `command = ${JSON.stringify(command)}`,
    `args = ["-y", ${JSON.stringify(NODESLIDE_MCP_PACKAGE)}]`,
    'default_tools_approval_mode = "writes"',
    '',
    '[mcp_servers.nodeslide.env]',
    ...Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ];
  return lines.join('\n');
}
