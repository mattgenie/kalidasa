/**
 * Source Discovery Pipeline
 *
 * Discovers new source domains from search results, evaluates them against an
 * 8-criterion quality rubric using Gemini Flash, and auto-promotes qualifying
 * sources into the registry.
 *
 * Pipeline:
 *   1. Record unknown domains as they appear in search results
 *   2. When a domain reaches 3+ sightings, queue for LLM evaluation
 *   3. Gemini Flash scores the source on 8 criteria
 *   4. Top-quartile sources (within their category) get auto-promoted
 *   5. Results persist to discovered-sources.json
 *
 * Categories for quartile scoring:
 *   - general: mainstream/national news
 *   - specialty: tech, science, finance, policy, etc.
 *   - regional: non-US/non-UK outlets, local papers
 *   - wire: news agencies (rare to discover)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GoogleGenerativeAI } from '@google/generative-ai';
import type { SourceEntry } from './news-search.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArticleSighting {
    title: string;
    snippet: string;
    url: string;
    date: string; // ISO date
}

interface CandidateDomain {
    domain: string;
    sightings: ArticleSighting[];
    firstSeen: string;
    lastSeen: string;
}

export interface LLMScoreResult {
    domain: string;
    scores: {
        impartiality: number;
        accuracy: number;
        depth: number;
        expertise: number;
        globalPerspective: number;
        clarity: number;
        transparency: number;
        timeliness: number;
    };
    averageScore: number;
    category: 'general' | 'specialty' | 'regional' | 'wire';
    suggestedTier: 1 | 2 | 3;
    region: string;
    paywall: 'free' | 'metered' | 'hard';
    specialty?: string;
    displayName: string;
    reasoning: string;
}

interface DiscoveryData {
    version: 1;
    /** Domains we've seen but haven't evaluated yet */
    candidates: Record<string, CandidateDomain>;
    /** Domains that have been evaluated (pass or fail) */
    evaluated: Record<string, {
        score: LLMScoreResult;
        promoted: boolean;
        evaluatedAt: string;
    }>;
    /** Category-level score distributions for dynamic quartile thresholds */
    categoryStats: Record<string, { scores: number[]; threshold: number }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SIGHTINGS = 3;           // Need 3 appearances before evaluating
const MAX_SIGHTINGS_STORED = 5;    // Keep at most 5 articles per domain
const MAX_EVALUATIONS_PER_RUN = 5; // Don't evaluate more than 5 domains at once

// ---------------------------------------------------------------------------
// Quality Rubric Prompt
// ---------------------------------------------------------------------------

const SCORING_PROMPT = `You are evaluating a news source for inclusion in a curated quality registry used to summarize world news.

Score this source on each criterion (1-10 scale):

1. **Impartiality & Independence** — Little to no political lean or agenda. Balanced coverage presenting multiple viewpoints fairly. Facts first, minimizing partisan tone.

2. **Accuracy & Fact-Checking** — Fact-driven, evidence-based reporting with rigorous verification. Precise details grounded in research. Transparent corrections.

3. **Depth & Context** — Goes beyond surface facts to provide analysis and context. Answers not just who/what/when but why it matters. Expert sources with diverse perspectives.

4. **Trusted Journalists & Expertise** — Experienced, recognized journalists. Specialized reporters for their beats. Authoritative and nuanced reporting.

5. **Global Perspective & Diversity** — Broad reach with correspondents covering multiple regions. Cultural and regional context. Not a myopic view.

6. **Clarity & Integrity (No Sensationalism)** — Factual, clear tone. No hyperbolic or emotionally charged language. Headlines focus on information, not clickbait. Clear separation of news and opinion.

7. **Transparency & Accountability** — Published standards and ethics. Bylines and author credentials. Corrections policy. Mission statement or editorial policy.

8. **Timeliness & Relevance** — Timely coverage of emerging events without sacrificing accuracy. Commentary tied to current affairs.

Source domain: {domain}
Sample articles from this source:
{articles}

Respond with ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "displayName": "Human-readable name of the outlet",
  "scores": {
    "impartiality": <1-10>,
    "accuracy": <1-10>,
    "depth": <1-10>,
    "expertise": <1-10>,
    "globalPerspective": <1-10>,
    "clarity": <1-10>,
    "transparency": <1-10>,
    "timeliness": <1-10>
  },
  "category": "<general|specialty|regional|wire>",
  "suggestedTier": <1|2|3>,
  "region": "<primary region, e.g. US, UK, EU, MENA, Asia, Global, Wire>",
  "paywall": "<free|metered|hard>",
  "specialty": "<null or specialty like tech, finance, science, defense, etc>",
  "reasoning": "<1-2 sentence justification>"
}`;

// ---------------------------------------------------------------------------
// SourceDiscovery
// ---------------------------------------------------------------------------

export class SourceDiscovery {
    private data: DiscoveryData;
    private filePath: string;
    private discoveredPath: string;
    private dirty = false;

    constructor(dataDir?: string) {
        const dir = dataDir || path.join(__dirname, '..', 'data');
        this.filePath = path.join(dir, 'source-discovery.json');
        this.discoveredPath = path.join(dir, 'discovered-sources.json');
        this.data = this.load();
    }

    // ---- Public API ----

    /**
     * Record an unknown domain sighting from search results.
     * Called by news-search.ts when lookupSource() returns undefined.
     */
    recordUnknown(domain: string, title: string, snippet: string, url: string): void {
        // Skip domains that have already been evaluated
        if (this.data.evaluated[domain]) return;

        if (!this.data.candidates[domain]) {
            this.data.candidates[domain] = {
                domain,
                sightings: [],
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            };
        }

        const candidate = this.data.candidates[domain];
        candidate.lastSeen = new Date().toISOString();

        // Don't store duplicate URLs
        if (candidate.sightings.some(s => s.url === url)) return;

        candidate.sightings.push({
            title: title.substring(0, 200),
            snippet: snippet.substring(0, 300),
            url,
            date: new Date().toISOString(),
        });

        // Cap stored sightings
        if (candidate.sightings.length > MAX_SIGHTINGS_STORED) {
            candidate.sightings = candidate.sightings.slice(-MAX_SIGHTINGS_STORED);
        }

        this.dirty = true;
    }

    /**
     * Run LLM evaluation on domains with ≥3 sightings.
     * Returns newly promoted sources. Non-blocking — call after search completes.
     */
    async evaluateCandidates(genAI: GoogleGenerativeAI, modelName: string): Promise<SourceEntry[]> {
        const ready = Object.values(this.data.candidates)
            .filter(c => c.sightings.length >= MIN_SIGHTINGS)
            .slice(0, MAX_EVALUATIONS_PER_RUN);

        if (ready.length === 0) return [];

        console.log(`[SourceDiscovery] Evaluating ${ready.length} candidate domains...`);
        const promoted: SourceEntry[] = [];

        for (const candidate of ready) {
            try {
                const score = await this.scoreDomain(genAI, modelName, candidate);
                if (!score) continue;

                // Update category stats
                this.updateCategoryStats(score.category, score.averageScore);

                // Check if it passes the top-quartile threshold
                const threshold = this.getCategoryThreshold(score.category);
                const passes = score.averageScore >= threshold;

                this.data.evaluated[candidate.domain] = {
                    score,
                    promoted: passes,
                    evaluatedAt: new Date().toISOString(),
                };

                // Remove from candidates
                delete this.data.candidates[candidate.domain];

                if (passes) {
                    const entry: SourceEntry = {
                        displayName: score.displayName,
                        tier: score.suggestedTier,
                        region: score.region,
                        paywall: score.paywall,
                        ...(score.specialty ? { specialty: score.specialty } : {}),
                    };
                    promoted.push(entry);
                    console.log(`[SourceDiscovery] ✅ Promoted ${candidate.domain}: ${score.displayName} (T${score.suggestedTier}, avg ${score.averageScore.toFixed(1)}, threshold ${threshold.toFixed(1)})`);
                } else {
                    console.log(`[SourceDiscovery] ❌ Rejected ${candidate.domain}: avg ${score.averageScore.toFixed(1)} < threshold ${threshold.toFixed(1)} for ${score.category}`);
                }
                this.dirty = true;
            } catch (err) {
                console.warn(`[SourceDiscovery] Error evaluating ${candidate.domain}:`, err);
            }
        }

        // Persist changes + write discovered sources file
        if (promoted.length > 0) {
            this.writeDiscoveredSources();
        }
        this.save();

        return promoted;
    }

    /**
     * Get the current set of discovered sources (for merging into SOURCE_REGISTRY).
     */
    getDiscoveredSources(): Record<string, SourceEntry> {
        try {
            if (fs.existsSync(this.discoveredPath)) {
                return JSON.parse(fs.readFileSync(this.discoveredPath, 'utf-8'));
            }
        } catch (err) {
            console.warn('[SourceDiscovery] Failed to load discovered sources:', err);
        }
        return {};
    }

    /** How many candidates are queued for evaluation */
    pendingCount(): number {
        return Object.values(this.data.candidates)
            .filter(c => c.sightings.length >= MIN_SIGHTINGS).length;
    }

    /** Persist to disk */
    save(): void {
        if (!this.dirty) return;
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
        } catch (err) {
            console.warn('[SourceDiscovery] Failed to save:', err);
        }
    }

    // ---- Internal ----

    private async scoreDomain(
        genAI: GoogleGenerativeAI,
        modelName: string,
        candidate: CandidateDomain
    ): Promise<LLMScoreResult | null> {
        const articlesText = candidate.sightings
            .map((s, i) => `${i + 1}. "${s.title}"\n   ${s.snippet}`)
            .join('\n\n');

        const prompt = SCORING_PROMPT
            .replace('{domain}', candidate.domain)
            .replace('{articles}', articlesText);

        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();

            // Strip markdown fences if present
            const jsonStr = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
            const parsed = JSON.parse(jsonStr);

            const scores = parsed.scores;
            const avg = Object.values(scores as Record<string, number>)
                .reduce((sum: number, v: number) => sum + v, 0) / 8;

            return {
                domain: candidate.domain,
                scores,
                averageScore: avg,
                category: parsed.category || 'general',
                suggestedTier: parsed.suggestedTier || 3,
                region: parsed.region || 'Unknown',
                paywall: parsed.paywall || 'free',
                specialty: parsed.specialty || undefined,
                displayName: parsed.displayName || candidate.domain,
                reasoning: parsed.reasoning || '',
            };
        } catch (err) {
            console.warn(`[SourceDiscovery] LLM scoring failed for ${candidate.domain}:`, err);
            return null;
        }
    }

    private updateCategoryStats(category: string, score: number): void {
        if (!this.data.categoryStats[category]) {
            this.data.categoryStats[category] = { scores: [], threshold: 5.0 };
        }
        const stats = this.data.categoryStats[category];
        stats.scores.push(score);

        // Recalculate top-quartile threshold (75th percentile)
        const sorted = [...stats.scores].sort((a, b) => a - b);
        const p75Index = Math.floor(sorted.length * 0.75);
        stats.threshold = sorted.length >= 4
            ? sorted[p75Index]
            : 5.0; // Default until we have enough data
    }

    private getCategoryThreshold(category: string): number {
        return this.data.categoryStats[category]?.threshold ?? 5.0;
    }

    private writeDiscoveredSources(): void {
        const sources: Record<string, SourceEntry> = {};

        for (const [domain, entry] of Object.entries(this.data.evaluated)) {
            if (!entry.promoted) continue;
            const s = entry.score;
            sources[domain] = {
                displayName: s.displayName,
                tier: s.suggestedTier,
                region: s.region,
                paywall: s.paywall,
                ...(s.specialty ? { specialty: s.specialty } : {}),
            };
        }

        try {
            const dir = path.dirname(this.discoveredPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.discoveredPath, JSON.stringify(sources, null, 2));
            console.log(`[SourceDiscovery] Wrote ${Object.keys(sources).length} discovered sources`);
        } catch (err) {
            console.warn('[SourceDiscovery] Failed to write discovered sources:', err);
        }
    }

    private load(): DiscoveryData {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
            }
        } catch (err) {
            console.warn('[SourceDiscovery] Failed to load, starting fresh:', err);
        }
        return {
            version: 1,
            candidates: {},
            evaluated: {},
            categoryStats: {},
        };
    }
}
