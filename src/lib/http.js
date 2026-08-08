/**
 * Retrieval layer. Every request is bounded: timeout, redirect cap, response
 * size cap, and a small retry budget for transient failures. A source that
 * misbehaves fails on its own and never blocks the rest of the cycle.
 */

// Conventional identifying bot string: says who is calling and where to
// complain, in the "Mozilla/5.0 (compatible; ...)" form most public sites
// expect from a crawler.
const USER_AGENT =
  'Mozilla/5.0 (compatible; AlertoMalolosBot/1.0; +https://github.com/benedict-dejesus/AlertoMalolos)';

export const DEFAULTS = {
  timeoutMs: 20000,
  retries: 2,
  retryDelayMs: 1500,
  maxBytes: 4 * 1024 * 1024,
};

export class FetchError extends Error {
  constructor(message, { status = null, kind = 'network', url } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.kind = kind;
    this.url = url;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetch a document as text.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {{etag?: string, lastModified?: string}} [options.validators] conditional GET
 * @param {typeof fetch} [options.fetchImpl] injected for tests
 * @returns {Promise<{status:number, body:string, notModified:boolean, etag:string|null,
 *   lastModified:string|null, contentType:string, finalUrl:string, fetchedAt:string}>}
 */
export async function fetchText(url, options = {}) {
  const {
    timeoutMs = DEFAULTS.timeoutMs,
    retries = DEFAULTS.retries,
    retryDelayMs = DEFAULTS.retryDelayMs,
    maxBytes = DEFAULTS.maxBytes,
    validators = {},
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5',
        'accept-language': 'en-PH,en;q=0.9,fil;q=0.8',
      };
      if (validators.etag) headers['if-none-match'] = validators.etag;
      if (validators.lastModified) headers['if-modified-since'] = validators.lastModified;

      const response = await fetchImpl(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      if (response.status === 304) {
        return {
          status: 304,
          body: '',
          notModified: true,
          etag: validators.etag ?? null,
          lastModified: validators.lastModified ?? null,
          contentType: response.headers?.get?.('content-type') ?? '',
          finalUrl: response.url || url,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (!response.ok) {
        const error = new FetchError(`HTTP ${response.status}`, {
          status: response.status,
          kind: 'http',
          url,
        });
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = error;
          await sleepImpl(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }

      const body = await readCapped(response, maxBytes);
      return {
        status: response.status,
        body,
        notModified: false,
        etag: response.headers?.get?.('etag') ?? null,
        lastModified: response.headers?.get?.('last-modified') ?? null,
        contentType: response.headers?.get?.('content-type') ?? '',
        finalUrl: response.url || url,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const wrapped =
        error instanceof FetchError
          ? error
          : new FetchError(
              error?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : String(error?.message ?? error),
              { kind: error?.name === 'AbortError' ? 'timeout' : 'network', url }
            );
      lastError = wrapped;
      const retryable = wrapped.kind !== 'http' || RETRYABLE_STATUS.has(wrapped.status);
      if (attempt < retries && retryable) {
        await sleepImpl(retryDelayMs * (attempt + 1));
        continue;
      }
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new FetchError('Unknown retrieval failure', { url });
}

/** Read a response body but stop once the cap is reached. */
async function readCapped(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
  }
  try {
    await reader.cancel();
  } catch {
    /* the stream is already closed */
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
