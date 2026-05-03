import { useMutation, useQuery } from 'convex/react';
import { Check, Clipboard, GitCompareArrows, Loader2, RefreshCw, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface SourceSyncModalProps {
  runId: Id<'runs'> | null;
  open: boolean;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}

interface SourceMeta {
  routeUrl: string | null;
  sourceType: string;
  capturedAt: string | null;
  htmlHash: string | null;
  projectRoot: string | null;
  prompt: string | null;
}

export function SourceSyncModal({ runId, open, onClose, onOpenFile }: SourceSyncModalProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId && open ? { runId } : 'skip');
  const artifacts = useQuery(api.artifacts.listForRun, runId && open ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId && open ? { runId } : 'skip');
  const startAdviseLoop = useMutation(api.chat.startAdviseLoop);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const files = useMemo(() => (uiKit?.files as Record<string, string> | undefined) ?? {}, [uiKit]);
  const source = useMemo(() => extractSourceMeta(files, uiKit?.slug ?? null), [files, uiKit?.slug]);
  const likelyFiles = useMemo(
    () => findLikelySyncFiles(files, uiKit?.slug ?? null),
    [files, uiKit?.slug],
  );
  const metadataLoading = runId !== null && (uiKit === undefined || artifacts === undefined);
  const latestArtifactVersion = artifacts?.[0]?.version ?? uiKit?.artifactVersion ?? 0;
  const capturedAt = metadataLoading
    ? 'loading'
    : source.capturedAt
      ? formatCapturedAt(source.capturedAt)
      : 'unknown';
  const sourceRoute = metadataLoading
    ? 'loading source metadata...'
    : (source.routeUrl ?? 'no source route stored');

  if (!open) return null;

  async function onPatchCurrentRun() {
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      await startAdviseLoop({
        runId,
        kind: 'manual',
        prompt: buildPatchPrompt({
          runTitle: run?.title ?? null,
          routeUrl: source.routeUrl,
          slug: uiKit?.slug ?? null,
          likelyFiles,
        }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyMcpPrompt() {
    const text = buildMcpPrompt({
      runId: runId ? String(runId) : null,
      routeUrl: source.routeUrl,
      projectRoot: source.projectRoot,
      slug: uiKit?.slug ?? null,
    });
    setCopied(false);
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      setError(`Clipboard copy failed. Prompt text: ${text}`);
      return;
    }
    window.setTimeout(() => setCopied(false), 2200);
  }

  async function onCopyMcpSetup() {
    const text = buildMcpSetupInstructions({
      routeUrl: source.routeUrl,
      projectRoot: source.projectRoot,
    });
    setSetupCopied(false);
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setSetupCopied(true);
    } catch (err) {
      setError(`Clipboard copy failed. Setup instructions:\n\n${text}`);
      return;
    }
    window.setTimeout(() => setSetupCopied(false), 2200);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: custom full-screen modal shell needs non-dialog layout control.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sync from latest source"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(21, 16, 12, 0.42)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: 780,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          borderRadius: 28,
          border: '1px solid var(--color-border)',
          background:
            'radial-gradient(circle at 14% 0%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 34%), var(--color-background)',
          boxShadow: 'var(--shadow-elevated)',
          padding: 22,
          display: 'grid',
          gap: 18,
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ maxWidth: 620 }}>
            <div style={eyebrowStyle}>Version control</div>
            <h2
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: 34,
                lineHeight: 1,
                fontWeight: 500,
                letterSpacing: '-0.035em',
                color: 'var(--color-text-primary)',
              }}
            >
              Sync from latest source
            </h2>
            <p
              style={{ margin: '10px 0 0', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}
            >
              This preview now renders the latest editable kit files. Source app changes still do
              not rewrite the kit until you patch the current run or recapture the source as a new
              run revision.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={iconButtonStyle}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          <VersionStat label="Preview" value={`kit v${latestArtifactVersion}`} />
          <VersionStat label="Kit" value={uiKit ? `${uiKit.fileCount} files` : 'loading'} />
          <VersionStat label="Source" value={metadataLoading ? 'loading' : source.sourceType} />
          <VersionStat label="Captured" value={capturedAt} />
        </div>

        <div
          style={{
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-xl)',
            background: 'var(--color-surface)',
            padding: 14,
            display: 'grid',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={sectionTitleStyle}>Captured source</div>
              <div style={monoValueStyle} title={sourceRoute}>
                {sourceRoute}
              </div>
              <div style={{ marginTop: 5, color: 'var(--color-text-faint)', fontSize: 12 }}>
                Hash {source.htmlHash ?? 'none'} · use this to tell when a run is stale against its
                original capture.
              </div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--color-border-subtle)',
                padding: '6px 10px',
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                whiteSpace: 'nowrap',
              }}
            >
              <GitCompareArrows size={12} />
              snapshot model
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SyncActionCard
            icon={<RefreshCw size={16} />}
            title="Patch this run"
            body="Works directly on the website. Best when the saved kit is close and one visible surface is stale."
            cta={busy ? 'Scheduling...' : 'Ask agent to sync'}
            disabled={!runId || busy}
            onClick={() => void onPatchCurrentRun()}
          />
          <SyncActionCard
            icon={copied ? <Check size={16} /> : <Clipboard size={16} />}
            title="Recapture as new revision"
            body="Best when your local app changed broadly. Requires the local MCP server so localhost/private source stays on your machine."
            cta={copied ? 'Copied' : 'Copy MCP sync prompt'}
            disabled={!runId}
            onClick={() => void onCopyMcpPrompt()}
          />
        </div>

        <div
          style={{
            border:
              '1px solid color-mix(in srgb, var(--color-accent) 26%, var(--color-border-subtle))',
            borderRadius: 'var(--radius-xl)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 8%, var(--color-surface)), var(--color-surface))',
            padding: 15,
            display: 'grid',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={sectionTitleStyle}>No local agent connected yet?</div>
              <p
                style={{
                  margin: '6px 0 0',
                  color: 'var(--color-text-secondary)',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Website users can patch this saved kit immediately. To recapture a localhost route
                or private repo, connect `parity-studio-mcp` once in Claude Code, Codex, Cursor, or
                Windsurf. Provider keys stay in that local MCP process; Parity Studio only receives
                the generated/redacted kit when import is enabled.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onCopyMcpSetup()}
              style={{
                ...secondaryButtonStyle,
                minWidth: 164,
              }}
            >
              {setupCopied ? <Check size={13} /> : <Clipboard size={13} />}
              {setupCopied ? 'Setup copied' : 'Copy MCP setup'}
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            <SetupStep
              number="1"
              title="Install once"
              body="Add the MCP server with npx parity-studio-mcp."
            />
            <SetupStep
              number="2"
              title="Keep keys local"
              body="Put provider keys in the MCP env, never in browser fields."
            />
            <SetupStep
              number="3"
              title="Ask naturally"
              body='"Use Parity Studio with this app and get me the ZIP export."'
            />
          </div>
        </div>

        <div
          style={{
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-xl)',
            padding: 14,
            background: 'color-mix(in srgb, var(--color-background-secondary) 78%, white)',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={sectionTitleStyle}>Likely files for the current stale overlay</div>
          {metadataLoading ? (
            <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>
              Loading the latest kit files and contract...
            </div>
          ) : likelyFiles.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {likelyFiles.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    onOpenFile?.(path);
                    onClose();
                  }}
                  style={{
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-secondary)',
                    padding: '6px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {path.replace(/^ui_kits\/[^/]+\//, '')}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>
              No obvious modal file found yet. Use patch mode and the agent will inspect the full
              kit.
            </div>
          )}
        </div>

        {error ? (
          <div
            style={{
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              background: 'color-mix(in srgb, var(--color-error) 8%, var(--color-surface))',
              color: 'var(--color-error)',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function extractSourceMeta(files: Record<string, string>, slug: string | null): SourceMeta {
  const contractPath = slug
    ? `ui_kits/${slug}/parity.contract.json`
    : (Object.keys(files).find((path) => path.endsWith('/parity.contract.json')) ?? null);
  const fallback: SourceMeta = {
    routeUrl: null,
    sourceType: 'unknown',
    capturedAt: null,
    htmlHash: null,
    projectRoot: null,
    prompt: null,
  };
  if (!contractPath || !(contractPath in files)) return fallback;
  try {
    const contract = JSON.parse(files[contractPath] ?? '') as {
      source?: {
        routeUrl?: string | null;
        type?: string;
        prompt?: string | null;
        capturedAt?: string | null;
        htmlHash?: string | null;
        codeContext?: { root?: string | null } | null;
      };
    };
    const sourcePrompt = contract.source?.prompt ?? null;
    return {
      routeUrl: contract.source?.routeUrl ?? extractFirstUrl(sourcePrompt),
      sourceType: contract.source?.type ?? 'unknown',
      capturedAt: contract.source?.capturedAt ?? null,
      htmlHash: contract.source?.htmlHash ?? null,
      projectRoot: contract.source?.codeContext?.root ?? null,
      prompt: sourcePrompt,
    };
  } catch {
    return fallback;
  }
}

function extractFirstUrl(value: string | null): string | null {
  if (!value) return null;
  return value.match(/https?:\/\/[^\s,)]+/i)?.[0] ?? null;
}

function findLikelySyncFiles(files: Record<string, string>, slug: string | null): string[] {
  const root = slug ? `ui_kits/${slug}/` : 'ui_kits/';
  const scored = Object.entries(files)
    .filter(([path]) => path.startsWith(root) && /\.(html|tsx|jsx|ts|js|css)$/i.test(path))
    .map(([path, content]) => {
      let score = 0;
      if (/index\.html$/i.test(path)) score += 8;
      if (/modal|overlay|composer|agent|rail|run|launch/i.test(path)) score += 6;
      if (
        /Start new run|Start with an idea|Balanced AI|Describe a design|ui_kit ZIP/i.test(content)
      )
        score += 10;
      if (/components\//i.test(path)) score += 2;
      return { path, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, 6).map((row) => row.path);
}

function buildPatchPrompt(input: {
  runTitle: string | null;
  routeUrl: string | null;
  slug: string | null;
  likelyFiles: string[];
}): string {
  return `Sync this current ui_kit run with the latest Parity Studio source behavior.

Run title: ${input.runTitle ?? '(unknown)'}
Captured source route: ${input.routeUrl ?? '(not stored)'}
Slug: ${input.slug ?? '(unknown)'}
Likely stale files: ${input.likelyFiles.length > 0 ? input.likelyFiles.join(', ') : '(agent should list files first)'}

The visible stale area is the Start new run overlay. Replace the legacy compact modal with the latest product behavior:
- Title should be "Start with an idea, image, or ui_kit."
- Include explanatory copy that the user can choose a model route, describe the UI, attach a source image, or import a canonical ui_kit ZIP.
- Add three option cards: Prompt, Image, and ui_kit ZIP.
- Keep the model route picker at the top of the composer.
- Make the composer feel like a premium launch surface: larger textarea, stronger card, and a "Start run" pill button.
- Preserve BYOK/privacy semantics and attachment/import controls.

Use the advisor-executor protocol. Read parity.contract.json first, inspect the likely files, edit the smallest relevant files, call done on every changed path, and summarize whether the stale source snapshot is now patched or whether a full MCP recapture is still recommended.`;
}

function buildMcpPrompt(input: {
  runId: string | null;
  routeUrl: string | null;
  projectRoot: string | null;
  slug: string | null;
}): string {
  return `Use Parity Studio to sync this ui_kit from the latest source.

Current run: ${input.runId ?? '(unknown)'}
Current slug: ${input.slug ?? '(unknown)'}
Source route: ${input.routeUrl ?? 'auto-detect the running app route'}
Project root: ${input.projectRoot ?? '.'}

Use the local MCP Parity Studio workflow with BYOK keys kept local. Capture the route, decompose it into a fresh canonical ui_kit ZIP, import it to Parity Studio as a new run revision, then compare the new run against the current run. Do not print, log, or upload provider key values.`;
}

function buildMcpSetupInstructions(input: {
  routeUrl: string | null;
  projectRoot: string | null;
}): string {
  return `Parity Studio MCP setup for Claude Code, Codex, Cursor, or Windsurf

1. Add this MCP server to your agent config:

{
  "mcpServers": {
    "parity-studio": {
      "command": "npx",
      "args": ["-y", "parity-studio-mcp"],
      "env": {
        "PARITY_CONVEX_URL": "https://blissful-pig-998.convex.cloud",
        "PARITY_CONVEX_HTTP_URL": "https://blissful-pig-998.convex.site",
        "PARITY_DASHBOARD": "auto-open",
        "PARITY_APP_URL": "${input.routeUrl ?? 'http://localhost:3000'}",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "OPENROUTER_API_KEY": "sk-or-...",
        "GEMINI_API_KEY": "AI..."
      }
    }
  }
}

2. Keep only the provider keys you actually use. At least one provider key is required for local generation/decomposition/verification.

3. Start your app locally, then ask your coding agent:

"Use Parity Studio with this app, get me the zip export, upload it to Parity Studio, and use my own env keys."

4. If your app is not on PARITY_APP_URL, ask:

"Use Parity Studio on ${input.routeUrl ?? 'the running local app'} with projectRoot=${input.projectRoot ?? '.'}, get me the ZIP export, and import it to Parity Studio."

Security rule: provider key values stay in the local MCP process environment. Do not paste keys into browser chat, kit files, Git commits, logs, screenshots, or uploaded artifacts.`;
}

function formatCapturedAt(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}

function VersionStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
        padding: '11px 12px',
        minWidth: 0,
      }}
    >
      <div style={eyebrowStyle}>{label}</div>
      <div style={monoValueStyle} title={value}>
        {value}
      </div>
    </div>
  );
}

function SyncActionCard({
  icon,
  title,
  body,
  cta,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-xl)',
        background: 'var(--color-surface)',
        padding: 15,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent-soft)',
            color: 'var(--color-accent)',
            display: 'inline-grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <div>
          <div style={sectionTitleStyle}>{title}</div>
          <p
            style={{
              margin: '5px 0 0',
              color: 'var(--color-text-secondary)',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {body}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        style={{
          height: 38,
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          background: disabled ? 'var(--color-surface-active)' : 'var(--color-accent)',
          color: disabled ? 'var(--color-text-faint)' : 'var(--color-on-accent)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 800,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {disabled && cta === 'Scheduling...' ? <Loader2 size={13} /> : null}
        {cta}
      </button>
    </div>
  );
}

function SetupStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'color-mix(in srgb, var(--color-background-secondary) 68%, white)',
        padding: 11,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-accent)',
            color: 'var(--color-on-accent)',
            display: 'inline-grid',
            placeItems: 'center',
            fontSize: 11,
            fontWeight: 850,
            flexShrink: 0,
          }}
        >
          {number}
        </span>
        <div style={{ ...sectionTitleStyle, fontSize: 12 }}>{title}</div>
      </div>
      <p
        style={{
          margin: '7px 0 0',
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        {body}
      </p>
    </div>
  );
}

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--color-text-faint)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: 'var(--color-text-primary)',
  fontWeight: 820,
};

const monoValueStyle: CSSProperties = {
  marginTop: 5,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
};

const secondaryButtonStyle: CSSProperties = {
  height: 38,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '0 14px',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 820,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
