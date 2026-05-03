import { CheckCircle2, Clipboard, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  SESSION_BYOK_KEYS,
  clearSessionByok,
  maskKey,
  readSessionByok,
  writeSessionByok,
} from '../../lib/sessionByok';

interface SessionByokPanelProps {
  clientSessionId?: string;
  onResetSession: () => void;
  initialOpen?: boolean;
}

export function SessionByokPanel({
  clientSessionId,
  onResetSession,
  initialOpen = false,
}: SessionByokPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(initialOpen);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const visibleSessionId =
    typeof clientSessionId === 'string' && clientSessionId.length > 0
      ? clientSessionId.slice(0, 8)
      : 'local';

  useEffect(() => {
    setValues(readSessionByok());
  }, []);

  const setCount = useMemo(
    () => SESSION_BYOK_KEYS.filter((key) => values[key.envVar]?.trim()).length,
    [values],
  );

  function save() {
    writeSessionByok(values);
    setValues(readSessionByok());
    setMessage(t('byok.saved'));
  }

  function clearKeys() {
    clearSessionByok();
    setValues({});
    setMessage(t('byok.cleared'));
  }

  async function copyMcpEnv() {
    const saved = readSessionByok();
    const env: Record<string, string> = {};
    for (const key of SESSION_BYOK_KEYS) {
      const value = saved[key.envVar];
      if (value) env[key.envVar] = value;
    }
    env['PARITY_DASHBOARD'] = 'auto-open';
    const text = JSON.stringify({ env }, null, 2);
    await navigator.clipboard.writeText(text);
    setMessage(t('byok.copied'));
  }

  return (
    <section
      aria-label={t('byok.panelLabel')}
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-soft)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '28px minmax(0, 1fr) auto',
          gap: 8,
          alignItems: 'center',
          padding: '10px 12px',
          border: 'none',
          background: open ? 'var(--color-accent-soft)' : 'transparent',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in srgb, var(--color-success) 12%, var(--color-surface))',
            color: 'var(--color-success)',
          }}
        >
          <ShieldCheck size={14} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {t('byok.panelTitle')}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-faint)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t('byok.panelSubtitle', {
              count: setCount,
              plural: setCount === 1 ? '' : 's',
              session: visibleSessionId,
            })}
          </span>
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-text-secondary)',
          }}
        >
          {open ? t('byok.hide') : t('byok.manage')}
        </span>
      </button>

      {open ? (
        <div style={{ padding: '0 12px 12px', display: 'grid', gap: 10 }}>
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-background-secondary)',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-size-body-sm)',
              lineHeight: 1.45,
            }}
          >
            {t('byok.privacyCopy')}
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {SESSION_BYOK_KEYS.map((key) => (
              <label key={key.envVar} style={{ display: 'grid', gap: 4 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span>{key.label}</span>
                  <span>{maskKey(values[key.envVar], t)}</span>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={values[key.envVar] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key.envVar]: event.target.value }))
                  }
                  placeholder={key.placeholder}
                  style={{
                    height: 34,
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                    padding: '0 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
              </label>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={save} style={actionButtonStyle}>
              <CheckCircle2 size={13} />
              {t('byok.saveInTab')}
            </button>
            <button
              type="button"
              onClick={copyMcpEnv}
              disabled={setCount === 0}
              style={actionButtonStyle}
            >
              <Clipboard size={13} />
              {t('byok.copyMcpEnv')}
            </button>
            <button type="button" onClick={clearKeys} style={dangerButtonStyle}>
              <Trash2 size={13} />
              {t('byok.clearKeys')}
            </button>
            <button
              type="button"
              onClick={() => {
                clearSessionByok();
                setValues({});
                onResetSession();
                setMessage(t('byok.sessionCleared'));
              }}
              style={dangerButtonStyle}
            >
              <KeyRound size={13} />
              {t('byok.newSession')}
            </button>
          </div>

          {message ? (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
              }}
            >
              {message}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const actionButtonStyle: CSSProperties = {
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  fontWeight: 600,
};

const dangerButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  color: 'var(--color-error)',
};
