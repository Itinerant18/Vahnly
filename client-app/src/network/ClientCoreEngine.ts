import { API_GATEWAY_BASE_URL } from '../config';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  useIdempotency?: boolean;
  /** Override the generated idempotency key (e.g. to dedupe a user-level action). */
  idempotencyKey?: string;
  /** Total attempts for transient failures (network / 5xx). Default 3. */
  maxAttempts?: number;
}

/** Raised for client-side errors that must NOT be retried (auth, rate limit, 4xx). */
export class NonRetryableHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'NonRetryableHttpError';
  }
}

/** Raised for transient failures (network / 5xx) that are safe to retry. */
export class RetryableHttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

function generateUUID(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for runtimes without the WebCrypto API.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClientCoreEngine {
  private apiBaseUrl: string;
  private jwtToken: string | null = null;
  private cityPrefix: string;

  constructor(cityPrefix: string, apiBaseUrl: string = API_GATEWAY_BASE_URL) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.cityPrefix = cityPrefix.toUpperCase();
  }

  public setAuthToken(token: string): void {
    this.jwtToken = token;
  }

  /**
   * Execute a secure, hardened request against the Public API Gateway.
   *
   * A single idempotency key is generated ONCE per logical request and reused across all
   * transient retry attempts, so a mutation that is retried after a flaky network/5xx is
   * processed exactly once by the backend.
   */
  public async executeRequest<T>(options: RequestOptions): Promise<T> {
    const useIdempotency = options.useIdempotency === true && options.method !== 'GET';
    const idempotencyKey = useIdempotency
      ? options.idempotencyKey ?? `idmp-client-${generateUUID()}`
      : undefined;

    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.attemptOnce<T>(options, idempotencyKey);
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === maxAttempts - 1;
        if (error instanceof RetryableHttpError && !isLastAttempt) {
          // Full-jitter backoff bounded at 4s to avoid stampeding the gateway.
          const boundedDelay = Math.min(4000, 250 * 2 ** attempt);
          await delay(Math.random() * boundedDelay);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private async attemptOnce<T>(
    options: RequestOptions,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${options.path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Milestone 22: anycast region prefix for edge shard routing.
      'X-Region-Prefix': this.cityPrefix,
      ...options.headers,
    };

    // Milestone 15: cryptographic bearer signature token.
    if (this.jwtToken) {
      headers['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    // Milestones 15 & 21: idempotency fingerprint (stable across retries).
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }

    const fetchConfig: RequestInit = { method: options.method, headers };
    if (options.body !== undefined && options.method !== 'GET') {
      fetchConfig.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchConfig);
    } catch (networkErr) {
      // Connection-level failures are transient and safe to retry with the same key.
      throw new RetryableHttpError(`network_failure: ${String(networkErr)}`);
    }

    if (response.status === 429) {
      throw new NonRetryableHttpError('RATE_LIMIT_EXCEEDED: inbound traffic blocked by gateway.', 429);
    }
    if (response.status === 401) {
      throw new NonRetryableHttpError('UNAUTHORIZED: access signature invalid or expired.', 401);
    }
    if (response.status >= 500) {
      throw new RetryableHttpError(`gateway_server_error: status ${response.status}`, response.status);
    }
    if (!response.ok) {
      throw new NonRetryableHttpError(`HTTP_ERROR: gateway returned status ${response.status}`, response.status);
    }

    if (response.status === 202) {
      return { status: 'PROCESSING' } as unknown as T;
    }
    return (await response.json()) as T;
  }
}
