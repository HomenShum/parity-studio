import {
  Bot,
  Check,
  Clipboard,
  Code2,
  ExternalLink,
  KeyRound,
  Laptop,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { useModalDialog } from './useModalDialog';

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
  const firstInputRef = useRef<HTMLInputElement>(null);
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef: firstInputRef,
  });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [routing, setRouting] = useState({ model: 'z-ai/glm-5.2', baseUrl: '' });
  const [client, setClient] = useState<ClientKind>('claude');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKeys(readSessionByok());
    setRouting(readSessionByokRouting());
    setNotice(null);
  }, [open]);

  const ownerAccessKey = listStoredDeckAccess().find(
    (entry) => entry.deckId === deckId,
  )?.ownerAccessKey;
  const configuredCount = SESSION_BYOK_KEYS.filter((key) => keys[key.envVar]?.trim()).length;

  if (!open) return null;

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
    <dialog
      ref={dialogRef}
      className="ns-connections-dialog"
      aria-labelledby="ns-connections-title"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="ns-connections-shell">
        <header className="ns-connections-header">
          <span className="ns-connections-mark" aria-hidden="true">
            <ServerCog size={18} />
          </span>
          <div>
            <span className="ns-eyebrow">Models & agents</span>
            <h1 id="ns-connections-title">Connect your own runtime</h1>
          </div>
          <button type="button" className="ns-icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="ns-connections-body">
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
              Every model request still needs explicit consent.
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
              scope, clocks, quotas, and candidate validation.
            </p>
            <div className="ns-agent-client-tabs" role="tablist" aria-label="Agent client">
              <button
                type="button"
                role="tab"
                aria-selected={client === 'claude'}
                className={client === 'claude' ? 'is-active' : ''}
                onClick={() => setClient('claude')}
              >
                <Code2 size={13} /> Claude Code / Cursor
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={client === 'codex'}
                className={client === 'codex' ? 'is-active' : ''}
                onClick={() => setClient('codex')}
              >
                <Laptop size={13} /> Codex
              </button>
            </div>
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
              Consent, proposals, server scope, validation receipts, version clocks, and honest
              failures are identical whether the request starts in this UI or over MCP.
            </span>
          </aside>
          {notice ? <output className="ns-connection-notice">{notice}</output> : null}
        </div>
      </div>
    </dialog>
  );
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
