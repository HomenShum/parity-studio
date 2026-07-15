export const NODESLIDE_DELEGATION_MUTATION_TIMEOUT_MS = 10_000;

/**
 * Keep authority changes bounded even when the transport never settles.
 *
 * The underlying Convex mutation may still finish after the local deadline,
 * but callers fail closed: grant issuance never installs an unknown grant and
 * revocation has already removed the local bearer before this helper is used.
 */
export function withNodeSlideDelegationDeadline<T>(
  operation: Promise<T>,
  action: string,
  timeoutMs = NODESLIDE_DELEGATION_MUTATION_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`${action} could not start because its deadline is invalid.`));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${action} timed out. Review mode remains active.`));
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
