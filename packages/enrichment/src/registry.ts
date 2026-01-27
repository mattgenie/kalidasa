/**
 * Hook Registry
 * 
 * Manages registration and lookup of enrichment hooks.
 * Designed for maximal extensibility - adding a hook requires:
 * 1. Creating the hook file implementing EnrichmentHook
 * 2. Registering it here
 */

import type { EnrichmentHook, EnrichmentDomain } from '@kalidasa/types';

export class HookRegistry {
    private hooks: Map<string, EnrichmentHook> = new Map();

    /**
     * Register a new hook
     */
    register(hook: EnrichmentHook): void {
        this.hooks.set(hook.name, hook);
        console.log(`[HookRegistry] Registered: ${hook.name} for domains: ${hook.domains.join(', ')}`);
    }

    /**
     * Get all hooks for a specific domain, sorted by priority (highest first)
     */
    getHooksForDomain(domain: EnrichmentDomain): EnrichmentHook[] {
        return Array.from(this.hooks.values())
            .filter(h => h.domains.includes(domain))
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get a specific hook by name
     */
    get(name: string): EnrichmentHook | undefined {
        return this.hooks.get(name);
    }

    /**
     * Get all registered hooks
     */
    all(): EnrichmentHook[] {
        return Array.from(this.hooks.values());
    }

    /**
     * Get all hook names
     */
    names(): string[] {
        return Array.from(this.hooks.keys());
    }

    /**
     * Check if a hook is registered
     */
    has(name: string): boolean {
        return this.hooks.has(name);
    }

    /**
     * Run health checks on all hooks
     */
    async healthCheck(): Promise<Record<string, boolean>> {
        const results: Record<string, boolean> = {};

        for (const [name, hook] of this.hooks) {
            if (hook.healthCheck) {
                try {
                    results[name] = await hook.healthCheck();
                } catch {
                    results[name] = false;
                }
            } else {
                results[name] = true; // Assume healthy if no health check
            }
        }

        return results;
    }
}
