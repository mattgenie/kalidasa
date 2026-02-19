/**
 * Hook Health Monitor
 *
 * Background heartbeat that checks enrichment API health every 5 minutes.
 * Implements domain-level circuit breaking:
 *
 * 1. Each check cycle runs healthCheck() on all hooks + registered externals
 * 2. Failed checks return HealthCheckResult with error classification
 * 3. Errors are classified: TRANSIENT (skip), PERSISTENT (count), AUTH (immediate disable)
 * 4. After 3 consecutive persistent failures, the hook's primary domain is disabled
 * 5. On recovery (successful check), the counter resets and domain re-enables
 *
 * Core vs Enhancement:
 * - "core" external (Gemini) → hasCriticalFailure → /health returns 503
 * - All hooks → domain-level gating via registry.disableDomain()
 * - "enhancement" externals → log and report, no domain gating
 */

import type { HookRegistry } from './registry.js';
import type { HealthCheckResult } from '@kalidasa/types';

export type DependencyClass = 'core' | 'enhancement';

interface ExternalCheck {
    fn: () => Promise<boolean | HealthCheckResult>;
    classification: DependencyClass;
}

type ErrorClassification = 'TRANSIENT' | 'PERSISTENT' | 'AUTH_FAILURE';

// ── Retry-After parsing ──

/**
 * Parse the Retry-After header value into milliseconds.
 * Handles both seconds (integer) and HTTP-date formats.
 * Returns undefined if unparseable.
 */
function parseRetryAfter(header: string | null | undefined): number | undefined {
    if (!header) return undefined;
    // Try as integer seconds
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    // Try as HTTP-date
    const date = new Date(header);
    if (!isNaN(date.getTime())) {
        const ms = date.getTime() - Date.now();
        return ms > 0 ? ms : undefined;
    }
    return undefined;
}

// ── Error classification ──

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Classify an error from a health check result.
 *
 * | Signal                  | Classification |
 * |-------------------------|---------------|
 * | 429 + retry ≤ 5 min     | TRANSIENT     |
 * | 429 + retry > 1 hour    | PERSISTENT    |
 * | 429 + no retry-after    | PERSISTENT    |
 * | 401 / 403               | AUTH_FAILURE  |
 * | 500 / 502 / 503         | PERSISTENT    |
 * | Connection fail/timeout | PERSISTENT    |
 * | Boolean false (no info) | PERSISTENT    |
 */
function classifyError(result: HealthCheckResult): ErrorClassification {
    const err = result.error;
    if (!err) return 'PERSISTENT'; // boolean false with no details

    const status = err.httpStatus;

    // Auth failures → immediate domain disable
    if (status === 401 || status === 403) return 'AUTH_FAILURE';

    // Rate limits → check retry-after
    if (status === 429) {
        const retryMs = err.retryAfterMs;
        if (retryMs && retryMs <= FIVE_MINUTES_MS) return 'TRANSIENT';
        // No retry-after, or retry > 1 hour → persistent
        return 'PERSISTENT';
    }

    // Server errors → persistent
    return 'PERSISTENT';
}

// ── Constants ──

const MAX_CONSECUTIVE_FAILURES = 3;

export { parseRetryAfter };

export class HookHealthMonitor {
    private registry: HookRegistry | null = null;
    private intervalId: NodeJS.Timeout | null = null;
    private externalChecks: Map<string, ExternalCheck> = new Map();

    // ── Cached results — read by /health endpoint ──
    private lastHookResults: Record<string, HealthCheckResult> = {};
    private lastExternalResults: Record<string, boolean> = {};
    private lastCheckTime: Date | null = null;

    // ── Consecutive failure tracking ──
    private consecutiveFailures: Map<string, number> = new Map();

    // ── Per-hook check interval overrides ──
    // Hooks not in this map use the default cycle interval.
    // Value is interval in ms (e.g., 3_600_000 for hourly).
    private hookCheckIntervals: Map<string, number> = new Map();
    private lastHookCheckTime: Map<string, number> = new Map();

    /**
     * Start background health checks.
     * @param registry - The hook registry to check
     * @param intervalMs - Check interval (default: 5 minutes)
     */
    start(registry: HookRegistry, intervalMs = 300_000): void {
        this.registry = registry;
        this.intervalId = setInterval(() => this.check(), intervalMs);
        // Immediate first check
        this.check();
    }

    /**
     * Set a custom check interval for a specific hook.
     * Hooks with custom intervals are skipped in cycles where they were
     * checked more recently than their interval.
     * @param hookName - Name of the hook (e.g., "serpapi_events")
     * @param intervalMs - Check interval in ms (e.g., 3_600_000 for hourly)
     */
    setHookCheckInterval(hookName: string, intervalMs: number): void {
        this.hookCheckIntervals.set(hookName, intervalMs);
        console.log(`[HealthMonitor] Custom interval for ${hookName}: ${Math.round(intervalMs / 60000)}min`);
    }

    /**
     * Register a non-hook external dependency check.
     * @param name - Human-readable name (e.g., "gemini", "google_geocoding")
     * @param checkFn - Async function that returns true/false or HealthCheckResult
     * @param classification - "core" (503 on failure) or "enhancement" (degrade gracefully)
     */
    registerExternalCheck(
        name: string,
        checkFn: () => Promise<boolean | HealthCheckResult>,
        classification: DependencyClass = 'enhancement'
    ): void {
        this.externalChecks.set(name, { fn: checkFn, classification });
    }

    /**
     * Get cached results from the last health check cycle.
     * Returns empty results with null checkedAt before the first cycle completes.
     */
    getLastResults(): {
        hooks: Record<string, HealthCheckResult>;
        externals: Record<string, boolean>;
        checkedAt: string | null;
        hasCriticalFailure: boolean;
    } {
        // Check if any CORE external failed
        const hasCriticalFailure = Array.from(this.externalChecks.entries())
            .some(([name, check]) =>
                check.classification === 'core' && this.lastExternalResults[name] === false
            );

        return {
            hooks: { ...this.lastHookResults },
            externals: { ...this.lastExternalResults },
            checkedAt: this.lastCheckTime?.toISOString() ?? null,
            hasCriticalFailure,
        };
    }

    /**
     * Retry a single check with backoff.
     * @returns HealthCheckResult from last attempt (success or final failure)
     */
    private async retryExternalCheck(
        name: string,
        checkFn: () => Promise<boolean | HealthCheckResult>,
        maxRetries = 2,
        backoffMs = 5000
    ): Promise<boolean> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`[HealthMonitor] ⏳ Retrying ${name} (attempt ${attempt}/${maxRetries}) in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            try {
                const raw = await checkFn();
                const ok = typeof raw === 'boolean' ? raw : raw.healthy;
                if (ok) {
                    console.log(`[HealthMonitor] ✅ ${name} recovered on retry ${attempt}`);
                    return true;
                }
            } catch {
                // Continue to next retry
            }
        }
        return false;
    }

    /**
     * Record a hook failure, classify it, and potentially disable the domain.
     */
    private handleHookFailure(hookName: string, result: HealthCheckResult): void {
        const classification = classifyError(result);

        if (classification === 'TRANSIENT') {
            const retryMs = result.error?.retryAfterMs;
            console.log(
                `[HealthMonitor] ⏳ ${hookName}: transient error (429, retry in ${retryMs ? Math.round(retryMs / 1000) + 's' : '?'}). Not counting.`
            );
            return; // Don't count transient failures
        }

        if (classification === 'AUTH_FAILURE') {
            console.error(`[HealthMonitor] 🔑 ${hookName}: auth failure (${result.error?.httpStatus}). Disabling domain immediately.`);
            this.consecutiveFailures.set(hookName, MAX_CONSECUTIVE_FAILURES); // So recovery shows "recovered from N failures"
            this.disableDomainsForHook(hookName, `Auth failure: ${result.error?.message || result.error?.httpStatus}`);
            return;
        }

        // PERSISTENT: increment counter
        const count = (this.consecutiveFailures.get(hookName) || 0) + 1;
        this.consecutiveFailures.set(hookName, count);

        if (count >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`[HealthMonitor] 🚨 ${hookName}: ${count} consecutive failures. Disabling domain.`);
            this.disableDomainsForHook(hookName, `${count} consecutive failures: ${result.error?.message || 'unreachable'}`);
        } else {
            console.warn(`[HealthMonitor] ⚠️ ${hookName}: failure ${count}/${MAX_CONSECUTIVE_FAILURES}`);
        }
    }

    /**
     * Reset failure counter and re-enable domains when a hook recovers.
     */
    private handleHookRecovery(hookName: string): void {
        const hadFailures = this.consecutiveFailures.get(hookName);
        if (hadFailures && hadFailures > 0) {
            console.log(`[HealthMonitor] 💚 ${hookName} recovered (was at ${hadFailures} consecutive failures)`);
        }
        this.consecutiveFailures.set(hookName, 0);

        // Re-enable any domains that this hook serves
        if (!this.registry) return;
        const hook = this.registry.get(hookName);
        if (hook) {
            for (const domain of hook.domains) {
                this.registry.enableDomain(domain);
            }
        }
    }

    /**
     * Disable all domains that a hook is the primary provider for.
     * "Primary" = highest priority hook for that domain.
     */
    private disableDomainsForHook(hookName: string, reason: string): void {
        if (!this.registry) return;
        const hook = this.registry.get(hookName);
        if (!hook) return;

        for (const domain of hook.domains) {
            // Check if this hook is the primary (highest priority) for this domain
            // Use all() to bypass the domain gate (which may already be disabled)
            const allHooks = Array.from(this.registry.all())
                .filter(h => h.domains.includes(domain))
                .sort((a, b) => b.priority - a.priority);

            if (allHooks.length > 0 && allHooks[0].name === hookName) {
                this.registry.disableDomain(domain, `${hookName}: ${reason}`);
            }
        }
    }

    /**
     * Run health checks on all registered hooks AND external dependencies.
     * Classifies errors and applies domain gating.
     */
    private async check(): Promise<void> {
        if (!this.registry) return;

        try {
            // ── Build skip set for hooks with custom intervals ──
            const now = Date.now();
            const skipHooks = new Set<string>();
            for (const [hookName, intervalMs] of this.hookCheckIntervals) {
                const lastCheck = this.lastHookCheckTime.get(hookName);
                if (lastCheck && (now - lastCheck) < intervalMs) {
                    skipHooks.add(hookName);
                }
            }

            // ── Check hooks (parallel with timeout, skipping throttled ones) ──
            const hookResults = await this.registry.healthCheck(5000, skipHooks.size > 0 ? skipHooks : undefined);

            // Record check times for hooks that were actually checked
            for (const hookName of Object.keys(hookResults)) {
                this.lastHookCheckTime.set(hookName, now);
            }

            // Process hook results: classify, count, gate
            for (const [name, result] of Object.entries(hookResults)) {
                if (result.healthy) {
                    this.handleHookRecovery(name);
                } else {
                    this.handleHookFailure(name, result);
                }
            }

            // ── Check all external dependencies in parallel ──
            const externalEntries = Array.from(this.externalChecks.entries());
            const externalSettled = await Promise.allSettled(
                externalEntries.map(async ([name, { fn }]) => {
                    try {
                        const raw = await fn();
                        const ok = typeof raw === 'boolean' ? raw : raw.healthy;
                        return { name, ok };
                    } catch {
                        return { name, ok: false };
                    }
                })
            );

            // Identify initial failures, retry externals before giving up
            const externalResults: Record<string, boolean> = {};
            const failedExternals: Array<{ name: string; fn: () => Promise<boolean | HealthCheckResult> }> = [];

            for (const settled of externalSettled) {
                if (settled.status === 'fulfilled') {
                    if (settled.value.ok) {
                        externalResults[settled.value.name] = true;
                    } else {
                        const check = this.externalChecks.get(settled.value.name);
                        if (check) failedExternals.push({ name: settled.value.name, fn: check.fn });
                    }
                } else {
                    externalResults['unknown_external'] = false;
                }
            }

            // Retry failed externals
            for (const { name, fn } of failedExternals) {
                externalResults[name] = await this.retryExternalCheck(name, fn);
            }

            // ── Cache results atomically ──
            this.lastHookResults = hookResults;
            this.lastExternalResults = externalResults;
            this.lastCheckTime = new Date();

            // ── Log summary ──
            const hookEntries = Object.entries(hookResults);
            const hookFailures = hookEntries.filter(([, r]) => !r.healthy);
            const extFailures = Object.entries(externalResults).filter(([, ok]) => !ok);
            const disabledDomains = this.registry.getDisabledDomains();

            const coreFailures = extFailures.filter(([name]) => {
                const check = this.externalChecks.get(name);
                return check?.classification === 'core';
            });

            if (coreFailures.length > 0) {
                console.error('🚨🚨🚨 CRITICAL: Core dependency failures (service will return 503) 🚨🚨🚨');
                for (const [name] of coreFailures) {
                    console.error(`  ❌ [CORE] ${name} UNREACHABLE after retries`);
                }
                console.error('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨');
            }

            if (hookFailures.length > 0) {
                console.warn(`[HealthMonitor] ⚠️ ${hookFailures.length} hook(s) failing:`);
                for (const [name, r] of hookFailures) {
                    const count = this.consecutiveFailures.get(name) || 0;
                    console.warn(`  ⚠️ ${name}: ${r.error?.message || 'unhealthy'} (${count}/${MAX_CONSECUTIVE_FAILURES})`);
                }
            }

            const disabledCount = Object.keys(disabledDomains).length;
            if (disabledCount > 0) {
                console.warn(`[HealthMonitor] 🚫 ${disabledCount} domain(s) disabled: ${Object.keys(disabledDomains).join(', ')}`);
            }

            if (hookFailures.length === 0 && extFailures.length === 0 && disabledCount === 0) {
                console.log(
                    `[HealthMonitor] ✓ ${hookEntries.length + externalEntries.length} dependencies healthy` +
                    ` (${hookEntries.length} hooks, ${externalEntries.length} external)`
                );
            }
        } catch (error) {
            console.error('[HealthMonitor] Check failed:', error);
        }
    }

    /**
     * Stop background health checks.
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
