/**
 * Circuit Breaker Scenario Tests
 *
 * Comprehensive tests for the domain circuit breaker system.
 * Run: npx tsx packages/enrichment/src/__tests__/circuit-breaker.test.ts
 *
 * Tests exercise the actual HookRegistry and HookHealthMonitor classes
 * with mock hooks to verify all behavioral scenarios.
 */

import { HookRegistry } from '../registry.js';
import { HookHealthMonitor, parseRetryAfter } from '../health-monitor.js';
import type { EnrichmentHook, HealthCheckResult } from '@kalidasa/types';

// ── Test infrastructure ──

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
    if (condition) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        failures.push(message);
        console.error(`  ❌ FAIL: ${message}`);
    }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual === expected) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        failures.push(`${message} (expected=${expected}, actual=${actual})`);
        console.error(`  ❌ FAIL: ${message} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
    }
}

// ── Mock hook factory ──

function createMockHook(
    name: string,
    domains: string[],
    priority: number,
    healthCheckFn?: () => Promise<boolean | HealthCheckResult>
): EnrichmentHook {
    return {
        name,
        domains,
        priority,
        enrich: async () => null,
        healthCheck: healthCheckFn,
    };
}

// ── Wait helper ──
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ══════════════════════════════════════════════════════════════
// TEST SUITE 1: parseRetryAfter
// ══════════════════════════════════════════════════════════════

function testParseRetryAfter() {
    console.log('\n══ Suite 1: parseRetryAfter ══');

    // Integer seconds
    assertEqual(parseRetryAfter('60'), 60000, 'Parses "60" as 60000ms');
    assertEqual(parseRetryAfter('1'), 1000, 'Parses "1" as 1000ms');
    assertEqual(parseRetryAfter('3600'), 3600000, 'Parses "3600" as 1 hour');

    // Null/undefined/empty
    assertEqual(parseRetryAfter(null), undefined, 'Returns undefined for null');
    assertEqual(parseRetryAfter(undefined), undefined, 'Returns undefined for undefined');
    assertEqual(parseRetryAfter(''), undefined, 'Returns undefined for empty string');

    // Invalid values
    assertEqual(parseRetryAfter('abc'), undefined, 'Returns undefined for non-numeric non-date');
    assertEqual(parseRetryAfter('-5'), undefined, 'Returns undefined for negative seconds');
    assertEqual(parseRetryAfter('0'), undefined, 'Returns undefined for 0 seconds');

    // HTTP-date format (future date)
    const futureDate = new Date(Date.now() + 120000).toUTCString();
    const result = parseRetryAfter(futureDate);
    assert(result !== undefined && result > 100000 && result < 125000,
        `Parses future HTTP-date (~120s from now) = ${result}ms`);

    // HTTP-date in the past
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    assertEqual(parseRetryAfter(pastDate), undefined, 'Returns undefined for past HTTP-date');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 2: Registry Domain Gating
// ══════════════════════════════════════════════════════════════

function testRegistryDomainGating() {
    console.log('\n══ Suite 2: Registry Domain Gating ══');

    const registry = new HookRegistry();
    const placesHook = createMockHook('google_places', ['places'], 100, async () => true);
    const tmdbHook = createMockHook('tmdb', ['movies'], 100, async () => true);
    registry.register(placesHook);
    registry.register(tmdbHook);

    // Baseline: hooks available
    assertEqual(registry.getHooksForDomain('places').length, 1, 'Places domain has 1 hook');
    assertEqual(registry.getHooksForDomain('movies').length, 1, 'Movies domain has 1 hook');
    assert(registry.isDomainAvailable('places').available, 'Places domain is available');

    // Disable places
    registry.disableDomain('places', 'test: API down');
    assertEqual(registry.getHooksForDomain('places').length, 0, 'Disabled places → 0 hooks');
    assert(!registry.isDomainAvailable('places').available, 'Places domain is unavailable');
    assertEqual(registry.isDomainAvailable('places').reason, 'test: API down', 'Reason is preserved');

    // Movies unaffected
    assertEqual(registry.getHooksForDomain('movies').length, 1, 'Movies domain still has 1 hook');
    assert(registry.isDomainAvailable('movies').available, 'Movies domain still available');

    // Re-enable
    registry.enableDomain('places');
    assertEqual(registry.getHooksForDomain('places').length, 1, 'Re-enabled places → 1 hook');
    assert(registry.isDomainAvailable('places').available, 'Places domain available again');

    // Enable on already-enabled domain is no-op
    registry.enableDomain('places');
    assertEqual(registry.getHooksForDomain('places').length, 1, 'Double-enable is no-op');

    // Disable unknown domain doesn't crash
    registry.disableDomain('unknown_domain', 'test');
    assert(true, 'Disabling unknown domain does not throw');

    // getDisabledDomains — use fresh registry to avoid pollution from above
    const registry2 = new HookRegistry();
    registry2.register(createMockHook('p', ['places'], 1));
    registry2.register(createMockHook('m', ['movies'], 1));
    registry2.disableDomain('places', 'reason A');
    registry2.disableDomain('movies', 'reason B');
    const disabled = registry2.getDisabledDomains();
    assertEqual(Object.keys(disabled).length, 2, 'getDisabledDomains returns 2 entries');
    assert(disabled['places']?.reason === 'reason A', 'Disabled domains includes places with correct reason');
    assert(disabled['movies']?.reason === 'reason B', 'Disabled domains includes movies with correct reason');
    assert(!!disabled['places']?.since, 'Disabled domains includes timestamp');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 3: Registry healthCheck with skipHooks
// ══════════════════════════════════════════════════════════════

async function testRegistryHealthCheckSkip() {
    console.log('\n══ Suite 3: Registry healthCheck with skipHooks ══');

    let placesCheckCalled = false;
    let tmdbCheckCalled = false;

    const registry = new HookRegistry();
    registry.register(createMockHook('google_places', ['places'], 100,
        async () => { placesCheckCalled = true; return { healthy: true }; }));
    registry.register(createMockHook('tmdb', ['movies'], 100,
        async () => { tmdbCheckCalled = true; return { healthy: true }; }));

    // Tests all hooks checked when no skip set
    placesCheckCalled = false; tmdbCheckCalled = false;
    const results1 = await registry.healthCheck(5000);
    assert(placesCheckCalled, 'Places hook was checked (no skip set)');
    assert(tmdbCheckCalled, 'TMDB hook was checked (no skip set)');
    assertEqual(Object.keys(results1).length, 2, 'Results contain 2 hooks');

    // Skip places
    placesCheckCalled = false; tmdbCheckCalled = false;
    const results2 = await registry.healthCheck(5000, new Set(['google_places']));
    assert(!placesCheckCalled, 'Places hook was SKIPPED');
    assert(tmdbCheckCalled, 'TMDB hook was still checked');
    assertEqual(Object.keys(results2).length, 1, 'Results contain only 1 hook');
    assert(!('google_places' in results2), 'Results do not contain skipped hook');

    // Skip all
    placesCheckCalled = false; tmdbCheckCalled = false;
    const results3 = await registry.healthCheck(5000, new Set(['google_places', 'tmdb']));
    assert(!placesCheckCalled, 'Places skipped when all skipped');
    assert(!tmdbCheckCalled, 'TMDB skipped when all skipped');
    assertEqual(Object.keys(results3).length, 0, 'Results empty when all skipped');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 4: Registry healthCheck normalizes boolean → HealthCheckResult
// ══════════════════════════════════════════════════════════════

async function testRegistryNormalization() {
    console.log('\n══ Suite 4: healthCheck normalizes boolean → HealthCheckResult ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('bool_true', ['a'], 1, async () => true));
    registry.register(createMockHook('bool_false', ['b'], 1, async () => false));
    registry.register(createMockHook('result_obj', ['c'], 1,
        async () => ({ healthy: true })));
    registry.register(createMockHook('result_error', ['d'], 1,
        async () => ({ healthy: false, error: { httpStatus: 500, message: 'Server Error' } })));
    registry.register(createMockHook('no_healthcheck', ['e'], 1));

    const results = await registry.healthCheck(5000);

    // Boolean true → {healthy: true}
    assert(results['bool_true']?.healthy === true, 'boolean true → healthy');

    // Boolean false → {healthy: false}
    assert(results['bool_false']?.healthy === false, 'boolean false → unhealthy');

    // HealthCheckResult passes through
    assert(results['result_obj']?.healthy === true, 'HealthCheckResult object passes through');
    assert(results['result_error']?.healthy === false, 'HealthCheckResult error passes through');
    assertEqual(results['result_error']?.error?.httpStatus, 500, 'HTTP status preserved');

    // No healthCheck → {healthy: true}
    assert(results['no_healthcheck']?.healthy === true, 'No healthCheck → assumed healthy');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 5: Registry healthCheck timeout handling
// ══════════════════════════════════════════════════════════════

async function testRegistryTimeout() {
    console.log('\n══ Suite 5: healthCheck timeout ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('slow_hook', ['s'], 1,
        async () => { await wait(2000); return { healthy: true }; }));
    registry.register(createMockHook('fast_hook', ['f'], 1,
        async () => ({ healthy: true })));

    // Timeout at 500ms — slow hook should fail
    const results = await registry.healthCheck(500);
    assert(results['slow_hook']?.healthy === false, 'Slow hook (2s) times out at 500ms');
    assert(results['slow_hook']?.error?.message?.includes('timed out'), 'Timeout error message present');
    assert(results['fast_hook']?.healthy === true, 'Fast hook succeeds');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 6: Error Classification (the core logic)
// ══════════════════════════════════════════════════════════════

async function testErrorClassification() {
    console.log('\n══ Suite 6: Error Classification + 3-Strike Rule ══');

    // We'll observe classification through its effects:
    // - TRANSIENT (429 + retryAfter ≤5min): no domain disable
    // - PERSISTENT (5xx, 429 no retry, timeout): 3 consecutive → disable
    // - AUTH_FAILURE (401/403): immediate disable

    // Scenario A: 3 consecutive PERSISTENT failures → domain disabled
    {
        console.log('\n  ── Scenario A: 3 consecutive 500 errors ──');
        const registry = new HookRegistry();
        let failCount = 0;
        const hook = createMockHook('places_hook', ['places'], 100,
            async (): Promise<HealthCheckResult> => {
                failCount++;
                return { healthy: false, error: { httpStatus: 500, message: 'Internal Server Error' } };
            });
        registry.register(hook);

        const monitor = new HookHealthMonitor();
        monitor.start(registry, 999_999_999); // Very long interval — we'll tick manually

        // Wait for the initial check
        await wait(100);
        assert(registry.isDomainAvailable('places').available, 'After 1 failure: domain still available');

        // Manually trigger 2 more checks (need to access private method)
        // We'll use a trick: restart with very short interval
        monitor.stop();

        // Create a fresh monitor and manually simulate
        const monitor2 = new HookHealthMonitor();
        // Use start with short interval and wait
        monitor2.start(registry, 50);
        await wait(250); // Should get ~4-5 checks in 250ms
        monitor2.stop();

        assert(!registry.isDomainAvailable('places').available,
            `After ${failCount} consecutive 500s: domain disabled`);
        assert(registry.getHooksForDomain('places').length === 0,
            'getHooksForDomain returns empty for disabled domain');
    }

    // Scenario B: TRANSIENT 429 — domain stays enabled
    {
        console.log('\n  ── Scenario B: 429 with retryAfter=60s (transient) ──');
        const registry = new HookRegistry();
        let checkCount = 0;
        const hook = createMockHook('music_hook', ['music'], 100,
            async (): Promise<HealthCheckResult> => {
                checkCount++;
                return {
                    healthy: false,
                    error: { httpStatus: 429, message: 'Rate limited', retryAfterMs: 60_000 }
                };
            });
        registry.register(hook);

        const monitor = new HookHealthMonitor();
        monitor.start(registry, 50);
        await wait(350);
        monitor.stop();

        assert(checkCount >= 3, `At least 3 checks ran (actual: ${checkCount})`);
        assert(registry.isDomainAvailable('music').available,
            'Transient 429 (retryAfter=60s): domain remains available');
    }

    // Scenario C: 429 WITHOUT retryAfter → PERSISTENT → eventually disables
    {
        console.log('\n  ── Scenario C: 429 without retryAfter (persistent) ──');
        const registry = new HookRegistry();
        const hook = createMockHook('video_hook', ['videos'], 100,
            async (): Promise<HealthCheckResult> => ({
                healthy: false,
                error: { httpStatus: 429, message: 'Rate limited' } // no retryAfterMs
            }));
        registry.register(hook);

        const monitor = new HookHealthMonitor();
        monitor.start(registry, 50);
        await wait(350);
        monitor.stop();

        assert(!registry.isDomainAvailable('videos').available,
            '429 without retryAfter: domain eventually disabled');
    }

    // Scenario D: AUTH_FAILURE (401) → immediate disable
    {
        console.log('\n  ── Scenario D: 401 auth failure → immediate disable ──');
        const registry = new HookRegistry();
        const hook = createMockHook('auth_hook', ['auth_domain'], 100,
            async (): Promise<HealthCheckResult> => ({
                healthy: false,
                error: { httpStatus: 401, message: 'Invalid API key' }
            }));
        registry.register(hook);

        const monitor = new HookHealthMonitor();
        monitor.start(registry, 999_999_999);
        await wait(100); // Just the initial check
        monitor.stop();

        assert(!registry.isDomainAvailable('auth_domain').available,
            '401 auth failure: domain disabled immediately (1 check)');
    }

    // Scenario D2: 403 auth failure → immediate disable
    {
        console.log('\n  ── Scenario D2: 403 forbidden → immediate disable ──');
        const registry = new HookRegistry();
        const hook = createMockHook('forbidden_hook', ['forbidden_domain'], 100,
            async (): Promise<HealthCheckResult> => ({
                healthy: false,
                error: { httpStatus: 403, message: 'Forbidden' }
            }));
        registry.register(hook);

        const monitor = new HookHealthMonitor();
        monitor.start(registry, 999_999_999);
        await wait(100);
        monitor.stop();

        assert(!registry.isDomainAvailable('forbidden_domain').available,
            '403 forbidden: domain disabled immediately');
    }
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 7: Recovery (hook comes back → domain re-enabled)
// ══════════════════════════════════════════════════════════════

async function testRecovery() {
    console.log('\n══ Suite 7: Recovery ══');

    const registry = new HookRegistry();
    let isHealthy = false;

    const hook = createMockHook('places_hook', ['places'], 100,
        async (): Promise<HealthCheckResult> => {
            if (isHealthy) return { healthy: true };
            return { healthy: false, error: { httpStatus: 500, message: 'Down' } };
        });
    registry.register(hook);

    // Phase 1: Fail until disabled
    const monitor = new HookHealthMonitor();
    monitor.start(registry, 50);
    await wait(350);

    assert(!registry.isDomainAvailable('places').available, 'Phase 1: domain disabled after failures');

    // Phase 2: Recover
    isHealthy = true;
    await wait(200);
    monitor.stop();

    assert(registry.isDomainAvailable('places').available, 'Phase 2: domain re-enabled after recovery');
    assertEqual(registry.getHooksForDomain('places').length, 1, 'Hooks restored for recovered domain');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 8: Non-primary hook failure → domain NOT disabled
// ══════════════════════════════════════════════════════════════

async function testNonPrimaryHookFailure() {
    console.log('\n══ Suite 8: Non-primary hook failure ══');

    const registry = new HookRegistry();
    // Primary hook (higher priority)
    registry.register(createMockHook('primary_hook', ['events'], 95, async () => ({ healthy: true })));
    // Secondary hook (lower priority) — this one fails
    registry.register(createMockHook('secondary_hook', ['events'], 80,
        async (): Promise<HealthCheckResult> => ({
            healthy: false, error: { httpStatus: 500, message: 'Down' }
        })));

    const monitor = new HookHealthMonitor();
    monitor.start(registry, 50);
    await wait(350);
    monitor.stop();

    assert(registry.isDomainAvailable('events').available,
        'Secondary hook failure does NOT disable domain');
    assertEqual(registry.getHooksForDomain('events').length, 2,
        'Both hooks still returned for domain');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 9: Per-hook check interval (SerpAPI hourly)
// ══════════════════════════════════════════════════════════════

async function testPerHookInterval() {
    console.log('\n══ Suite 9: Per-hook check intervals ══');

    const registry = new HookRegistry();
    let serpCheckCount = 0;
    let placesCheckCount = 0;

    registry.register(createMockHook('serpapi_events', ['events'], 92,
        async () => { serpCheckCount++; return { healthy: true }; }));
    registry.register(createMockHook('google_places', ['places'], 100,
        async () => { placesCheckCount++; return { healthy: true }; }));

    const monitor = new HookHealthMonitor();
    // Set SerpAPI to hourly (we'll use 500ms for test purposes)
    monitor.setHookCheckInterval('serpapi_events', 500);
    monitor.start(registry, 60);
    await wait(350); // Should get ~5 checks in 350ms
    monitor.stop();

    assert(placesCheckCount >= 3, `Places checked frequently: ${placesCheckCount} times`);
    // SerpAPI should be checked only once (initial check), then skipped
    // because 350ms < 500ms interval
    assertEqual(serpCheckCount, 1, `SerpAPI checked only once due to 500ms interval`);
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 10: Mixed failure → recovery → second failure cycle
// ══════════════════════════════════════════════════════════════

async function testMultipleCycles() {
    console.log('\n══ Suite 10: Multiple failure-recovery cycles ══');

    const registry = new HookRegistry();
    let phase = 0;

    const hook = createMockHook('places_hook', ['places'], 100,
        async (): Promise<HealthCheckResult> => {
            if (phase === 0) return { healthy: false, error: { httpStatus: 500, message: 'Down 1' } };
            if (phase === 1) return { healthy: true };
            if (phase === 2) return { healthy: false, error: { httpStatus: 503, message: 'Down 2' } };
            return { healthy: true };
        });
    registry.register(hook);

    const monitor = new HookHealthMonitor();

    // Phase 0: Fail
    phase = 0;
    monitor.start(registry, 50);
    await wait(350);
    assert(!registry.isDomainAvailable('places').available, 'Cycle 1: domain disabled');

    // Phase 1: Recover
    phase = 1;
    await wait(150);
    assert(registry.isDomainAvailable('places').available, 'Cycle 1: domain recovered');

    // Phase 2: Fail again
    phase = 2;
    await wait(350);
    assert(!registry.isDomainAvailable('places').available, 'Cycle 2: domain disabled again');

    // Phase 3: Recover again
    phase = 3;
    await wait(150);
    monitor.stop();
    assert(registry.isDomainAvailable('places').available, 'Cycle 2: domain recovered again');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 11: Concurrent hook failures on different domains
// ══════════════════════════════════════════════════════════════

async function testConcurrentDomainFailures() {
    console.log('\n══ Suite 11: Concurrent domain failures ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('places_hook', ['places'], 100,
        async (): Promise<HealthCheckResult> => ({
            healthy: false, error: { httpStatus: 500, message: 'Down' }
        })));
    registry.register(createMockHook('tmdb_hook', ['movies'], 100,
        async (): Promise<HealthCheckResult> => ({
            healthy: false, error: { httpStatus: 502, message: 'Bad Gateway' }
        })));
    registry.register(createMockHook('wiki_hook', ['general'], 100,
        async () => ({ healthy: true })));

    const monitor = new HookHealthMonitor();
    monitor.start(registry, 50);
    await wait(350);
    monitor.stop();

    assert(!registry.isDomainAvailable('places').available, 'Places disabled');
    assert(!registry.isDomainAvailable('movies').available, 'Movies disabled');
    assert(registry.isDomainAvailable('general').available, 'General still available');

    const disabled = registry.getDisabledDomains();
    assertEqual(Object.keys(disabled).length, 2, '2 domains disabled');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 12: Hook exception handling
// ══════════════════════════════════════════════════════════════

async function testHookExceptions() {
    console.log('\n══ Suite 12: Hook exception handling ══');

    const registry = new HookRegistry();

    // Hook that throws
    registry.register(createMockHook('throwing_hook', ['throw_domain'], 100,
        async () => { throw new Error('Connection refused'); }));

    // Hook that rejects
    registry.register(createMockHook('rejecting_hook', ['reject_domain'], 100,
        async () => Promise.reject(new Error('DNS timeout'))));

    const results = await registry.healthCheck(5000);

    assert(results['throwing_hook']?.healthy === false, 'Throwing hook → unhealthy');
    assert(results['throwing_hook']?.error?.message?.includes('Connection refused'),
        'Exception message preserved');

    assert(results['rejecting_hook']?.healthy === false, 'Rejecting hook → unhealthy');
    assert(results['rejecting_hook']?.error?.message?.includes('DNS timeout'),
        'Rejection message preserved');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 13: getLastResults correctness
// ══════════════════════════════════════════════════════════════

async function testGetLastResults() {
    console.log('\n══ Suite 13: getLastResults ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('ok_hook', ['working'], 100, async () => ({ healthy: true })));

    const monitor = new HookHealthMonitor();

    // Before first check
    const before = monitor.getLastResults();
    assertEqual(before.checkedAt, null, 'Before first check: checkedAt is null');
    assert(!before.hasCriticalFailure, 'Before first check: no critical failure');

    // After a check
    monitor.registerExternalCheck('test_ext', async () => true, 'enhancement');
    monitor.start(registry, 999_999_999);
    await wait(200);
    monitor.stop();

    const after = monitor.getLastResults();
    assert(after.checkedAt !== null, 'After check: checkedAt is set');
    assert(after.hooks['ok_hook']?.healthy === true, 'Hook results cached');
    assertEqual(after.externals['test_ext'], true, 'External results cached');
    assert(!after.hasCriticalFailure, 'No critical failure');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 14: Core external failure → hasCriticalFailure
// ══════════════════════════════════════════════════════════════

async function testCoreExternalFailure() {
    console.log('\n══ Suite 14: Core external failure ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('ok_hook', ['a'], 1, async () => true));

    const monitor = new HookHealthMonitor();
    // Register a failing core external (bypass retries by having it always fail)
    monitor.registerExternalCheck('gemini', async () => false, 'core');

    monitor.start(registry, 999_999_999);
    await wait(12000); // Need to wait for retries (2 retries × 5s backoff = 10s)
    monitor.stop();

    const results = monitor.getLastResults();
    assert(results.hasCriticalFailure, 'Core external failure → hasCriticalFailure = true');
    assertEqual(results.externals['gemini'], false, 'Gemini reported as failed');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 15: Enhancement external failure → no critical
// ══════════════════════════════════════════════════════════════

async function testEnhancementExternalFailure() {
    console.log('\n══ Suite 15: Enhancement external failure ══');

    const registry = new HookRegistry();
    registry.register(createMockHook('ok_hook', ['a'], 1, async () => true));

    const monitor = new HookHealthMonitor();
    monitor.registerExternalCheck('geocoding', async () => false, 'enhancement');

    monitor.start(registry, 999_999_999);
    await wait(12000);
    monitor.stop();

    const results = monitor.getLastResults();
    assert(!results.hasCriticalFailure, 'Enhancement failure → hasCriticalFailure = false');
    assertEqual(results.externals['geocoding'], false, 'Geocoding reported as failed');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 16: Multi-domain hook (one hook serves multiple domains)
// ══════════════════════════════════════════════════════════════

async function testMultiDomainHook() {
    console.log('\n══ Suite 16: Multi-domain hook ══');

    const registry = new HookRegistry();
    // Hook that serves 2 domains and is primary for both
    registry.register(createMockHook('multi_hook', ['domain_a', 'domain_b'], 100,
        async (): Promise<HealthCheckResult> => ({
            healthy: false, error: { httpStatus: 500, message: 'Down' }
        })));

    const monitor = new HookHealthMonitor();
    monitor.start(registry, 50);
    await wait(350);
    monitor.stop();

    assert(!registry.isDomainAvailable('domain_a').available,
        'Domain A disabled when multi-domain hook fails');
    assert(!registry.isDomainAvailable('domain_b').available,
        'Domain B disabled when multi-domain hook fails');
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE 17: Edge case — boolean false health check
// ══════════════════════════════════════════════════════════════

async function testBooleanFalseClassification() {
    console.log('\n══ Suite 17: Boolean false health check (no error details) ══');

    const registry = new HookRegistry();
    // Hook that just returns boolean false — no HealthCheckResult structure
    registry.register(createMockHook('old_hook', ['legacy'], 100,
        async () => false));

    const monitor = new HookHealthMonitor();
    monitor.start(registry, 50);
    await wait(350);
    monitor.stop();

    // Boolean false → normalized to {healthy: false} → classifyError → no err → PERSISTENT
    // After 3 consecutive → domain disabled
    assert(!registry.isDomainAvailable('legacy').available,
        'Boolean false classified as PERSISTENT → domain disabled after 3 strikes');
}

// ══════════════════════════════════════════════════════════════
// RUNNER
// ══════════════════════════════════════════════════════════════

async function runAllTests() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Circuit Breaker Scenario Tests                  ║');
    console.log('╚══════════════════════════════════════════════════╝');

    // Synchronous tests
    testParseRetryAfter();
    testRegistryDomainGating();

    // Async tests
    await testRegistryHealthCheckSkip();
    await testRegistryNormalization();
    await testRegistryTimeout();
    await testErrorClassification();
    await testRecovery();
    await testNonPrimaryHookFailure();
    await testPerHookInterval();
    await testMultipleCycles();
    await testConcurrentDomainFailures();
    await testHookExceptions();
    await testGetLastResults();
    await testCoreExternalFailure();
    await testEnhancementExternalFailure();
    await testMultiDomainHook();
    await testBooleanFalseClassification();

    console.log('\n══════════════════════════════════════════════════');
    console.log(`Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

    if (failures.length > 0) {
        console.log('\nFailed tests:');
        failures.forEach(f => console.log(`  ❌ ${f}`));
    }

    console.log('══════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(2);
});
