import {
  BarChart3,
  Calculator,
  Database,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Quote,
  Sheet,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { SlideElement, SourceRecord } from '../../../../shared/nodeslide';

interface DataInspectorProps {
  sources: readonly SourceRecord[];
  selectedElements: readonly SlideElement[];
  onDeleteSource?: (sourceId: string) => Promise<void>;
}

export function DataInspector({ sources, selectedElements, onDeleteSource }: DataInspectorProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dependencyIds = new Set(
    selectedElements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
      ...(element.math?.sourceId ? [element.math.sourceId] : []),
      ...(element.image?.sourceId ? [element.image.sourceId] : []),
    ]),
  );
  const dependencies = sources.filter((source) => dependencyIds.has(source.id));
  const structuredElements = selectedElements.filter(
    (element) => element.kind === 'chart' || element.kind === 'math' || element.kind === 'image',
  );

  return (
    <div className="ns-inspector-scroll ns-data-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Evidence layer</span>
            <h2>Data & sources</h2>
          </div>
          <span className="ns-count-pill">{sources.length}</span>
        </div>
        <p>
          Citations stay attached to canonical elements and travel with exported artifacts.
          NodeSlide checks attachment and disclosure; it does not independently verify facts.
        </p>
      </section>

      {selectedElements.length > 0 ? (
        <section className="ns-dependency-card">
          <div className="ns-section-heading">
            <span>
              <Link2 size={13} /> Selection dependencies
            </span>
            <small>{dependencies.length}</small>
          </div>
          {dependencies.length > 0 ? (
            dependencies.map((source) => (
              <div key={source.id}>
                <SourceIcon type={source.sourceType} />
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.citation}</small>
                </span>
              </div>
            ))
          ) : (
            <p>
              No source records are attached to{' '}
              {selectedElements.length === 1 ? 'this element' : 'these elements'}.
            </p>
          )}
        </section>
      ) : null}

      {structuredElements.length > 0 ? (
        <section className="ns-dependency-card ns-primitive-card">
          <div className="ns-section-heading">
            <span>
              <Database size={13} /> Structured primitive
            </span>
            <small>{structuredElements.length}</small>
          </div>
          {structuredElements.map((element) => (
            <PrimitiveDetails element={element} key={element.id} />
          ))}
        </section>
      ) : null}

      <section className="ns-source-list">
        <div className="ns-section-heading">
          <span>Source records</span>
          <small>{sources.length} total</small>
        </div>
        {sources.length === 0 ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <span>
              <Database size={17} />
            </span>
            <strong>No sources yet</strong>
            <p>Sources cited by agents or imports will be recorded here.</p>
          </div>
        ) : (
          sources.map((source) => (
            <article key={source.id} className={dependencyIds.has(source.id) ? 'is-linked' : ''}>
              <span className="ns-source-icon">
                <SourceIcon type={source.sourceType} />
              </span>
              <div>
                <div>
                  <strong>{source.title}</strong>
                  <span>{source.sourceType}</span>
                </div>
                <blockquote>
                  <Quote size={11} />
                  {source.citation.length > 420
                    ? `${source.citation.slice(0, 420)}…`
                    : source.citation}
                </blockquote>
                {source.format || source.rowCount !== undefined || source.columns?.length ? (
                  <div className="ns-source-metadata" aria-label={`${source.title} data shape`}>
                    {source.format ? <span>{source.format.toUpperCase()}</span> : null}
                    {source.rowCount !== undefined ? (
                      <span>{source.rowCount.toLocaleString()} rows</span>
                    ) : null}
                    {source.byteSize !== undefined ? (
                      <span>{formatBytes(source.byteSize)}</span>
                    ) : null}
                    {source.columns?.slice(0, 6).map((column) => (
                      <span key={column}>{column}</span>
                    ))}
                  </div>
                ) : null}
                <small>
                  Retrieved {formatDate(source.retrievedAt)}
                  {source.license ? ` · ${source.license}` : ''}
                </small>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={11} />
                  </a>
                ) : null}
                {source.retention === 'until_deleted' && onDeleteSource ? (
                  <button
                    type="button"
                    className="ns-source-delete"
                    disabled={deletingId === source.id}
                    onClick={() => {
                      setDeleteError(null);
                      setDeletingId(source.id);
                      void onDeleteSource(source.id)
                        .catch((error) =>
                          setDeleteError(
                            error instanceof Error
                              ? error.message
                              : 'The source could not be deleted.',
                          ),
                        )
                        .finally(() => setDeletingId(null));
                    }}
                    aria-label={`Delete private source ${source.title}`}
                  >
                    <Trash2 size={12} /> {deletingId === source.id ? 'Deleting…' : 'Delete data'}
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
        {deleteError ? <output role="alert">{deleteError}</output> : null}
      </section>
    </div>
  );
}

function PrimitiveDetails({ element }: { element: SlideElement }) {
  if (element.kind === 'chart' && element.chart) {
    return (
      <div>
        <BarChart3 size={15} />
        <span>
          <strong>{element.chart.chartType} chart · editable data</strong>
          <small>
            {element.chart.labels
              .map((label, index) => `${label}: ${element.chart?.series[0]?.values[index] ?? '—'}`)
              .join(' · ')}
          </small>
        </span>
      </div>
    );
  }
  if (element.kind === 'math' && element.math) {
    return (
      <div>
        <Calculator size={15} />
        <span>
          <strong>{element.math.display ?? element.math.expression}</strong>
          <small>
            expression: {element.math.expression}
            {(element.math.variables ?? []).length > 0
              ? ` · ${(element.math.variables ?? [])
                  .map(
                    (variable) =>
                      `${variable.label}=${variable.value}${variable.unit ? ` ${variable.unit}` : ''}`,
                  )
                  .join(' · ')}`
              : ''}
          </small>
        </span>
      </div>
    );
  }
  if (element.kind === 'image') {
    return (
      <div>
        <ImageIcon size={15} />
        <span>
          <strong>
            {element.image?.placeholder ? 'Replace-image placeholder' : 'Image asset'}
          </strong>
          <small>
            {element.altText ?? element.name}
            {element.image?.credit ? ` · ${element.image.credit}` : ''}
          </small>
        </span>
      </div>
    );
  }
  return null;
}

function SourceIcon({ type }: { type: SourceRecord['sourceType'] }) {
  if (type === 'spreadsheet') return <Sheet size={15} />;
  if (type === 'note') return <StickyNote size={15} />;
  if (type === 'url') return <Link2 size={15} />;
  return <FileText size={15} />;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
