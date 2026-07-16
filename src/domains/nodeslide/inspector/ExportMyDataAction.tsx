import { useConvex } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Download, LoaderCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
  type NodeSlideOwnerDataExport,
} from '../../../../shared/nodeslideDataExport';
import { downloadNodeSlideDataExport } from '../export/nodeSlideDataExportDownload';

export type ExportMyDataArgs = {
  deckId: string;
  ownerAccessKey: string;
};

type RequestDataExport = (args: ExportMyDataArgs) => Promise<NodeSlideOwnerDataExport>;
type SaveDataExport = (bundle: NodeSlideOwnerDataExport, deckTitle: string) => unknown;

const exportMyDataQuery = makeFunctionReference<
  'query',
  ExportMyDataArgs,
  NodeSlideOwnerDataExport
>('nodeslideDataExport:exportMyData');

export interface ExportMyDataActionProps extends ExportMyDataArgs {
  deckTitle: string;
  className?: string;
}

/** Connected owner-data action ready to drop into an Evidence or project surface. */
export function ExportMyDataAction(props: ExportMyDataActionProps) {
  const convex = useConvex();
  const requestExport = useCallback<RequestDataExport>(
    (args) => convex.query(exportMyDataQuery, args),
    [convex],
  );
  return <ExportMyDataButton {...props} requestExport={requestExport} />;
}

export interface ExportMyDataButtonProps extends ExportMyDataActionProps {
  requestExport: RequestDataExport;
  saveExport?: SaveDataExport;
}

/** Injectable presentation layer used by the connected action and focused tests. */
export function ExportMyDataButton({
  deckId,
  deckTitle,
  ownerAccessKey,
  className,
  requestExport,
  saveExport = downloadNodeSlideDataExport,
}: ExportMyDataButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportData = async () => {
    if (exporting || !deckId || !ownerAccessKey) return;
    setExporting(true);
    setStatus(null);
    setError(null);
    try {
      const bundle = await requestExport({ deckId, ownerAccessKey });
      assertExpectedExportScope(bundle, deckId);
      saveExport(bundle, deckTitle);
      setStatus('Your complete redacted JSON archive was downloaded.');
    } catch (caught) {
      setError(exportErrorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="ns-data-export-control">
      <button
        type="button"
        className={['ns-button', 'ns-button--quiet', 'ns-data-export-action', className]
          .filter(Boolean)
          .join(' ')}
        disabled={exporting || !deckId || !ownerAccessKey}
        onClick={() => void exportData()}
        data-testid="export-my-data"
      >
        {exporting ? <LoaderCircle size={14} className="ns-spin" /> : <Download size={14} />}
        {exporting ? 'Preparing data\u2026' : 'Export my data'}
      </button>
      {error ? <output role="alert">{error}</output> : null}
      {status ? <output aria-live="polite">{status}</output> : null}
    </div>
  );
}

function assertExpectedExportScope(bundle: NodeSlideOwnerDataExport, deckId: string): void {
  if (
    bundle.manifest.schemaVersion !== NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION ||
    bundle.manifest.scope.kind !== 'deck_owner_capability' ||
    bundle.manifest.scope.deckId !== deckId ||
    bundle.manifest.completeness.status !== 'complete' ||
    bundle.manifest.completeness.truncated
  ) {
    throw new Error('NodeSlide data export failed closed: the returned bundle scope is invalid.');
  }
}

function exportErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : 'Your data could not be exported. Try again.';
}
