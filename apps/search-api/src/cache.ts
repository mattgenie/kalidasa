/**
 * Search Cache
 * 
 * In-memory cache for search results to support:
 * - Prior search retrieval ("show me that restaurant search from earlier")
 * - Session-based search history
 * 
 * Note: This is NOT for latency optimization of new searches,
 * but for quickly referencing previous searches in a session.
 */

import type { CAOResult, AnswerBundle, RenderHints } from '@kalidasa/types';

export interface CachedSearch {
    id: string;
    query: string;
    domain: string;
    results: CAOResult[];
    answerBundle: AnswerBundle;
    renderHints: RenderHints;
    timestamp: number;
    ttlMs: number;
}

export interface SearchCacheOptions {
    maxEntries?: number;
    defaultTtlMs?: number;
}

export class SearchCache {
    private cache: Map<string, CachedSearch> = new Map();
    private sessionHistory: string[] = [];  // Ordered list of search IDs
    private maxEntries: number;
    private defaultTtlMs: number;

    constructor(options: SearchCacheOptions = {}) {
        this.maxEntries = options.maxEntries || 50;
        this.defaultTtlMs = options.defaultTtlMs || 60 * 60 * 1000; // 1 hour
    }

    /**
     * Store a search result
     */
    set(
        id: string,
        query: string,
        domain: string,
        results: CAOResult[],
        answerBundle: AnswerBundle,
        renderHints: RenderHints,
        ttlMs?: number
    ): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxEntries) {
            const oldestId = this.sessionHistory.shift();
            if (oldestId) {
                this.cache.delete(oldestId);
            }
        }

        const entry: CachedSearch = {
            id,
            query,
            domain,
            results,
            answerBundle,
            renderHints,
            timestamp: Date.now(),
            ttlMs: ttlMs || this.defaultTtlMs,
        };

        this.cache.set(id, entry);
        this.sessionHistory.push(id);
    }

    /**
     * Get a cached search by ID
     */
    get(id: string): CachedSearch | null {
        const entry = this.cache.get(id);
        if (!entry) return null;

        // Check TTL
        if (Date.now() - entry.timestamp > entry.ttlMs) {
            this.cache.delete(id);
            return null;
        }

        return entry;
    }

    /**
     * Get the most recent search
     */
    getLatest(): CachedSearch | null {
        if (this.sessionHistory.length === 0) return null;
        const latestId = this.sessionHistory[this.sessionHistory.length - 1];
        return this.get(latestId);
    }

    /**
     * Get recent searches (for "show me my recent searches")
     */
    getRecent(limit: number = 5): CachedSearch[] {
        const recent: CachedSearch[] = [];

        // Iterate from most recent
        for (let i = this.sessionHistory.length - 1; i >= 0 && recent.length < limit; i--) {
            const entry = this.get(this.sessionHistory[i]);
            if (entry) {
                recent.push(entry);
            }
        }

        return recent;
    }

    /**
     * Find a previous search by query text (fuzzy match)
     */
    findByQuery(querySubstring: string): CachedSearch | null {
        const queryLower = querySubstring.toLowerCase();

        // Search from most recent
        for (let i = this.sessionHistory.length - 1; i >= 0; i--) {
            const entry = this.get(this.sessionHistory[i]);
            if (entry && entry.query.toLowerCase().includes(queryLower)) {
                return entry;
            }
        }

        return null;
    }

    /**
     * Find previous searches by domain
     */
    findByDomain(domain: string, limit: number = 3): CachedSearch[] {
        const matches: CachedSearch[] = [];

        for (let i = this.sessionHistory.length - 1; i >= 0 && matches.length < limit; i--) {
            const entry = this.get(this.sessionHistory[i]);
            if (entry && entry.domain === domain) {
                matches.push(entry);
            }
        }

        return matches;
    }

    /**
     * Clear expired entries
     */
    prune(): number {
        let pruned = 0;
        const now = Date.now();

        for (const [id, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttlMs) {
                this.cache.delete(id);
                this.sessionHistory = this.sessionHistory.filter(h => h !== id);
                pruned++;
            }
        }

        return pruned;
    }

    /**
     * Clear all cached searches
     */
    clear(): void {
        this.cache.clear();
        this.sessionHistory = [];
    }

    /**
     * Get cache stats
     */
    stats(): { size: number; oldest: number | null; newest: number | null } {
        if (this.cache.size === 0) {
            return { size: 0, oldest: null, newest: null };
        }

        let oldest = Infinity;
        let newest = 0;

        for (const entry of this.cache.values()) {
            oldest = Math.min(oldest, entry.timestamp);
            newest = Math.max(newest, entry.timestamp);
        }

        return {
            size: this.cache.size,
            oldest: oldest === Infinity ? null : oldest,
            newest: newest === 0 ? null : newest,
        };
    }
}

// Singleton instance for the application
export const searchCache = new SearchCache();
