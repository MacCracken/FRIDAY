/**
 * ChromaDB Vector Store
 *
 * Connects to a running ChromaDB server via its HTTP REST API (v1).
 * Uses cosine similarity and auto-creates the collection on first use.
 * No extra npm dependencies — uses the Node.js global fetch.
 *
 * Requires a ChromaDB server (default: http://localhost:8000).
 * Start one with: docker run -p 8000:8000 chromadb/chroma
 */

import type { VectorStore, VectorResult } from './types.js';

export interface ChromaStoreConfig {
  url: string;
  collection: string;
  dimensions: number;
}

interface ChromaQueryResponse {
  ids: string[][];
  distances: number[][];
  metadatas: (Record<string, unknown> | null)[][];
}

export class ChromaVectorStore implements VectorStore {
  private readonly baseUrl: string;
  private readonly collectionName: string;
  private readonly dimensions: number;
  /** Cached UUID returned by ChromaDB for the collection. */
  private collectionId: string | null = null;

  constructor(config: ChromaStoreConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.collectionName = config.collection;
    this.dimensions = config.dimensions;
  }

  // ── HTTP helper ────────────────────────────────────────────────

  private async request(path: string, init?: RequestInit): Promise<Response> {
    // Use the Headers API to merge: a `HeadersInit` may be an array or `Headers`,
    // so spreading it into an object literal is unsafe (lists indices).
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  // ── Collection lifecycle ───────────────────────────────────────

  /**
   * Returns the collection UUID, creating it if needed.
   * ChromaDB operations require the UUID (not the name) for collection-level endpoints.
   */
  private async ensureCollection(): Promise<string> {
    if (this.collectionId) return this.collectionId;

    const res = await this.request('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({
        name: this.collectionName,
        // Use cosine distance so scores map directly to cosine similarity via (1 - distance)
        metadata: { 'hnsw:space': 'cosine' },
        get_or_create: true,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `ChromaDB: failed to get/create collection "${this.collectionName}": ${res.status} ${res.statusText}`
      );
    }

    const data = (await res.json()) as { id: string };
    this.collectionId = data.id;
    return this.collectionId;
  }

  /**
   * Wraps an operation with a single reconnect retry.
   * If the operation fails (e.g. the server restarted and the collection UUID changed),
   * the cached ID is cleared and the operation is retried once.
   */
  private async withReconnect<T>(op: (collectionId: string) => Promise<T>): Promise<T> {
    let collectionId = await this.ensureCollection();
    try {
      return await op(collectionId);
    } catch {
      this.collectionId = null;
      collectionId = await this.ensureCollection();
      return op(collectionId);
    }
  }

  // ── VectorStore interface ──────────────────────────────────────

  async insert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    await this.insertBatch([{ id, vector, metadata }]);
  }

  async insertBatch(
    items: { id: string; vector: number[]; metadata?: Record<string, unknown> }[]
  ): Promise<void> {
    if (items.length === 0) return;

    await this.withReconnect(async (collectionId) => {
      const res = await this.request(`/api/v1/collections/${collectionId}/upsert`, {
        method: 'POST',
        body: JSON.stringify({
          ids: items.map((i) => i.id),
          embeddings: items.map((i) => i.vector),
          metadatas: items.map((i) => i.metadata ?? {}),
        }),
      });

      if (!res.ok) {
        throw new Error(`ChromaDB upsert failed: ${res.status} ${res.statusText}`);
      }
    });
  }

  async search(vector: number[], limit: number, threshold = 0): Promise<VectorResult[]> {
    return this.withReconnect(async (collectionId) => {
      // ChromaDB throws if n_results > number of items in the collection.
      // Fetch the count first and clamp to prevent the error.
      const countRes = await this.request(`/api/v1/collections/${collectionId}/count`);
      const total = countRes.ok ? ((await countRes.json()) as number) : 0;
      if (total === 0) return [];

      const nResults = Math.min(limit, total);
      const res = await this.request(`/api/v1/collections/${collectionId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          query_embeddings: [vector],
          n_results: nResults,
          include: ['distances', 'metadatas'],
        }),
      });

      if (!res.ok) {
        throw new Error(`ChromaDB query failed: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as ChromaQueryResponse;

      const ids = data.ids[0] ?? [];
      const distances = data.distances[0] ?? [];
      const metadatas = data.metadatas[0] ?? [];

      return ids
        .map((id, i) => ({
          id,
          // ChromaDB cosine distance = 1 − similarity → invert back to similarity
          score: 1 - (distances[i] ?? 1),
          metadata: metadatas[i] ?? {},
        }))
        .filter((r) => r.score >= threshold);
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      return await this.withReconnect(async (collectionId) => {
        const res = await this.request(`/api/v1/collections/${collectionId}/delete`, {
          method: 'POST',
          body: JSON.stringify({ ids: [id] }),
        });
        return res.ok;
      });
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    try {
      return await this.withReconnect(async (collectionId) => {
        const res = await this.request(`/api/v1/collections/${collectionId}/count`);
        if (!res.ok) return 0;
        return (await res.json()) as number;
      });
    } catch {
      return 0;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request('/api/v1/heartbeat');
      return res.ok;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No persistent connection to tear down — just clear the cached collection ID.
    this.collectionId = null;
  }
}
