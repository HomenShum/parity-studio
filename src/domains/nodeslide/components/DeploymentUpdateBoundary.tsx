import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

type MonitorDeploymentAction = <Result>(request: Promise<Result>) => Promise<Result>;

const DeploymentActionMonitorContext = createContext<MonitorDeploymentAction | null>(null);

/**
 * Convex actions that were in flight across a deployment can fail while the
 * query socket continues to look healthy. Keep the classifier deliberately
 * narrow: this boundary only sees action promises, and only the two error
 * shapes emitted by Convex for a lost action or a masked action failure.
 */
export function isDeploymentReloadCandidate(error: unknown): boolean {
  const messages = deploymentErrorMessages(error);
  return messages.some(
    (message) =>
      /connection lost while action was in flight/iu.test(message) ||
      /^server error$/iu.test(message.trim()) ||
      /\[convex\s+a\([^\]]+\)\]\s+server error/iu.test(message),
  );
}

export function DeploymentUpdateBoundary({ children }: { children: ReactNode }) {
  const [reloadSuggested, setReloadSuggested] = useState(false);
  const monitor = useCallback<MonitorDeploymentAction>(async (request) => {
    try {
      return await request;
    } catch (error) {
      if (isDeploymentReloadCandidate(error)) setReloadSuggested(true);
      throw error;
    }
  }, []);
  const value = useMemo(() => monitor, [monitor]);

  return (
    <DeploymentActionMonitorContext.Provider value={value}>
      {children}
      {reloadSuggested ? (
        <aside className="ns-deployment-update" data-testid="deployment-update-banner" role="alert">
          <span>
            <strong>NodeSlide may have been updated.</strong>
            <span>
              This action lost its deployment connection. Reload before retrying; no successful
              change is being claimed.
            </span>
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            Reload NodeSlide
          </button>
        </aside>
      ) : null}
    </DeploymentActionMonitorContext.Provider>
  );
}

export function useDeploymentActionMonitor(): MonitorDeploymentAction {
  const monitor = useContext(DeploymentActionMonitorContext);
  if (!monitor) {
    throw new Error('useDeploymentActionMonitor must be used inside DeploymentUpdateBoundary.');
  }
  return monitor;
}

function deploymentErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  if (typeof error === 'string') messages.push(error);
  if (error instanceof Error) messages.push(error.message);
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (typeof data === 'string') messages.push(data);
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      messages.push(data.message);
    }
  }
  return messages;
}
