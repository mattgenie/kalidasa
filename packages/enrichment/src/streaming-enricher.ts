/**
 * Streaming Enricher
 * 
 * Enriches single candidates as they arrive from the streaming generator.
 * No batching - each candidate is processed immediately.
 */

import type { RawCAOCandidate, EnrichedCandidate, EnrichmentContext } from '@kalidasa/types';
import type { HookRegistry } from './registry.js';

export class StreamingEnricher {
    private registry: HookRegistry;

    constructor(registry: HookRegistry) {
        this.registry = registry;
    }

    /**
     * Enrich a single candidate immediately
     */
    async enrichOne(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichedCandidate> {
        const startTime = Date.now();

        // Get hooks for this candidate
        const hookNames = candidate.enrichment_hooks || [];

        for (const hookName of hookNames) {
            const hook = this.registry.get(hookName);
            if (!hook) {
                console.log(`[StreamEnricher] Hook not found: ${hookName}`);
                continue;
            }

            try {
                const result = await Promise.race([
                    hook.enrich(candidate, context),
                    new Promise<null>((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), context.timeout)
                    ),
                ]);

                if (result?.verified) {
                    console.log(`[StreamEnricher] ✓ ${candidate.name} verified by ${hookName} (${Date.now() - startTime}ms)`);
                    return {
                        ...candidate,
                        verified: true,
                        enrichment: result,
                    };
                }
            } catch (error) {
                console.log(`[StreamEnricher] Hook ${hookName} failed for ${candidate.name}`);
            }
        }

        // Return unverified if no hook succeeded
        console.log(`[StreamEnricher] ✗ ${candidate.name} not verified (${Date.now() - startTime}ms)`);
        return {
            ...candidate,
            verified: false,
        };
    }
}
