/**
 * Enrichment Executor
 * 
 * Executes enrichment hooks in parallel for all candidates.
 */

import type {
    RawCAOCandidate,
    EnrichedCandidate,
    EnrichmentContext,
    EnrichmentData
} from '@kalidasa/types';
import { HookRegistry } from './registry.js';

export interface ExecutorOptions {
    /** Timeout per hook in ms (default 2000) */
    timeout: number;
    /** Request ID for logging */
    requestId: string;
    /** Search location for geo-based enrichment */
    searchLocation?: {
        city?: string;
        coordinates?: { lat: number; lng: number };
    };
}

export class EnrichmentExecutor {
    private registry: HookRegistry;

    constructor(registry: HookRegistry) {
        this.registry = registry;
    }

    /**
     * Execute enrichment for all candidates in parallel
     */
    async execute(
        candidates: RawCAOCandidate[],
        options: ExecutorOptions
    ): Promise<{
        enriched: EnrichedCandidate[];
        stats: EnrichmentStats;
    }> {
        const startTime = Date.now();
        const hookStats: Record<string, { success: number; failed: number }> = {};

        const context: EnrichmentContext = {
            searchLocation: options.searchLocation,
            timeout: options.timeout,
            requestId: options.requestId,
        };

        // Process all candidates in parallel
        const enrichmentPromises = candidates.map(candidate =>
            this.enrichCandidate(candidate, context, hookStats)
        );

        const enriched = await Promise.all(enrichmentPromises);

        // Calculate stats
        const verifiedCount = enriched.filter(c => c.verified).length;
        const hookSuccessRates: Record<string, number> = {};

        for (const [hookName, stats] of Object.entries(hookStats)) {
            const total = stats.success + stats.failed;
            hookSuccessRates[hookName] = total > 0 ? stats.success / total : 0;
        }

        return {
            enriched,
            stats: {
                candidatesProcessed: candidates.length,
                candidatesVerified: verifiedCount,
                verificationRate: candidates.length > 0 ? verifiedCount / candidates.length : 0,
                hookSuccessRates,
                totalTimeMs: Date.now() - startTime,
            },
        };
    }

    /**
     * Enrich a single candidate by trying its specified hooks
     */
    private async enrichCandidate(
        candidate: RawCAOCandidate,
        context: EnrichmentContext,
        hookStats: Record<string, { success: number; failed: number }>
    ): Promise<EnrichedCandidate> {
        const hooksToTry = candidate.enrichment_hooks || [];

        console.log(`[Executor] Enriching "${candidate.name}" with hooks: [${hooksToTry.join(', ')}]`);

        if (hooksToTry.length === 0) {
            console.log(`[Executor] No hooks specified for "${candidate.name}"`);
            return { ...candidate, verified: false };
        }

        // Try each hook in order until one succeeds
        for (const hookName of hooksToTry) {
            const hook = this.registry.get(hookName);

            if (!hook) {
                console.warn(`[Executor] Hook not found: ${hookName}`);
                continue;
            }

            // Initialize stats for this hook
            if (!hookStats[hookName]) {
                hookStats[hookName] = { success: 0, failed: 0 };
            }

            try {
                // Execute with timeout
                const result = await Promise.race([
                    hook.enrich(candidate, context),
                    this.timeout(context.timeout, hookName),
                ]) as EnrichmentData | null;

                if (result && result.verified) {
                    hookStats[hookName].success++;
                    return {
                        ...candidate,
                        verified: true,
                        enrichment: result,
                    };
                }

                hookStats[hookName].failed++;
            } catch (error) {
                hookStats[hookName].failed++;
                console.warn(`[Executor] Hook ${hookName} failed for ${candidate.name}:`, error);
            }
        }

        // No hooks succeeded
        return { ...candidate, verified: false };
    }

    /**
     * Create a timeout promise
     */
    private timeout(ms: number, hookName: string): Promise<null> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Hook ${hookName} timed out after ${ms}ms`));
            }, ms);
        });
    }
}

export interface EnrichmentStats {
    candidatesProcessed: number;
    candidatesVerified: number;
    verificationRate: number;
    hookSuccessRates: Record<string, number>;
    totalTimeMs: number;
}
