import { useMutation } from 'convex/react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { activeSurfaceFor, surfaceTokenPath } from '../../lib/projectSurfaces';

interface TweakPanelProps {
  uiKitId: Id<'ui_kits'> | null;
  slug: string | null;
  activeSurfaceSlug?: string | null;
  files: Record<string, string>;
  onClose: () => void;
}

interface TweakSchemaEntry {
  kind: 'color' | 'number' | 'enum' | 'boolean' | 'string';
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  placeholder?: string;
}

interface TweakSchema {
  version?: number;
  tokens: Record<string, TweakSchemaEntry>;
}

/**
 * TweakPanel — live token editor.
 *
 * Reads `ui_kits/<slug>/tweak-schema.json` for per-token UI hints, parses
 * the current values from `ui_kits/<slug>/tokens.css`, renders one
 * control per schema entry, and writes mutations back through
 * `uiKits.patchFile` so each tweak is atomic + survives iterate.
 *
 * Schema is auto-derived on creation (see canonicalShape.ts) and can be
 * refined by the chat agent via upsert_file. If the schema file is
 * missing, falls back to a heuristic on tokens.css.
 */
export function TweakPanel({ uiKitId, slug, activeSurfaceSlug, files, onClose }: TweakPanelProps) {
  const patchFile = useMutation(api.uiKits.patchFile);

  const surface = activeSurfaceFor(files, slug, activeSurfaceSlug ?? slug);
  const activeSlug = surface?.slug ?? slug;
  const tokensPath = surfaceTokenPath(files, surface);
  const schemaPath = activeSlug ? `ui_kits/${activeSlug}/tweak-schema.json` : null;
  const tokensCss = tokensPath ? (files[tokensPath] ?? '') : '';
  const schemaJson = schemaPath ? (files[schemaPath] ?? null) : null;

  const schema: TweakSchema = useMemo(() => {
    if (schemaJson !== null) {
      try {
        const parsed = JSON.parse(schemaJson);
        if (parsed && typeof parsed === 'object' && parsed.tokens) return parsed as TweakSchema;
      } catch {
        // fall through to derived heuristic
      }
    }
    return { version: 1, tokens: deriveSchemaFromCss(tokensCss) };
  }, [schemaJson, tokensCss]);

  const currentValues = useMemo(() => parseTokensCss(tokensCss), [tokensCss]);

  // Local draft keeps the controls responsive while we throttle writes.
  const [draft, setDraft] = useState<Record<string, string>>(currentValues);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Re-sync draft if files change underneath us (chat agent edited tokens
  // while panel was open).
  useEffect(() => {
    setDraft(currentValues);
    setDirty(new Set());
  }, [currentValues]);

  async function commit(name: string, value: string) {
    if (!uiKitId || !tokensPath) return;
    setBusy(true);
    try {
      const next = { ...draft, [name]: value };
      const newCss = serializeTokensCss(tokensCss, next);
      await patchFile({ uiKitId, path: tokensPath, content: newCss });
      // Track which tokens have been touched this session (for the dot).
      const nextDirty = new Set(dirty);
      nextDirty.add(name);
      setDirty(nextDirty);
    } finally {
      setBusy(false);
    }
  }

  function reset(name: string) {
    const original = currentValues[name];
    if (original !== undefined) {
      setDraft((d) => ({ ...d, [name]: original }));
      void commit(name, original);
    }
  }

  const entries = Object.entries(schema.tokens).filter(([name]) => name in draft);

  if (!activeSlug || !uiKitId) {
    return (
      <PanelShell onClose={onClose}>
        <EmptyState text="Run a pipeline to start tweaking tokens." />
      </PanelShell>
    );
  }
  if (entries.length === 0) {
    return (
      <PanelShell onClose={onClose}>
        <EmptyState text="No tokens declared in tokens.css yet. Ask the chat agent to add some, or generate/import a kit." />
      </PanelShell>
    );
  }

  return (
    <PanelShell onClose={onClose}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: 'var(--tracking-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
          padding: '0 var(--space-5) 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{entries.length} tokens</span>
        {busy ? <span style={{ color: 'var(--color-accent)' }}>writing…</span> : null}
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 var(--space-5) var(--space-5)',
        }}
      >
        {entries.map(([name, entry]) => (
          <TokenRow
            key={name}
            name={name}
            entry={entry}
            value={draft[name] ?? ''}
            wasEdited={dirty.has(name)}
            onLocalChange={(v) => setDraft((d) => ({ ...d, [name]: v }))}
            onCommit={(v) => commit(name, v)}
            onReset={() => reset(name)}
          />
        ))}
      </div>
    </PanelShell>
  );
}

function PanelShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        height: '100%',
        background: 'var(--color-background-secondary)',
        borderLeft: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
      aria-label="Tweak panel"
    >
      <div
        style={{
          height: 40,
          padding: '0 var(--space-5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 'var(--tracking-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal size={12} />
          Design tokens
        </span>
        <button type="button" onClick={onClose} aria-label="Close tweak panel" style={iconBtnStyle}>
          <X size={12} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 'var(--space-3)',
        }}
      >
        {children}
      </div>
    </aside>
  );
}

function TokenRow({
  name,
  entry,
  value,
  wasEdited,
  onLocalChange,
  onCommit,
  onReset,
}: {
  name: string;
  entry: TweakSchemaEntry;
  value: string;
  wasEdited: boolean;
  onLocalChange: (next: string) => void;
  onCommit: (next: string) => void;
  onReset: () => void;
}) {
  const label = entry.label ?? name.replace(/^--/, '');
  return (
    <div
      data-token-name={name}
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            color: 'var(--color-text-primary)',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {label}
          {wasEdited ? (
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent)',
              }}
            />
          ) : null}
        </span>
        <button
          type="button"
          onClick={onReset}
          aria-label={`Reset ${label}`}
          style={{ ...iconBtnStyle, opacity: wasEdited ? 1 : 0.4 }}
        >
          <RotateCcw size={11} />
        </button>
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        {name}
      </span>
      <Control entry={entry} value={value} onLocalChange={onLocalChange} onCommit={onCommit} />
    </div>
  );
}

function Control({
  entry,
  value,
  onLocalChange,
  onCommit,
}: {
  entry: TweakSchemaEntry;
  value: string;
  onLocalChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  if (entry.kind === 'color') {
    const isHex = /^#[0-9a-f]{3,8}$/i.test(value.trim());
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={isHex ? value : '#000000'}
          onChange={(e) => onLocalChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          aria-label="Pick color"
          style={{
            width: 36,
            height: 28,
            padding: 0,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onLocalChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value.trim())}
          spellCheck={false}
          style={textInputStyle}
        />
      </div>
    );
  }
  if (entry.kind === 'number') {
    const numValue = parseNumber(value);
    const min = entry.min ?? 0;
    const max = entry.max ?? 100;
    const step = entry.step ?? 1;
    const unit = entry.unit ?? '';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(numValue) ? numValue : min}
          onChange={(e) => onLocalChange(`${e.target.value}${unit}`)}
          onMouseUp={(e) => onCommit(`${(e.target as HTMLInputElement).value}${unit}`)}
          onTouchEnd={(e) => onCommit(`${(e.target as HTMLInputElement).value}${unit}`)}
          aria-label={`${entry.label ?? 'value'} slider`}
          style={{ flex: 1 }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onLocalChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value.trim())}
          spellCheck={false}
          style={{ ...textInputStyle, width: 80, flexShrink: 0 }}
        />
      </div>
    );
  }
  if (entry.kind === 'enum' && entry.options && entry.options.length > 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: 4,
          background: 'var(--color-surface-active)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {entry.options.map((opt) => {
          const active = value.trim() === opt.trim();
          return (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onLocalChange(opt);
                onCommit(opt);
              }}
              style={{
                flex: '1 1 auto',
                padding: '4px 8px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: active ? 'var(--color-surface)' : 'transparent',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                cursor: 'pointer',
                boxShadow: active ? 'var(--shadow-soft)' : 'none',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }
  if (entry.kind === 'boolean') {
    const on = value === 'true' || value === '1';
    return (
      <button
        type="button"
        onClick={() => {
          const next = on ? 'false' : 'true';
          onLocalChange(next);
          onCommit(next);
        }}
        aria-pressed={on}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 12px',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--color-border-subtle)',
          background: on ? 'var(--color-accent)' : 'var(--color-surface)',
          color: on ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {on ? 'true' : 'false'}
      </button>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onLocalChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      placeholder={entry.placeholder}
      spellCheck={false}
      style={textInputStyle}
    />
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const textInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '5px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  outline: 'none',
};

// ── Pure helpers (also used for testing the parsing/serialization) ─────

function parseTokensCss(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi;
  for (const m of css.matchAll(re)) {
    out[`--${m[1]}`] = (m[2] ?? '').trim();
  }
  return out;
}

function serializeTokensCss(originalCss: string, values: Record<string, string>): string {
  // Replace every existing --name: value; in place. Names not in `values`
  // stay untouched. This preserves comments + ordering, which matters for
  // round-tripping through the canonical-shape exporter.
  let out = originalCss;
  for (const [name, value] of Object.entries(values)) {
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g');
    out = out.replace(re, `$1${value}$3`);
  }
  return out;
}

function parseNumber(value: string): number {
  const m = value.match(/^(-?\d+(?:\.\d+)?)/);
  return m?.[1] ? Number(m[1]) : Number.NaN;
}

function deriveSchemaFromCss(css: string): Record<string, TweakSchemaEntry> {
  const out: Record<string, TweakSchemaEntry> = {};
  const values = parseTokensCss(css);
  for (const [name, value] of Object.entries(values)) {
    if (/^(#[0-9a-f]{3,8}|oklch\(|rgba?\(|hsla?\()/i.test(value)) {
      out[name] = { kind: 'color', label: humanLabel(name) };
      continue;
    }
    const num = value.match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%|s|ms)?$/i);
    if (num) {
      const n = Number(num[1]);
      const unit = num[2] ?? '';
      const entry: TweakSchemaEntry = { kind: 'number', label: humanLabel(name) };
      if (unit) entry.unit = unit;
      entry.min = 0;
      entry.max =
        unit === 'px' ? Math.max(64, Math.ceil(n * 2)) : Math.max(100, Math.ceil(Math.abs(n) * 4));
      entry.step = unit === 'rem' || unit === 'em' ? 0.05 : 1;
      out[name] = entry;
      continue;
    }
    out[name] = { kind: 'string', label: humanLabel(name), placeholder: value };
  }
  return out;
}

function humanLabel(name: string): string {
  return name
    .replace(/^--/, '')
    .split('-')
    .map((w) => (w.length === 0 ? '' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
