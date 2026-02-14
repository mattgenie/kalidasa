/**
 * Permanent file-based cache for Diffbot article extractions.
 * Keyed by normalized URL. Stores both successes and failures (null)
 * to avoid retrying known-bad URLs.
 *
 * No TTL — article content doesn't change (barring corrections).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DiffbotExtraction {
    author?: string;
    date?: string;
    siteName?: string;
    imageUrl?: string;
    text?: string;
    wordCount?: number;
}

interface CacheEntry {
    data: DiffbotExtraction | null;
    cachedAt: number; // ms timestamp — diagnostic only, not used for expiry
}

const MISS = Symbol('cache-miss');
export type CacheResult = DiffbotExtraction | null | typeof MISS;

export class DiffbotCache {
    private cache: Map<string, CacheEntry>;
    private filePath: string;
    private dirty = false;

    // Stats for logging
    private hits = 0;
    private misses = 0;

    constructor(dataDir?: string) {
        const dir = dataDir || path.join(__dirname, '..', 'data');
        this.filePath = path.join(dir, 'diffbot-cache.json');
        this.cache = this.load(dir);
    }

    /**
     * Look up a URL in the cache.
     * Returns:
     *  - DiffbotExtraction (cached success)
     *  - null (cached failure — known-bad URL)
     *  - MISS symbol (not in cache)
     */
    get(url: string): CacheResult {
        const key = this.normalizeUrl(url);
        const entry = this.cache.get(key);
        if (entry !== undefined) {
            this.hits++;
            return entry.data;
        }
        this.misses++;
        return MISS;
    }

    /** Check if a result is a cache miss */
    static isMiss(result: CacheResult): result is typeof MISS {
        return result === MISS;
    }

    /** Store an extraction result (success or failure) */
    set(url: string, data: DiffbotExtraction | null): void {
        const key = this.normalizeUrl(url);
        this.cache.set(key, { data, cachedAt: Date.now() });
        this.dirty = true;
    }

    /** Persist cache to disk */
    save(): void {
        if (!this.dirty) return;
        try {
            const entries: Record<string, CacheEntry> = {};
            for (const [k, v] of this.cache) {
                entries[k] = v;
            }
            fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 0));
            this.dirty = false;
        } catch (err) {
            console.warn('[DiffbotCache] Save error:', err);
        }
    }

    /** Return cache stats for logging */
    stats(): { total: number; hits: number; misses: number } {
        return { total: this.cache.size, hits: this.hits, misses: this.misses };
    }

    /** Reset per-query stats (call at start of each search) */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }

    private normalizeUrl(url: string): string {
        return url.replace(/[?#].*$/, '').toLowerCase();
    }

    private load(dir: string): Map<string, CacheEntry> {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(this.filePath)) {
                const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
                const map = new Map<string, CacheEntry>();
                for (const [k, v] of Object.entries(raw)) {
                    map.set(k, v as CacheEntry);
                }
                return map;
            }
        } catch (err) {
            console.warn('[DiffbotCache] Load error, starting fresh:', err);
        }
        return new Map();
    }
}
