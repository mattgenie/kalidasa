#!/usr/bin/env npx tsx
/**
 * Quality Spot Test — Manual Review Harness
 *
 * Fires the 3 original iOS test scenarios at the Kalidasa API
 * and dumps raw results for human/AI review. No LLM judge.
 *
 * Usage:
 *   npx tsx scripts/quality-spot-test.ts                    # hits App Runner
 *   KALIDASA_API=http://localhost:3200 npx tsx scripts/quality-spot-test.ts  # hits local
 *
 * The output is structured for fast eyeball grading:
 *   - Each scenario prints all results with summary + forUser
 *   - Flags hallucination red flags automatically
 *   - Saves full JSON for later diffing
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency)
try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2];
        }
    }
} catch { /* .env not found */ }

const API_BASE = process.env.KALIDASA_API || 'https://ykx3sxknem.us-east-1.awsapprunner.com';

// ============================================================================
// Test Scenarios — exact iOS test cases from quality audit
// ============================================================================

interface TestScenario {
    name: string;
    query: string;
    domain: string;
    capsule: any;
    location?: string;
    /** For refinement tests, the previous search context */
    conversation?: {
        previousSearches: string[];
        recentMessages: { speaker: string; content: string }[];
    };
    /** What we're checking for */
    checkFor: string[];
}

// The user's actual capsule (sparse preferences — anime watcher, minimal profile)
const SPARSE_ANIME_CAPSULE = {
    mode: 'solo' as const,
    members: [{
        id: 'test-user',
        name: 'Matt',
        preferences: {
            movies: {
                favoriteGenres: ['anime', 'studio ghibli'],
            },
        },
    }],
};

// A richer capsule for testing personalization accuracy
const RICH_CAPSULE = {
    mode: 'solo' as const,
    members: [{
        id: 'test-user-2',
        name: 'Jordan',
        preferences: {
            places: {
                favoriteCuisines: ['Thai', 'Ethiopian', 'Peruvian'],
                priceRange: { min: 2, max: 3 },
                vibePreferences: ['intimate', 'lively', 'authentic'],
            },
            movies: {
                favoriteGenres: ['documentary', 'indie', 'foreign'],
                dislikedGenres: ['action', 'superhero'],
            },
            music: {
                favoriteGenres: ['jazz', 'world', 'experimental'],
            },
        },
    }],
};

// Empty capsule — should trigger insider mode, never reference preferences
const EMPTY_CAPSULE = {
    mode: 'solo' as const,
    members: [{
        id: 'test-user-3',
        name: 'Alex',
        preferences: {},
    }],
};

const SCENARIOS: TestScenario[] = [
    // === SCENARIO 1: Initial anime search with sparse profile ===
    {
        name: '🎌 Scenario 1: Anime search (sparse profile)',
        query: 'best anime series to watch',
        domain: 'movies',
        capsule: SPARSE_ANIME_CAPSULE,
        checkFor: [
            'NO hallucinated preferences (Death Note, Radiohead, etc.)',
            'Substantive summaries (not "Recommended for Matt")',
            'Each result should be an actual anime',
            'ForUser should only reference "anime" and "studio ghibli" from preferences',
        ],
    },

    // === SCENARIO 2: Miyazaki refinement ===
    {
        name: '🌿 Scenario 2: Miyazaki-esque refinement',
        query: 'anime series similar to Miyazaki — nature themes, gentle pacing, beautiful animation',
        domain: 'movies',
        capsule: SPARSE_ANIME_CAPSULE,
        conversation: {
            previousSearches: ['best anime series to watch'],
            recentMessages: [
                { speaker: 'user', content: 'I want something more Miyazaki-esque', isAgent: false },
            ],
        },
        checkFor: [
            'Strong Miyazaki alignment (nature, gentle pacing, beautiful animation)',
            'NOT generic anime that happens to be popular',
            'ForUser notes should explain WHY it matches Miyazaki aesthetic',
            'No repetitive "Miyazaki" mentions across all results',
        ],
    },

    // === SCENARIO 3: Rich profile — test forUser accuracy ===
    {
        name: '🍿 Scenario 3: Movie search (rich profile)',
        query: 'best documentaries about music',
        domain: 'movies',
        capsule: RICH_CAPSULE,
        checkFor: [
            'ForUser ONLY references: documentary, indie, foreign, jazz, world, experimental',
            'NO invented preferences (no Radiohead, no specific bands not in profile)',
            'Summaries describe what each doc is ABOUT',
            'ForUser connects to actual profile preferences',
        ],
    },

    // === SCENARIO 4: Empty profile — should be insider mode ===
    {
        name: '🔎 Scenario 4: Restaurant search (empty profile)',
        query: 'best Italian restaurants in SoHo',
        domain: 'places',
        capsule: EMPTY_CAPSULE,
        location: 'New York',
        checkFor: [
            'NO "right up your alley" or "your taste"',
            'NO invented preferences — user has NO preference data',
            'Should give insider tips (what to order, when to go, practical advice)',
            'No "Recommended for Alex" fallbacks',
        ],
    },

    // === SCENARIO 5: Cross-domain — books with preferences ===
    {
        name: '📚 Scenario 5: Book search (rich profile)',
        query: 'best books about jazz history',
        domain: 'books',
        capsule: RICH_CAPSULE,
        checkFor: [
            'ForUser may reference "jazz" (legitimate preference)',
            'ForUser should NOT invent book-reading habits',
            'Summaries should describe what each book covers',
        ],
    },

    // === SCENARIO 6: Events ===
    {
        name: '🎫 Scenario 6: Events search (rich profile)',
        query: 'live jazz performances this weekend',
        domain: 'events',
        capsule: RICH_CAPSULE,
        location: 'New York',
        checkFor: [
            'Results should be actual jazz-related events or venues',
            'ForUser may reference "jazz" (legitimate preference)',
            'NO invented event names or fake dates',
            'Summaries should describe what the event IS (who performs, venue, vibe)',
        ],
    },

    // === SCENARIO 7: News ===
    {
        name: '📰 Scenario 7: News search (empty profile)',
        query: 'latest developments in AI and machine learning',
        domain: 'news',
        capsule: EMPTY_CAPSULE,
        checkFor: [
            'Results should be real news articles or sources',
            'NO invented preferences — user has NO preference data',
            'Summaries should describe what the article covers',
            'ForUser should give insider-style context, not preference-matching',
        ],
    },

    // === SCENARIO 8: Places refinement ===
    {
        name: '🍝 Scenario 8: Restaurant refinement (rich profile)',
        query: 'something quieter with a romantic vibe, maybe candlelit',
        domain: 'places',
        capsule: RICH_CAPSULE,
        location: 'New York',
        conversation: {
            previousSearches: ['best Italian restaurants in SoHo'],
            recentMessages: [
                { speaker: 'user', content: 'These are too loud and scene-y. I want something quieter with a romantic vibe', isAgent: false },
            ],
        },
        checkFor: [
            'Results should be quieter/romantic Italian restaurants, NOT loud scene spots',
            'ForUser should reference the refinement (quiet, romantic, candlelit)',
            'Should NOT repeat the same loud restaurants from initial search',
            'Summaries describe the ATMOSPHERE, not just food',
        ],
    },

    // === SCENARIO 9: Events refinement ===
    {
        name: '🎶 Scenario 9: Events refinement (rich profile)',
        query: 'something more intimate and underground, not the big tourist venues',
        domain: 'events',
        capsule: RICH_CAPSULE,
        location: 'New York',
        conversation: {
            previousSearches: ['live jazz performances this weekend'],
            recentMessages: [
                { speaker: 'user', content: 'Those are all the obvious ones. I want something more intimate and underground', isAgent: false },
            ],
        },
        checkFor: [
            'Results should be smaller/intimate jazz venues, NOT Blue Note or Lincoln Center',
            'ForUser should acknowledge the refinement (intimate, underground, not tourist traps)',
            'Summaries should describe the VIBE of the venue',
            'Should feel like insider recommendations, not Google top results',
        ],
    },

    // === SCENARIO 10: Music refinement ===
    {
        name: '🎷 Scenario 10: Music refinement (rich profile)',
        query: 'more modal and post-bop stuff, like late-era Coltrane or Pharoah Sanders',
        domain: 'music',
        capsule: RICH_CAPSULE,
        conversation: {
            previousSearches: ['best jazz albums of all time'],
            recentMessages: [
                { speaker: 'user', content: 'I want more modal and post-bop stuff, like late Coltrane', isAgent: false },
            ],
        },
        checkFor: [
            'Results should be modal jazz / post-bop / spiritual jazz albums',
            'Should include artists like Coltrane, Pharoah Sanders, Alice Coltrane, McCoy Tyner',
            'ForUser should connect to the refinement criteria (modal, experimental, spiritual)',
            'Should NOT return mainstream pop-jazz or smooth jazz',
        ],
    },
];

// ============================================================================
// Hallucination Detection
// ============================================================================

/**
 * Known false friends — items NOT in any test capsule that GPT loves to hallucinate
 */
const HALLUCINATION_MARKERS = [
    'radiohead', 'death note', 'attack on titan', 'naruto',
    'your love of', 'your interest in',
    'based on your preference for',
    'aligns with your', 'matches your profile',
    'your favorite', 'your taste for',
    // Empty-profile specific
    'right up your alley', 'perfect for your taste',
    'your appreciation for',
];

function checkForHallucinations(text: string, capsule: any): string[] {
    const flags: string[] = [];
    const lower = text.toLowerCase();

    for (const marker of HALLUCINATION_MARKERS) {
        if (lower.includes(marker)) {
            flags.push(`🚩 Contains "${marker}"`);
        }
    }

    // Check for preference references that aren't in the capsule
    const prefs = capsule.members?.[0]?.preferences || {};
    const allPrefsFlat = JSON.stringify(prefs).toLowerCase();

    // Look for specific artist/genre/cuisine names that aren't in the profile
    const suspiciousPatterns = [
        /your love of ([^,."]+)/gi,
        /your interest in ([^,."]+)/gi,
        /you (?:love|enjoy|like) ([^,."]+)/gi,
        /your preference for ([^,."]+)/gi,
    ];

    for (const pat of suspiciousPatterns) {
        let match;
        while ((match = pat.exec(lower)) !== null) {
            const referenced = match[1].trim();
            if (!allPrefsFlat.includes(referenced)) {
                flags.push(`🚩 References "${referenced}" — NOT in user preferences`);
            }
        }
    }

    return flags;
}

// ============================================================================
// API Calls
// ============================================================================

interface SearchResult {
    name: string;
    summary?: string;
    subheader?: string;
    personalization?: { forUser: string };
    enrichment?: any;
    verified?: boolean;
}

/**
 * Hit the streaming SSE endpoint and collect results
 */
async function runStreamingSearch(scenario: TestScenario): Promise<{
    results: SearchResult[];
    latencyMs: number;
}> {
    const request = {
        query: { text: scenario.query, domain: scenario.domain },
        capsule: scenario.capsule,
        logistics: {
            searchLocation: scenario.location ? { city: scenario.location } : undefined,
        },
        conversation: scenario.conversation,
        options: { maxResults: 8, includeDebug: true },
    };

    const startTime = Date.now();
    const response = await fetch(`${API_BASE}/api/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        // Fall back to batch endpoint
        console.log(`    ⚠ Streaming failed (${response.status}), trying batch...`);
        return runBatchSearch(scenario);
    }

    const text = await response.text();
    const results: SearchResult[] = [];

    // Parse SSE events
    for (const chunk of text.split('\n\n')) {
        const lines = chunk.split('\n');
        const eventLine = lines.find(l => l.startsWith('event:'));
        const dataLine = lines.find(l => l.startsWith('data:'));

        if (eventLine?.includes('candidate') && dataLine) {
            try {
                const data = JSON.parse(dataLine.replace('data:', '').trim());
                results.push(data);
            } catch { /* skip malformed */ }
        }
    }

    return { results, latencyMs: Date.now() - startTime };
}

/**
 * Hit the batch endpoint as fallback
 */
async function runBatchSearch(scenario: TestScenario): Promise<{
    results: SearchResult[];
    latencyMs: number;
}> {
    const request = {
        query: { text: scenario.query, domain: scenario.domain },
        capsule: scenario.capsule,
        logistics: {
            searchLocation: scenario.location ? { city: scenario.location } : undefined,
        },
        conversation: scenario.conversation,
        options: { maxResults: 8, includeDebug: true },
    };

    const startTime = Date.now();
    const response = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error(`Batch search failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return { results: data.results || [], latencyMs: Date.now() - startTime };
}

// ============================================================================
// Main
// ============================================================================

interface ScenarioResult {
    scenario: string;
    query: string;
    domain: string;
    latencyMs: number;
    resultCount: number;
    results: {
        name: string;
        summary: string;
        forUser: string;
        subheader?: string;
        verified: boolean;
        hallucinationFlags: string[];
    }[];
    hallucinationCount: number;
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           QUALITY SPOT TEST — Manual Review Harness         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  API: ${API_BASE.padEnd(54)}║`);
    console.log(`║  Time: ${new Date().toISOString().padEnd(53)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const allResults: ScenarioResult[] = [];

    for (const scenario of SCENARIOS) {
        console.log(`\n${'═'.repeat(65)}`);
        console.log(`  ${scenario.name}`);
        console.log(`  Query: "${scenario.query}"`);
        console.log(`  Domain: ${scenario.domain} | Profile: ${JSON.stringify(scenario.capsule.members[0].preferences).length < 10 ? 'EMPTY' : 'has prefs'}`);
        console.log(`${'═'.repeat(65)}`);

        console.log(`\n  Check for:`);
        for (const check of scenario.checkFor) {
            console.log(`    ☐ ${check}`);
        }

        try {
            const { results, latencyMs } = await runStreamingSearch(scenario);
            console.log(`\n  ⏱  ${latencyMs}ms | ${results.length} results\n`);

            const scenarioResult: ScenarioResult = {
                scenario: scenario.name,
                query: scenario.query,
                domain: scenario.domain,
                latencyMs,
                resultCount: results.length,
                results: [],
                hallucinationCount: 0,
            };

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const forUser = r.personalization?.forUser || '(none)';
                const summary = r.summary || '(none)';

                // Check for hallucinations
                const flags = [
                    ...checkForHallucinations(forUser, scenario.capsule),
                    ...checkForHallucinations(summary, scenario.capsule),
                ];

                // Print result
                console.log(`  ┌─ [${i + 1}] ${r.name}`);
                if (r.subheader) {
                    console.log(`  │  📍 ${r.subheader}`);
                }
                console.log(`  │  📝 Summary:  ${summary}`);
                console.log(`  │  👤 ForUser:  ${forUser}`);
                if (r.verified !== undefined) {
                    console.log(`  │  ✓ Verified: ${r.verified}`);
                }
                if (flags.length > 0) {
                    console.log(`  │  ⚠️  HALLUCINATION FLAGS:`);
                    for (const flag of flags) {
                        console.log(`  │     ${flag}`);
                    }
                    scenarioResult.hallucinationCount += flags.length;
                }
                console.log(`  └${'─'.repeat(60)}`);

                scenarioResult.results.push({
                    name: r.name,
                    summary,
                    forUser,
                    subheader: r.subheader,
                    verified: r.verified ?? false,
                    hallucinationFlags: flags,
                });
            }

            allResults.push(scenarioResult);
        } catch (error) {
            console.error(`  ❌ FAILED: ${error}`);
            allResults.push({
                scenario: scenario.name,
                query: scenario.query,
                domain: scenario.domain,
                latencyMs: 0,
                resultCount: 0,
                results: [],
                hallucinationCount: 0,
            });
        }

        // Small delay between scenarios
        await new Promise(r => setTimeout(r, 1000));
    }

    // ========== SUMMARY ==========
    console.log(`\n\n${'═'.repeat(65)}`);
    console.log('  📊 SUMMARY');
    console.log('═'.repeat(65));

    let totalFlags = 0;
    let totalResults = 0;
    for (const sr of allResults) {
        const status = sr.hallucinationCount === 0 ? '✅' : `⚠️ ${sr.hallucinationCount} flags`;
        console.log(`  ${status} ${sr.scenario}`);
        console.log(`     ${sr.resultCount} results, ${sr.latencyMs}ms`);
        totalFlags += sr.hallucinationCount;
        totalResults += sr.resultCount;
    }

    console.log(`\n  Total: ${totalResults} results across ${allResults.length} scenarios`);
    console.log(`  Hallucination flags: ${totalFlags}`);
    console.log('═'.repeat(65));

    // Save full results
    const outputPath = `quality-spot-test-${Date.now()}.json`;
    writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
    console.log(`\n  💾 Full results saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
