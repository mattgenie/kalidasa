/**
 * Source Performance Tracker
 *
 * Tracks per-domain outcomes (Diffbot extraction, Exa quality) over a rolling
 * window and makes evidence-based blocking/demotion decisions.
 *
 * Blocking rules (applied to last WINDOW_SIZE outcomes):
 *   - successRate < 10% after ≥5 attempts  → blocked (skip entirely)
 *   - successRate < 30% after ≥5 attempts  → probation (deprioritise, de-rank)
 *   - successRate ≥ 30% OR < 5 attempts    → active
 *
 * Monthly maintenance: 20% of blocked domains get a 3-attempt trial.
 * If 2/3 succeed, promoted back to active; else re-blocked.
 *
 * Persists to source-tracker.json alongside the module.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome = 'success' | 'paywall' | 'timeout' | 'no-text' | 'junk';

export type DomainStatus = 'active' | 'probation' | 'blocked';

export interface SourcePerformance {
    domain: string;
    /** Ring buffer of last WINDOW_SIZE outcomes */
    outcomes: Outcome[];
    totalAttempts: number;
    totalSuccesses: number;
    lastAttempt: string;        // ISO date
    lastSuccess: string | null; // ISO date
    /** When the domain entered blocked state (null if never) */
    blockedSince: string | null;
    /** If in a trial, how many attempts remain */
    trialRemaining: number | null;
}

interface TrackerData {
    version: 1;
    lastMaintenance: string; // ISO date of last monthly maintenance run
    domains: Record<string, SourcePerformance>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_SIZE = 10;
const MIN_ATTEMPTS_FOR_DECISION = 5;
const BLOCK_THRESHOLD = 0.10;     // < 10% success → blocked
const PROBATION_THRESHOLD = 0.30; // < 30% success → probation
const MONTHLY_RETRY_FRACTION = 0.20; // 20% of blocked domains per month
const TRIAL_ATTEMPTS = 3;
const TRIAL_SUCCESS_REQUIRED = 2;

/** Known-bad domains pre-loaded with enough failures to start as blocked */
const SEED_BLOCKED: { domain: string; reason: Outcome }[] = [
    // Hard paywalls
    { domain: 'nytimes.com', reason: 'paywall' },
    { domain: 'ft.com', reason: 'paywall' },
    { domain: 'wsj.com', reason: 'paywall' },
    { domain: 'economist.com', reason: 'paywall' },
    { domain: 'bloomberg.com', reason: 'paywall' },
    { domain: 'theatlantic.com', reason: 'paywall' },
    { domain: 'newyorker.com', reason: 'paywall' },
    { domain: 'washingtonpost.com', reason: 'paywall' },
    { domain: 'theinformation.com', reason: 'paywall' },
    { domain: 'thetimes.co.uk', reason: 'paywall' },
    // Anti-bot / consistent timeout
    { domain: 'foxnews.com', reason: 'timeout' },
    { domain: 'si.com', reason: 'timeout' },
    // Empty extraction
    { domain: 'arstechnica.com', reason: 'no-text' },
    { domain: 'politico.com', reason: 'no-text' },
];

// ---------------------------------------------------------------------------
// SourceTracker
// ---------------------------------------------------------------------------

export class SourceTracker {
    private data: TrackerData;
    private filePath: string;
    private dirty = false;

    constructor(dataDir?: string) {
        const dir = dataDir || path.join(__dirname, '..', 'data');
        this.filePath = path.join(dir, 'source-tracker.json');
        this.data = this.load(dir);
    }

    // ---- Public API ----

    /** Record an outcome for a domain */
    record(domain: string, outcome: Outcome): void {
        const perf = this.getOrCreate(domain);
        // Push onto ring buffer
        perf.outcomes.push(outcome);
        if (perf.outcomes.length > WINDOW_SIZE) {
            perf.outcomes.shift();
        }
        perf.totalAttempts++;
        if (outcome === 'success') {
            perf.totalSuccesses++;
            perf.lastSuccess = new Date().toISOString();
        }
        perf.lastAttempt = new Date().toISOString();

        // If domain is in trial, decrement
        if (perf.trialRemaining !== null) {
            perf.trialRemaining--;
            if (perf.trialRemaining <= 0) {
                this.evaluateTrial(perf);
            }
        }

        // Update blocked status
        this.updateStatus(perf);
        this.dirty = true;
    }

    /** Should this domain be skipped entirely? */
    shouldSkip(domain: string): boolean {
        return this.getStatus(domain) === 'blocked';
    }

    /** Get the current status of a domain */
    getStatus(domain: string): DomainStatus {
        const perf = this.data.domains[domain];
        if (!perf) return 'active';
        return this.computeStatus(perf);
    }

    /** Score penalty: 0 for active, -1 for probation, -5 for blocked */
    scorePenalty(domain: string): number {
        const status = this.getStatus(domain);
        if (status === 'probation') return -1;
        if (status === 'blocked') return -5;
        return 0;
    }

    /** Get all blocked domains (for logging) */
    getBlockedDomains(): string[] {
        return Object.values(this.data.domains)
            .filter(p => this.computeStatus(p) === 'blocked')
            .map(p => p.domain);
    }

    /** Get summary stats for logging */
    getSummary(): { active: number; probation: number; blocked: number; total: number } {
        const all = Object.values(this.data.domains);
        return {
            active: all.filter(p => this.computeStatus(p) === 'active').length,
            probation: all.filter(p => this.computeStatus(p) === 'probation').length,
            blocked: all.filter(p => this.computeStatus(p) === 'blocked').length,
            total: all.length,
        };
    }

    /** Monthly maintenance: promote 20% of blocked domains to trial */
    runMaintenance(): void {
        const now = new Date();
        const lastRun = new Date(this.data.lastMaintenance);
        const daysSinceLast = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceLast < 28) return; // Not yet time

        const blocked = Object.values(this.data.domains)
            .filter(p => this.computeStatus(p) === 'blocked' && p.trialRemaining === null);

        const toRetry = Math.max(1, Math.ceil(blocked.length * MONTHLY_RETRY_FRACTION));

        // Prioritize domains that have been blocked longest
        blocked.sort((a, b) => {
            const aDate = a.blockedSince ? new Date(a.blockedSince).getTime() : 0;
            const bDate = b.blockedSince ? new Date(b.blockedSince).getTime() : 0;
            return aDate - bDate;
        });

        for (let i = 0; i < Math.min(toRetry, blocked.length); i++) {
            const perf = blocked[i];
            perf.trialRemaining = TRIAL_ATTEMPTS;
            // Clear recent failures to give it a fair shot
            perf.outcomes = [];
            console.log(`[SourceTracker] Promoting ${perf.domain} to trial (${TRIAL_ATTEMPTS} attempts)`);
        }

        this.data.lastMaintenance = now.toISOString();
        this.dirty = true;
        this.save();
    }

    /** Persist ledger to disk */
    save(): void {
        if (!this.dirty) return;
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
        } catch (err) {
            console.warn('[SourceTracker] Failed to save:', err);
        }
    }

    // ---- Internal ----

    private load(dir: string): TrackerData {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as TrackerData;
                return raw;
            }
        } catch (err) {
            console.warn('[SourceTracker] Failed to load, starting fresh:', err);
        }

        // Fresh ledger with seed data
        const data: TrackerData = {
            version: 1,
            lastMaintenance: new Date().toISOString(),
            domains: {},
        };

        // Pre-load seed blocked domains
        for (const seed of SEED_BLOCKED) {
            data.domains[seed.domain] = {
                domain: seed.domain,
                outcomes: Array(MIN_ATTEMPTS_FOR_DECISION).fill(seed.reason),
                totalAttempts: MIN_ATTEMPTS_FOR_DECISION,
                totalSuccesses: 0,
                lastAttempt: new Date().toISOString(),
                lastSuccess: null,
                blockedSince: new Date().toISOString(),
                trialRemaining: null,
            };
        }

        return data;
    }

    private getOrCreate(domain: string): SourcePerformance {
        if (!this.data.domains[domain]) {
            this.data.domains[domain] = {
                domain,
                outcomes: [],
                totalAttempts: 0,
                totalSuccesses: 0,
                lastAttempt: new Date().toISOString(),
                lastSuccess: null,
                blockedSince: null,
                trialRemaining: null,
            };
        }
        return this.data.domains[domain];
    }

    private computeStatus(perf: SourcePerformance): DomainStatus {
        if (perf.outcomes.length < MIN_ATTEMPTS_FOR_DECISION) return 'active';
        const rate = this.windowSuccessRate(perf);
        if (rate < BLOCK_THRESHOLD) return 'blocked';
        if (rate < PROBATION_THRESHOLD) return 'probation';
        return 'active';
    }

    private windowSuccessRate(perf: SourcePerformance): number {
        if (perf.outcomes.length === 0) return 1;
        const successes = perf.outcomes.filter(o => o === 'success').length;
        return successes / perf.outcomes.length;
    }

    private updateStatus(perf: SourcePerformance): void {
        const status = this.computeStatus(perf);
        if (status === 'blocked' && !perf.blockedSince) {
            perf.blockedSince = new Date().toISOString();
            console.log(`[SourceTracker] Blocked ${perf.domain} (success rate: ${(this.windowSuccessRate(perf) * 100).toFixed(0)}%)`);
        } else if (status === 'probation') {
            console.log(`[SourceTracker] Probation ${perf.domain} (success rate: ${(this.windowSuccessRate(perf) * 100).toFixed(0)}%)`);
        } else if (status === 'active' && perf.blockedSince) {
            perf.blockedSince = null;
            console.log(`[SourceTracker] Unblocked ${perf.domain}`);
        }
    }

    private evaluateTrial(perf: SourcePerformance): void {
        const recentSuccesses = perf.outcomes
            .slice(-TRIAL_ATTEMPTS)
            .filter(o => o === 'success').length;

        perf.trialRemaining = null;

        if (recentSuccesses >= TRIAL_SUCCESS_REQUIRED) {
            perf.blockedSince = null;
            console.log(`[SourceTracker] Trial passed for ${perf.domain} (${recentSuccesses}/${TRIAL_ATTEMPTS} successes)`);
        } else {
            perf.blockedSince = new Date().toISOString();
            console.log(`[SourceTracker] Trial failed for ${perf.domain} (${recentSuccesses}/${TRIAL_ATTEMPTS} successes), re-blocked`);
        }
    }
}
