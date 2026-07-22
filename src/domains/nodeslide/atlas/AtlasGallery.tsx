import { useMemo, useState } from 'react';
import {
  ATLAS_ARTIFACT_FAMILIES,
  ATLAS_ARTIFACT_KINDS,
  ATLAS_USAGE_INTENTS,
  type AtlasArchetype,
  type AtlasArtifactFamily,
  type AtlasArtifactKind,
  evaluateAtlasUsage,
} from '../../../../shared/nodeslideAtlas';
import {
  type AtlasArchetypeQuery,
  MAX_ATLAS_QUERY_RESULTS,
  NODESLIDE_ATLAS_ARCHETYPES,
  NODESLIDE_ATLAS_SOURCE_POLICIES,
  searchAtlasArchetypes,
} from '../../../../shared/nodeslideAtlasRegistry';
import './atlasGallery.css';

type AtlasMode = 'gallery' | 'model-compare' | 'harness-compare';

const MODES: readonly { id: AtlasMode; label: string; hint: string }[] = [
  { id: 'gallery', label: 'Artifact Gallery', hint: 'Browse every archetype the Atlas catalogues' },
  { id: 'model-compare', label: 'Model Compare', hint: 'One brief, several models, side by side' },
  { id: 'harness-compare', label: 'Harness Compare', hint: 'Did the model improve, or the harness?' },
];

const FAMILY_LABELS: Record<AtlasArtifactFamily, string> = {
  narrative: 'Narrative',
  data: 'Data',
  systems: 'Systems',
  progression: 'Progression',
  'product-evidence': 'Product & evidence',
  technical: 'Technical',
  media: 'Media',
  decision: 'Decision',
};

export function AtlasGallery() {
  const [mode, setMode] = useState<AtlasMode>('gallery');
  const [text, setText] = useState('');
  const [family, setFamily] = useState<AtlasArtifactFamily | 'all'>('all');
  const [kind, setKind] = useState<AtlasArtifactKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string>('systems.architecture');

  const results = useMemo(() => {
    // Built conditionally: exactOptionalPropertyTypes distinguishes "absent" from "undefined".
    const query: AtlasArchetypeQuery = { limit: MAX_ATLAS_QUERY_RESULTS };
    const trimmed = text.trim();
    if (trimmed) query.text = trimmed;
    if (family !== 'all') query.family = family;
    if (kind !== 'all') query.requiresArtifactKind = kind;
    return searchAtlasArchetypes(query);
  }, [text, family, kind]);

  const truncated = results.length === MAX_ATLAS_QUERY_RESULTS;

  const selected = useMemo(
    () => NODESLIDE_ATLAS_ARCHETYPES.find((entry) => entry.id === selectedId) ?? results[0] ?? null,
    [selectedId, results],
  );

  return (
    <main className="atlas" data-testid="atlas-gallery">
      <header className="atlas__topbar">
        <div>
          <h1 className="atlas__title">NodeSlide Atlas</h1>
          <p className="atlas__subtitle">
            {NODESLIDE_ATLAS_ARCHETYPES.length} slide archetypes across{' '}
            {ATLAS_ARTIFACT_FAMILIES.length} families, {NODESLIDE_ATLAS_SOURCE_POLICIES.length}{' '}
            reviewed sources.
          </p>
        </div>
        <nav className="atlas__modes" aria-label="Atlas mode">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="atlas__mode"
              aria-current={mode === entry.id ? 'page' : undefined}
              data-testid={`atlas-mode-${entry.id}`}
              title={entry.hint}
              onClick={() => setMode(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {mode === 'gallery' ? (
        <div className="atlas__layout">
          <aside className="atlas__filters" aria-label="Filters">
            <label className="atlas__field">
              <span>Narrative job</span>
              <input
                type="search"
                value={text}
                placeholder="explain technical architecture"
                data-testid="atlas-search"
                onChange={(event) => setText(event.target.value)}
              />
            </label>

            <label className="atlas__field">
              <span>Family</span>
              <select
                value={family}
                data-testid="atlas-family"
                onChange={(event) =>
                  setFamily(event.target.value as AtlasArtifactFamily | 'all')
                }
              >
                <option value="all">All families</option>
                {ATLAS_ARTIFACT_FAMILIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {FAMILY_LABELS[entry]}
                  </option>
                ))}
              </select>
            </label>

            <label className="atlas__field">
              <span>Must produce</span>
              <select
                value={kind}
                data-testid="atlas-kind"
                onChange={(event) => setKind(event.target.value as AtlasArtifactKind | 'all')}
              >
                <option value="all">Any artifact</option>
                {ATLAS_ARTIFACT_KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>

            <section className="atlas__sources">
              <h2>Source lanes</h2>
              <ul>
                {NODESLIDE_ATLAS_SOURCE_POLICIES.map((policy) => (
                  <li key={policy.id}>
                    <span className="atlas__source-name">{policy.name}</span>
                    <span className={`atlas__lane atlas__lane--${policy.accessMode}`}>
                      {policy.accessMode}
                    </span>
                    <span
                      className={`atlas__status atlas__status--${policy.status}`}
                      data-testid={`atlas-source-status-${policy.id}`}
                    >
                      {policy.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <section className="atlas__results" aria-label="Archetypes">
            <p className="atlas__count" data-testid="atlas-count">
              {results.length === 0
                ? 'No archetype matches these filters.'
                : `${results.length} archetype${results.length === 1 ? '' : 's'}`}
              {truncated ? (
                <span className="atlas__truncated" data-testid="atlas-truncated">
                  {' '}
                  — capped at {MAX_ATLAS_QUERY_RESULTS}; narrow the filters to see the rest.
                </span>
              ) : null}
            </p>
            <ul className="atlas__grid">
              {results.map((archetype) => (
                <li key={archetype.id}>
                  <button
                    type="button"
                    className="atlas__card"
                    aria-pressed={selected?.id === archetype.id}
                    data-testid={`atlas-card-${archetype.id}`}
                    onClick={() => setSelectedId(archetype.id)}
                  >
                    <span className="atlas__card-family">{FAMILY_LABELS[archetype.family]}</span>
                    <span className="atlas__card-title">{archetype.title}</span>
                    <span className="atlas__card-job">{archetype.narrativeJob}</span>
                    <span className="atlas__card-requires">
                      {archetype.requiredArtifactKinds.map((entry) => (
                        <em key={entry}>{entry}</em>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <aside className="atlas__detail" aria-label="Archetype detail">
            {selected ? <ArchetypeDetail archetype={selected} /> : <p>Select an archetype.</p>}
          </aside>
        </div>
      ) : (
        <CompareMode mode={mode} />
      )}
    </main>
  );
}

function ArchetypeDetail({ archetype }: { archetype: AtlasArchetype }) {
  return (
    <article data-testid="atlas-detail">
      <h2 className="atlas__detail-title">{archetype.title}</h2>
      <p className="atlas__detail-id">{archetype.id}</p>

      <h3>Narrative job</h3>
      <p>{archetype.narrativeJob}</p>

      <h3>Must actually contain</h3>
      <ul className="atlas__pills">
        {archetype.requiredArtifactKinds.map((entry) => (
          <li key={entry} className="atlas__pill atlas__pill--required">
            {entry}
          </li>
        ))}
      </ul>

      <h3>Rejected substitutes</h3>
      <ul className="atlas__pills">
        {archetype.forbiddenSubstitutes.map((entry) => (
          <li key={entry} className="atlas__pill atlas__pill--forbidden">
            {entry}
          </li>
        ))}
      </ul>
      <p className="atlas__note">
        The topology gate fails a generated slide that falls back to any of these, so an archetype
        cannot be satisfied by prose describing the artifact it requires.
      </p>

      <h3>Reuse by source lane</h3>
      <table className="atlas__licence" data-testid="atlas-licence-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Display</th>
            <th scope="col">Cache</th>
            <th scope="col">Retrieval index</th>
            <th scope="col">Training</th>
          </tr>
        </thead>
        <tbody>
          {NODESLIDE_ATLAS_SOURCE_POLICIES.map((policy) => (
            <tr key={policy.id}>
              <th scope="row">{policy.id}</th>
              {(['display-thumbnail', 'cache', 'rag-index', 'model-training'] as const).map(
                (intent) => {
                  const decision = evaluateAtlasUsage(policy, [intent]);
                  return (
                    <td
                      key={intent}
                      className={decision.allowed ? 'atlas__allow' : 'atlas__deny'}
                      data-testid={`atlas-usage-${policy.id}-${intent}`}
                      title={decision.reasons.join(' ')}
                    >
                      {decision.allowed ? 'allow' : 'deny'}
                    </td>
                  );
                },
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="atlas__note">
        Every one of the {ATLAS_USAGE_INTENTS.length} usage intents is asked separately. A source
        absent from this table is denied by default.
      </p>
    </article>
  );
}

/**
 * Both compare modes read from arena receipts. None have been recorded yet, so this states that
 * plainly instead of rendering placeholder candidates that would read as real results.
 */
function CompareMode({ mode }: { mode: Exclude<AtlasMode, 'gallery'> }) {
  const isModel = mode === 'model-compare';
  return (
    <section className="atlas__empty" data-testid={`atlas-empty-${mode}`}>
      <h2>{isModel ? 'Model Compare' : 'Harness Compare'}</h2>
      <p className="atlas__empty-status" data-testid="atlas-empty-status">
        No arena receipts recorded yet.
      </p>
      <p>
        {isModel
          ? 'This view compares candidates for one brief across the model fleet, with each candidate’s rendered output, gate results, repair count, cost and latency.'
          : 'This view holds the model constant and varies the harness version, so an improvement can be attributed to the system rather than the model.'}
      </p>
      <p className="atlas__note">
        It populates from <code>planArenaCoverage</code> runs. Until a run writes receipts, this
        surface reports nothing rather than showing an example that has not been produced.
      </p>
    </section>
  );
}
