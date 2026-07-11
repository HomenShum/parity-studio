import { Database, ExternalLink, FileText, Link2, Quote, Sheet, StickyNote } from 'lucide-react';
import type { SlideElement, SourceRecord } from '../../../../shared/nodeslide';

interface DataInspectorProps {
  sources: readonly SourceRecord[];
  selectedElements: readonly SlideElement[];
}

export function DataInspector({ sources, selectedElements }: DataInspectorProps) {
  const dependencyIds = new Set(selectedElements.flatMap((element) => element.sourceIds));
  const dependencies = sources.filter((source) => dependencyIds.has(source.id));

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
                  {source.citation}
                </blockquote>
                <small>
                  Retrieved {formatDate(source.retrievedAt)}
                  {source.license ? ` · ${source.license}` : ''}
                </small>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
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
