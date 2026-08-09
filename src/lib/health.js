/**
 * Source health.
 *
 * The board is built to survive a source being down: the cycle carries on and
 * the previous board stays up. That resilience has a cost - a source can fail
 * every hour for weeks and nothing says so. The city website did exactly that,
 * pointing at a domain that does not resolve, and never once succeeded.
 *
 * This turns what the update cycle already records in data/state.json into a
 * verdict, so silence stops counting as success.
 */

export const DEFAULT_MAX_FAILURES = 3;

/**
 * @param {object|undefined} entry the per-source record from state.sources
 * @returns {{status:'healthy'|'stale'|'broken'|'unknown', failures:number, detail:string}}
 */
export function healthOf(entry, { maxFailures = DEFAULT_MAX_FAILURES } = {}) {
  const failures = entry?.consecutiveFailures ?? 0;

  if (!entry) return { status: 'unknown', failures, detail: 'no run recorded yet' };

  // A source that has never been retrieved is not waiting to settle - it is
  // misconfigured. A dead domain or a wrong path looks exactly like this, and
  // it should be loud on the first run rather than after the failure limit.
  if (!entry.lastSuccessAt) {
    return { status: 'broken', failures, detail: `never retrieved in ${failures} attempt(s)` };
  }
  if (failures >= maxFailures) {
    return { status: 'broken', failures, detail: `${failures} failures in a row` };
  }
  if (failures > 0) {
    return { status: 'stale', failures, detail: `${failures} failure(s) since the last success` };
  }
  return { status: 'healthy', failures, detail: `retrieved ${entry.lastSuccessAt}` };
}

const ORDER = { broken: 0, unknown: 1, stale: 2, healthy: 3 };

/** One row per source given, worst first, then by tier. */
export function report(sources, sourceState = {}, options = {}) {
  return sources
    .map((source) => {
      const entry = sourceState[source.id];
      return {
        id: source.id,
        name: source.name,
        tier: source.tier,
        kind: source.kind,
        ...healthOf(entry, options),
        lastError: entry?.lastError ?? null,
        lastSuccessAt: entry?.lastSuccessAt ?? null,
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.tier - b.tier);
}

/** The rows that should make an hourly run go red. */
export function brokenIn(rows) {
  return rows.filter((row) => row.status === 'broken');
}
