import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/domains/nodeslide/nodeslide.css';
import '../../src/domains/nodeslide/nodeslideV3.css';
import { TraceInspector } from '../../src/domains/nodeslide/inspector/TraceInspector';
import { createTraceWaterfallFixture } from '../../src/domains/nodeslide/inspector/TraceWaterfall.fixture';

function integerParam(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const totalSpanCount = Math.min(1_000, integerParam('count', 100));
const initialLoadedSpanCount = Math.min(totalSpanCount, integerParam('loaded', totalSpanCount));
const theme =
  new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';

window.sessionStorage.setItem('ns-trace-density', 'pro');

function TraceScaleHarness() {
  const [loadedSpanCount, setLoadedSpanCount] = useState(initialLoadedSpanCount);
  const [loading, setLoading] = useState(false);
  const fixture = useMemo(
    () => createTraceWaterfallFixture(totalSpanCount, { loadedSpanCount }),
    [loadedSpanCount],
  );

  const loadAllTelemetry = async () => {
    setLoading(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    setLoadedSpanCount(totalSpanCount);
    setLoading(false);
  };

  return (
    <div
      className="nodeslide-studio"
      data-testid="trace-fixture-studio"
      data-ns-theme={theme}
      style={{ display: 'block', width: '100%', height: '100%', minHeight: 0 }}
    >
      <main
        data-testid="trace-fixture-shell"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 360px',
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          background: 'var(--ns-bg)',
        }}
      >
        <section
          aria-label="Fixture editing canvas"
          style={{
            minWidth: 0,
            padding: 32,
            color: 'var(--ns-ink)',
            background:
              'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--ns-collaboration) 8%, transparent), transparent 45%), var(--ns-bg)',
          }}
        >
          <span style={{ color: 'var(--ns-faint)', font: '600 10px/1 var(--ns-mono)' }}>
            DETERMINISTIC QA FIXTURE
          </span>
          <h1 style={{ maxWidth: 620, margin: '18px 0 8px', fontSize: 34 }}>
            Trace scalability without consuming the editing canvas
          </h1>
          <p style={{ maxWidth: 620, color: 'var(--ns-ink-2)' }}>
            This neighboring canvas stands in for the deck editor while the compact Trace sidebar
            and expanded observability workspace transition around it.
          </p>
          <output
            data-testid="trace-fixture-span-count"
            style={{ display: 'block', marginTop: 24, font: '600 12px/1.4 var(--ns-mono)' }}
          >
            {loadedSpanCount.toLocaleString()} of {totalSpanCount.toLocaleString()} spans loaded
          </output>
        </section>
        <aside
          data-testid="trace-fixture-sidebar"
          aria-label="Fixture inspector sidebar"
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            borderLeft: '1px solid var(--ns-line)',
            background: 'var(--ns-panel)',
          }}
        >
          <TraceInspector
            traces={[fixture.trace]}
            validations={[fixture.validation]}
            agentRuns={[fixture.run]}
            agentMessages={fixture.messages}
            agentTelemetry={fixture.telemetry}
            agentTelemetryRunId={fixture.run.id}
            sources={fixture.sources}
            agentTelemetryLoadingMore={loading}
            onSelectAgentRun={() => {}}
            onLoadMoreAgentTelemetry={loadAllTelemetry}
          />
        </aside>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<TraceScaleHarness />);
