/**
 * Hook Registry
 * 
 * Manages registration and lookup of enrichment hooks.
 * Supports domain gating — when a primary hook for a domain fails persistently,
 * that domain is disabled and getHooksForDomain() returns [].
 */

import type { EnrichmentHook, EnrichmentDomain, HealthCheckResult } from '@kalidasa/types';

export class HookRegistry {
    private hooks: Map<string, EnrichmentHook> = new Map();
    private disabledDomains: Map<string, { reason: string; since: Date }> = new Map();

    /**
     * Register a new hook
     */
    register(hook: EnrichmentHook): void {
        this.hooks.set(hook.name, hook);
        console.log(`[HookRegistry] Registered: ${hook.name} for domains: ${hook.domains.join(', ')}`);
    }

    // ── Domain gating ──

    /**
     * Disable a domain. getHooksForDomain() will return [] for this domain.
     */
    disableDomain(domain: string, reason: string): void {
        if (!this.disabledDomains.has(domain)) {
            console.error(`🚫 [Registry] Domain "${domain}" DISABLED: ${reason}`);
        }
        this.disabledDomains.set(domain, { reason, since: new Date() });
    }

    /**
     * Re-enable a domain after recovery.
     */
    enableDomain(domain: string): void {
        if (this.disabledDomains.has(domain)) {
            const entry = this.disabledDomains.get(domain)!;
            const downtime = Math.round((Date.now() - entry.since.getTime()) / 1000);
            console.log(`✅ [Registry] Domain "${domain}" RE-ENABLED after ${downtime}s`);
            this.disabledDomains.delete(domain);
        }
    }

    /**
     * Check if a domain is currently available.
     */
    isDomainAvailable(domain: string): { available: boolean; reason?: string } {
        const entry = this.disabledDomains.get(domain);
        if (entry) return { available: false, reason: entry.reason };
        return { available: true };
    }

    /**
     * Get all disabled domains with reasons and timestamps.
     */
    getDisabledDomains(): Record<string, { reason: string; since: string }> {
        const result: Record<string, { reason: string; since: string }> = {};
        for (const [domain, entry] of this.disabledDomains) {
            result[domain] = { reason: entry.reason, since: entry.since.toISOString() };
        }
        return result;
    }

    // ── Hook lookup ──

    /**
     * Get all hooks for a specific domain, sorted by priority (highest first).
     * Returns [] if the domain is disabled.
     */
    getHooksForDomain(domain: EnrichmentDomain): EnrichmentHook[] {
        if (this.disabledDomains.has(domain)) return [];
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
     * Run health checks on all hooks — parallel with per-hook timeout.
     * Normalizes boolean | HealthCheckResult returns into HealthCheckResult.
     * @param timeoutMs - Max time per hook check (default: 5s)
     * @param skipHooks - Set of hook names to skip this cycle (e.g., hooks with custom intervals)
     */
    async healthCheck(timeoutMs = 5000, skipHooks?: Set<string>): Promise<Record<string, HealthCheckResult>> {
        const entries = Array.from(this.hooks.entries())
            .filter(([name]) => !skipHooks?.has(name));

        const settled = await Promise.allSettled(
            entries.map(async ([name, hook]) => {
                if (!hook.healthCheck) return { name, result: { healthy: true } as HealthCheckResult };
                try {
                    const raw = await Promise.race([
                        hook.healthCheck(),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`${name} health check timed out after ${timeoutMs}ms`)), timeoutMs)
                        ),
                    ]);
                    // Normalize: boolean → HealthCheckResult
                    const result: HealthCheckResult = typeof raw === 'boolean'
                        ? { healthy: raw }
                        : raw;
                    return { name, result };
                } catch (e) {
                    return {
                        name,
                        result: {
                            healthy: false,
                            error: { message: e instanceof Error ? e.message : 'Unknown error' },
                        } as HealthCheckResult,
                    };
                }
            })
        );

        const results: Record<string, HealthCheckResult> = {};
        for (const s of settled) {
            if (s.status === 'fulfilled') results[s.value.name] = s.value.result;
        }
        return results;
    }
}
