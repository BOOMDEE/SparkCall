export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface KVNamespace {
  get<T = unknown>(key: string, type?: "text" | "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DurableObjectId { toString(): string; }
export interface DurableObjectStub { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>; }
export interface DurableObjectNamespace { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub; }
export interface AssetFetcher { fetch(request: Request): Promise<Response>; }

export interface Env {
  DB: D1Database;
  RATE_LIMIT?: KVNamespace;
  SIGNALING: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  ASSETS: AssetFetcher;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  TURN_ANALYTICS_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  TURN_MONTHLY_QUOTA_BYTES?: string;
  TURN_PLATFORM_MONTHLY_LIMIT_BYTES?: string;
  INTERNAL_SIGNALING_TOKEN?: string;
  ADMIN_USER_IDS?: string;
  ALLOWED_ORIGIN?: string;
  SESSION_TTL_SECONDS?: string;
  TEMP_SESSION_TTL_SECONDS?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
  SPARKCALL_WEBHOOK_ENCRYPTION_KEY?: string;
}
