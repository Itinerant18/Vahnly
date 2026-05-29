import crypto from 'crypto';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  headers?: Record<string, string>;
  useIdempotency?: boolean;
}

export class ClientCoreEngine {
  private apiBaseUrl: string;
  private jwtToken: string | null = null;
  private cityPrefix: string;

  constructor(apiBaseUrl: string, cityPrefix: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.cityPrefix = cityPrefix.toUpperCase();
  }

  public setAuthToken(token: string): void {
    this.jwtToken = token;
  }

  /**
   * Execute secure, hardened HTTP requests to the Public API Gateway
   */
  public async executeRequest<T>(options: RequestOptions): Promise<T> {
    const url = `${this.apiBaseUrl}${options.path}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // MILESTONE 22: Inject Anycast Region Prefix for Edge Shard Routing
      'X-Region-Prefix': this.cityPrefix,
      ...options.headers,
    };

    // MILESTONE 15: Attach Cryptographic Bearer Signature Validation Token
    if (this.jwtToken) {
      headers['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    // MILESTONE 15 & 21: Enforce Request Idempotency Fingerprinting to block duplicate loops
    if (options.useIdempotency && options.method !== 'GET') {
      headers['X-Idempotency-Key'] = `idmp-client-${crypto.randomUUID()}`;
    }

    const fetchConfig: RequestInit = {
      method: options.method,
      headers: headers,
    };

    if (options.body && options.method !== 'GET') {
      fetchConfig.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, fetchConfig);
      
      if (response.status === 429) { //
        throw new Error('RATE_LIMIT_EXCEEDED: Inbound traffic spam blocked by gateway.'); //
      }
      if (response.status === 401) { //
        throw new Error('UNAUTHORIZED: Access signature invalid or expired.'); //
      }
      if (!response.ok) {
        throw new Error(`HTTP_ERROR: Gateway returned status code ${response.status}`);
      }

      if (response.status === 202) {
        return { status: 'PROCESSING' } as unknown as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error(`[NETWORK_CORE_CRITICAL] Transaction failed on route ${options.path}:`, error);
      throw error;
    }
  }
}
