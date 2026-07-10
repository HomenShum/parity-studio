import {
  ArrowRight,
  Clock3,
  GitCompareArrows,
  History,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Deck, DeckPatch, DeckSnapshot, DeckVersion } from '../../../../shared/nodeslide';

interface VersionsInspectorProps {
  deck: Deck;
  versions: readonly DeckVersion[];
  patches: readonly DeckPatch[];
  onRestore: (version: DeckVersion) => void;
}

export function VersionsInspector({ deck, versions, patches, onRestore }: VersionsInspectorProps) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b.createdAt - a.createdAt), [versions]);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const compareVersion = sorted.find((version) => version.id === compareVersionId);
  const stalePatches = patches
    .filter((patch) => patch.status === 'stale')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const latestSnapshot = sorted[0]?.snapshot;

  return (
    <div className="ns-inspector-scroll ns-versions-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Revision history</span>
            <h2>Versions</h2>
          </div>
          <span className="ns-count-pill">v{deck.version}</span>
        </div>
        <p>
          Compare snapshots, restore an earlier revision, and inspect proposals that missed their
          base clocks.
        </p>
      </section>

      {stalePatches.length > 0 ? (
        <section className="ns-stale-proposals">
          <div className="ns-section-heading">
            <span>
              <TriangleAlert size={13} /> Stale proposals
            </span>
            <small>{stalePatches.length}</small>
          </div>
          {stalePatches.map((patch) => (
            <article key={patch.id}>
              <span className="ns-status-dot ns-status-dot--stale" />
              <div>
                <strong>{patch.summary}</strong>
                <small>
                  Based on deck v{patch.baseDeckVersion} · current v{deck.version}
                </small>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {compareVersion && latestSnapshot ? (
        <section className="ns-compare-card">
          <div className="ns-section-heading">
            <span>
              <GitCompareArrows size={13} /> Compare summary
            </span>
            <button type="button" onClick={() => setCompareVersionId(null)}>
              Close
            </button>
          </div>
          <div className="ns-compare-route">
            <span>v{compareVersion.version}</span>
            <ArrowRight size={13} />
            <span>v{deck.version}</span>
          </div>
          <ul>
            {compareSnapshots(compareVersion.snapshot, latestSnapshot).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ns-version-list" aria-label="Deck revisions">
        <div className="ns-section-heading">
          <span>Revisions</span>
          <small>{versions.length} saved</small>
        </div>
        {sorted.length === 0 ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <span>
              <History size={17} />
            </span>
            <strong>No revisions yet</strong>
            <p>Accepted edits will appear here.</p>
          </div>
        ) : (
          sorted.map((version, index) => {
            const current = version.version === deck.version || index === 0;
            return (
              <article className={`ns-version-row ${current ? 'is-current' : ''}`} key={version.id}>
                <div className="ns-version-marker">
                  <span />
                  {index < sorted.length - 1 ? <i /> : null}
                </div>
                <div className="ns-version-copy">
                  <div>
                    <strong>{version.label}</strong>
                    {current ? <span>Current</span> : null}
                  </div>
                  <p>
                    v{version.version} · {capitalize(version.source)}
                  </p>
                  <small>
                    <Clock3 size={11} /> {formatDate(version.createdAt)}
                  </small>
                  <div className="ns-version-actions">
                    <button
                      type="button"
                      onClick={() => setCompareVersionId(version.id)}
                      disabled={current}
                    >
                      <GitCompareArrows size={13} /> Compare
                    </button>
                    <button type="button" onClick={() => onRestore(version)} disabled={current}>
                      <RotateCcw size={13} /> Restore
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function compareSnapshots(before: DeckSnapshot, after: DeckSnapshot) {
  const lines: string[] = [];
  const slideDelta = after.slides.length - before.slides.length;
  const elementDelta = after.elements.length - before.elements.length;
  const sourceDelta = after.sources.length - before.sources.length;
  if (before.deck.title !== after.deck.title)
    lines.push(`Title changed from “${before.deck.title}” to “${after.deck.title}”.`);
  if (slideDelta !== 0)
    lines.push(`${signed(slideDelta)} slide${Math.abs(slideDelta) === 1 ? '' : 's'}.`);
  if (elementDelta !== 0)
    lines.push(`${signed(elementDelta)} element${Math.abs(elementDelta) === 1 ? '' : 's'}.`);
  if (sourceDelta !== 0)
    lines.push(`${signed(sourceDelta)} source record${Math.abs(sourceDelta) === 1 ? '' : 's'}.`);

  const beforeSlides = new Map(before.slides.map((slide) => [slide.id, slide]));
  for (const slide of after.slides) {
    const previous = beforeSlides.get(slide.id);
    if (!previous) continue;
    if (previous.title !== slide.title) {
      lines.push(`Slide title: “${truncate(previous.title)}” → “${truncate(slide.title)}”.`);
    }
    if ((previous.notes ?? '') !== (slide.notes ?? '')) {
      lines.push(`Speaker notes changed on “${slide.title}”.`);
    }
    if (previous.background !== slide.background) {
      lines.push(`Background changed on “${slide.title}”.`);
    }
  }

  const beforeElements = new Map(before.elements.map((element) => [element.id, element]));
  for (const element of after.elements) {
    const previous = beforeElements.get(element.id);
    if (!previous) continue;
    if ((previous.content ?? '') !== (element.content ?? '')) {
      lines.push(
        `${element.name}: “${truncate(previous.content ?? '')}” → “${truncate(element.content ?? '')}”.`,
      );
    }
    if (JSON.stringify(previous.bbox) !== JSON.stringify(element.bbox)) {
      lines.push(`${element.name} moved or resized.`);
    }
    const styleKeys = [...new Set([...Object.keys(previous.style), ...Object.keys(element.style)])]
      .filter(
        (key) =>
          previous.style[key as keyof typeof previous.style] !==
          element.style[key as keyof typeof element.style],
      )
      .sort();
    if (styleKeys.length > 0) lines.push(`${element.name} style: ${styleKeys.join(', ')}.`);
  }

  if (lines.length === 0) lines.push('No semantic differences were detected.');
  if (lines.length <= 12) return lines;
  return [...lines.slice(0, 11), `${lines.length - 11} additional changes.`];
}

function truncate(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean;
}

function signed(value: number) {
  return value > 0 ? `Added ${value}` : `Removed ${Math.abs(value)}`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function capitalize(value: string) {
  return value.replace(/^./, (letter) => letter.toUpperCase());
}
