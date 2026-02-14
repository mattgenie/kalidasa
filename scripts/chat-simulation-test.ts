#!/usr/bin/env npx tsx
/**
 * Chat Simulation Test — Multi-Domain E2E
 *
 * Simulates realistic multi-turn conversations across ALL active domains.
 * Each conversation has:
 *   - Initial search query
 *   - Optional refinement(s)
 *   - Different user profiles (rich, sparse, empty, group)
 *
 * Usage:
 *   npx tsx scripts/chat-simulation-test.ts
 *   KALIDASA_API=http://localhost:3200 npx tsx scripts/chat-simulation-test.ts
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env
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
// User Profiles
// ============================================================================

const PROFILES = {
    richSolo: {
        mode: 'solo' as const,
        members: [{
            id: 'user-rich',
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
    },
    sparseSolo: {
        mode: 'solo' as const,
        members: [{
            id: 'user-sparse',
            name: 'Matt',
            preferences: {
                movies: {
                    favoriteGenres: ['anime', 'studio ghibli'],
                },
            },
        }],
    },
    emptySolo: {
        mode: 'solo' as const,
        members: [{
            id: 'user-empty',
            name: 'Alex',
            preferences: {},
        }],
    },
    group: {
        mode: 'group' as const,
        members: [
            {
                id: 'group-user-1',
                name: 'Jordan',
                preferences: {
                    places: { favoriteCuisines: ['Thai', 'Ethiopian'] },
                    music: { favoriteGenres: ['jazz', 'world'] },
                },
            },
            {
                id: 'group-user-2',
                name: 'Sam',
                preferences: {
                    places: { favoriteCuisines: ['Italian', 'French'] },
                    music: { favoriteGenres: ['rock', 'classic rock'] },
                },
            },
        ],
    },
};

// ============================================================================
// Conversation Definitions
// ============================================================================

interface ConversationTurn {
    type: 'search' | 'refinement' | 'chat';
    /** For search: the query text */
    query?: string;
    /** For search/refinement: the domain */
    domain?: string;
    /** For chat: the user's non-search message */
    message?: string;
    /** For refinement: optional user message providing context */
    userMessage?: string;
    /** Location context */
    location?: string;
}

interface SimulatedConversation {
    id: string;
    name: string;
    profile: keyof typeof PROFILES;
    turns: ConversationTurn[];
}

const CONVERSATIONS: SimulatedConversation[] = [
    // ── Places domain ──────────────────────────────────────────────
    {
        id: 'conv-places-1',
        name: '🍝 Restaurant Hunt → Refinement (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'best Italian restaurants in SoHo', domain: 'places', location: 'New York' },
            {
                type: 'refinement', query: 'something quieter and more romantic, candlelit', domain: 'places', location: 'New York',
                userMessage: 'These are too loud. I want something quieter.'
            },
        ],
    },
    {
        id: 'conv-places-2',
        name: '🍜 Casual Dining (empty profile)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'casual ramen spots near me', domain: 'places', location: 'Los Angeles' },
        ],
    },
    {
        id: 'conv-places-3',
        name: '🍻 Group Dinner Planning',
        profile: 'group',
        turns: [
            { type: 'search', query: 'restaurants good for large groups in Brooklyn', domain: 'places', location: 'New York' },
            { type: 'chat', message: 'We want somewhere with good vegetarian options too' },
            {
                type: 'refinement', query: 'restaurants good for large groups with vegetarian options in Brooklyn', domain: 'places', location: 'New York',
                userMessage: 'We also need good vegetarian options'
            },
        ],
    },

    // ── Movies domain ──────────────────────────────────────────────
    {
        id: 'conv-movies-1',
        name: '🎬 Movie Night → Refinement (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'best documentaries about music', domain: 'movies' },
            {
                type: 'refinement', query: 'documentaries specifically about jazz musicians', domain: 'movies',
                userMessage: 'I want something specifically about jazz musicians'
            },
        ],
    },
    {
        id: 'conv-movies-2',
        name: '🎌 Anime Search → Miyazaki Refinement (sparse)',
        profile: 'sparseSolo',
        turns: [
            { type: 'search', query: 'best anime series to watch', domain: 'movies' },
            {
                type: 'refinement', query: 'anime similar to Miyazaki with nature themes and gentle pacing', domain: 'movies',
                userMessage: 'Something more like Miyazaki — nature, gentle pacing'
            },
        ],
    },
    {
        id: 'conv-movies-3',
        name: '🎥 Sci-Fi Exploration (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'mind-bending sci-fi movies like Arrival or Interstellar', domain: 'movies' },
        ],
    },

    // ── Music domain ───────────────────────────────────────────────
    {
        id: 'conv-music-1',
        name: '🎷 Jazz Deep Dive → Post-Bop Refinement (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'best jazz albums of all time', domain: 'music' },
            {
                type: 'refinement', query: 'more modal and post-bop stuff, like late-era Coltrane or Pharoah Sanders', domain: 'music',
                userMessage: 'I want more modal and post-bop, like late Coltrane'
            },
        ],
    },
    {
        id: 'conv-music-2',
        name: '🎸 Indie Rock Discovery (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'best indie rock albums of the 2020s', domain: 'music' },
        ],
    },
    {
        id: 'conv-music-3',
        name: '🎵 Group Music Recs',
        profile: 'group',
        turns: [
            { type: 'search', query: 'music albums everyone should hear at least once', domain: 'music' },
        ],
    },

    // ── Events domain ──────────────────────────────────────────────
    {
        id: 'conv-events-1',
        name: '🎫 Weekend Events → Underground Refinement (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'live jazz performances this weekend', domain: 'events', location: 'New York' },
            {
                type: 'refinement', query: 'something more intimate and underground, not the big tourist venues', domain: 'events', location: 'New York',
                userMessage: 'Those are all obvious ones. Something more underground.'
            },
        ],
    },
    {
        id: 'conv-events-2',
        name: '🎪 Family Events (sparse)',
        profile: 'sparseSolo',
        turns: [
            { type: 'search', query: 'family-friendly events this weekend', domain: 'events', location: 'Chicago' },
        ],
    },

    // ── Videos domain ──────────────────────────────────────────────
    {
        id: 'conv-videos-1',
        name: '📹 Cooking Tutorials (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'best YouTube cooking tutorials for beginners', domain: 'videos' },
        ],
    },
    {
        id: 'conv-videos-2',
        name: '🎮 Gaming Videos → Specific Refinement (sparse)',
        profile: 'sparseSolo',
        turns: [
            { type: 'search', query: 'best video essays about game design', domain: 'videos' },
            {
                type: 'refinement', query: 'video essays specifically about Nintendo game design philosophy', domain: 'videos',
                userMessage: 'More about Nintendo specifically'
            },
        ],
    },

    // ── Articles domain ────────────────────────────────────────────
    {
        id: 'conv-articles-1',
        name: '📰 Long-form Reading (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'best long-form articles about the future of AI', domain: 'articles' },
        ],
    },
    {
        id: 'conv-articles-2',
        name: '📝 Travel Writing (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'best travel essays and articles about Japan', domain: 'articles' },
        ],
    },

    // ── General domain ─────────────────────────────────────────────
    {
        id: 'conv-general-1',
        name: '🌍 General Knowledge (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'how does sourdough fermentation work', domain: 'general' },
        ],
    },
    {
        id: 'conv-general-2',
        name: '🧪 Science Exploration → Refinement (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'history of space exploration milestones', domain: 'general' },
            {
                type: 'refinement', query: 'unmanned deep space missions specifically, like Voyager and New Horizons', domain: 'general',
                userMessage: 'More about unmanned deep space missions, like Voyager'
            },
        ],
    },

    // ── Books domain ───────────────────────────────────────────────
    {
        id: 'conv-books-1',
        name: '📚 Book Recommendations (rich)',
        profile: 'richSolo',
        turns: [
            { type: 'search', query: 'best books about jazz history', domain: 'books' },
        ],
    },

    // ── News domain ────────────────────────────────────────────────
    {
        id: 'conv-news-1',
        name: '📡 News Catch-Up (empty)',
        profile: 'emptySolo',
        turns: [
            { type: 'search', query: 'latest developments in AI and machine learning', domain: 'news' },
        ],
    },
];

// ============================================================================
// Search API Call
// ============================================================================

interface SearchResult {
    name: string;
    summary?: string;
    subheader?: string;
    personalization?: { forUser: string };
    enrichment?: any;
    verified?: boolean;
}

async function runSearch(
    query: string,
    domain: string,
    capsule: any,
    location?: string,
    conversation?: { previousSearches: string[]; recentMessages: { speaker: string; content: string; isAgent: boolean }[] },
): Promise<{ results: SearchResult[]; latencyMs: number; error?: string }> {
    const request = {
        query: { text: query, domain },
        capsule,
        logistics: {
            searchLocation: location ? { city: location } : undefined,
        },
        conversation,
        options: { maxResults: 8, includeDebug: true },
    };

    const startTime = Date.now();

    // Try streaming first
    try {
        const response = await fetch(`${API_BASE}/api/search/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(30000),
        });

        if (response.ok) {
            const text = await response.text();
            const results: SearchResult[] = [];
            for (const chunk of text.split('\n\n')) {
                const lines = chunk.split('\n');
                const eventLine = lines.find(l => l.startsWith('event:'));
                const dataLine = lines.find(l => l.startsWith('data:'));
                if (eventLine?.includes('candidate') && dataLine) {
                    try {
                        results.push(JSON.parse(dataLine.replace('data:', '').trim()));
                    } catch { /* skip malformed */ }
                }
            }
            return { results, latencyMs: Date.now() - startTime };
        }
    } catch { /* streaming failed, try batch */ }

    // Fallback to batch
    try {
        const response = await fetch(`${API_BASE}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const err = await response.text();
            return { results: [], latencyMs: Date.now() - startTime, error: `${response.status}: ${err}` };
        }

        const data = await response.json();
        return { results: data.results || [], latencyMs: Date.now() - startTime };
    } catch (e: any) {
        return { results: [], latencyMs: Date.now() - startTime, error: e.message };
    }
}

// ============================================================================
// Quality Checks
// ============================================================================

function checkSkipLanguage(text: string): string[] {
    const lower = text.toLowerCase();
    const flags: string[] = [];
    const patterns = [
        { match: 'skip this', label: '"skip this"' },
        { match: 'hard pass', label: '"hard pass"' },
        { match: 'skip it', label: '"skip it"' },
        { match: 'hard skip', label: '"hard skip"' },
        { match: 'forget it', label: '"forget it"' },
        { match: 'give this a miss', label: '"give this a miss"' },
        { match: 'pass on this', label: '"pass on this"' },
    ];
    for (const p of patterns) {
        if (lower.includes(p.match)) flags.push(p.label);
    }
    return flags;
}

function checkHallucinations(text: string, capsule: any): string[] {
    const flags: string[] = [];
    const lower = text.toLowerCase();
    const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {}).toLowerCase();

    // Check for preference-matching language when profile is empty
    const hasPrefs = prefs !== '{}';
    if (!hasPrefs) {
        if (/right up your alley/i.test(text)) flags.push('🚩 "right up your alley" with empty profile');
        if (/perfect for your taste/i.test(text)) flags.push('🚩 "perfect for your taste" with empty profile');
        if (/your preference/i.test(text)) flags.push('🚩 "your preference" with empty profile');
    }

    // Check for hallucinated preference references
    const suspiciousPatterns = [
        /your love of ([^,."\n]+)/gi,
        /your interest in ([^,."\n]+)/gi,
    ];
    for (const pat of suspiciousPatterns) {
        let match;
        while ((match = pat.exec(lower)) !== null) {
            const referenced = match[1].trim();
            if (!prefs.includes(referenced)) {
                flags.push(`🚩 References "${referenced}" — NOT in preferences`);
            }
        }
    }

    return flags;
}

// ============================================================================
// Main Runner
// ============================================================================

interface ConversationResult {
    id: string;
    name: string;
    profile: string;
    turns: TurnResult[];
    totalMs: number;
    skipCount: number;
    hallucinationCount: number;
    errors: string[];
}

interface TurnResult {
    type: 'search' | 'refinement' | 'chat';
    query?: string;
    domain?: string;
    message?: string;
    results: SearchResult[];
    latencyMs: number;
    skipFlags: { item: string; flags: string[] }[];
    hallucinationFlags: { item: string; flags: string[] }[];
    error?: string;
}

async function runConversation(conv: SimulatedConversation): Promise<ConversationResult> {
    const capsule = PROFILES[conv.profile];
    const previousSearches: string[] = [];
    const recentMessages: { speaker: string; content: string; isAgent: boolean }[] = [];
    const turnResults: TurnResult[] = [];
    let totalMs = 0;
    let totalSkips = 0;
    let totalHallucinations = 0;
    const errors: string[] = [];

    for (const turn of conv.turns) {
        if (turn.type === 'chat') {
            // Non-search turn — just add to conversation history
            recentMessages.push({ speaker: capsule.members[0].name, content: turn.message!, isAgent: false });
            turnResults.push({
                type: 'chat',
                message: turn.message,
                results: [],
                latencyMs: 0,
                skipFlags: [],
                hallucinationFlags: [],
            });
            continue;
        }

        // If refinement, add user message to conversation history
        if (turn.type === 'refinement' && turn.userMessage) {
            recentMessages.push({ speaker: capsule.members[0].name, content: turn.userMessage, isAgent: false });
        }

        const conversation = previousSearches.length > 0 || recentMessages.length > 0
            ? { previousSearches: [...previousSearches], recentMessages: [...recentMessages] }
            : undefined;

        const { results, latencyMs, error } = await runSearch(
            turn.query!,
            turn.domain!,
            capsule,
            turn.location,
            conversation,
        );

        totalMs += latencyMs;

        if (error) {
            errors.push(`${turn.type} (${turn.domain}): ${error}`);
        }

        // Remember this search
        previousSearches.push(turn.query!);

        // Check quality
        const skipFlags: { item: string; flags: string[] }[] = [];
        const hallucinationFlags: { item: string; flags: string[] }[] = [];

        for (const r of results) {
            const forUser = r.personalization?.forUser || '';
            const skipm = checkSkipLanguage(forUser);
            if (skipm.length > 0) {
                skipFlags.push({ item: r.name, flags: skipm });
                totalSkips += skipm.length;
            }
            const hallm = checkHallucinations(forUser, capsule);
            if (hallm.length > 0) {
                hallucinationFlags.push({ item: r.name, flags: hallm });
                totalHallucinations += hallm.length;
            }
        }

        turnResults.push({
            type: turn.type,
            query: turn.query,
            domain: turn.domain,
            results,
            latencyMs,
            skipFlags,
            hallucinationFlags,
            error,
        });
    }

    return {
        id: conv.id,
        name: conv.name,
        profile: conv.profile,
        turns: turnResults,
        totalMs,
        skipCount: totalSkips,
        hallucinationCount: totalHallucinations,
        errors,
    };
}

function printConversationResult(result: ConversationResult) {
    const profileLabel = result.profile === 'emptySolo' ? '⚪ empty' :
        result.profile === 'sparseSolo' ? '🔵 sparse' :
            result.profile === 'richSolo' ? '🟢 rich' : '🟣 group';
    const status = result.errors.length > 0
        ? (result.turns.some(t => t.results.length > 0) ? '⚠️' : '❌')
        : '✅';

    console.log(`  ${status} ${result.name} [${profileLabel}]`);

    for (const turn of result.turns) {
        if (turn.type === 'chat') {
            console.log(`     💬 "${turn.message}"`);
            continue;
        }

        const icon = turn.type === 'refinement' ? '🔄' : '🔎';
        const resultCount = turn.results.length;
        const latency = `${(turn.latencyMs / 1000).toFixed(1)}s`;

        if (turn.error) {
            console.log(`     ${icon} [${turn.domain}] "${turn.query}" → ❌ ${turn.error}`);
            continue;
        }

        console.log(`     ${icon} [${turn.domain}] "${turn.query}" → ${resultCount} results (${latency})`);

        // Show skip flags
        for (const sf of turn.skipFlags) {
            console.log(`        🛑 ${sf.item}: ${sf.flags.join(', ')}`);
        }
        // Show hallucination flags
        for (const hf of turn.hallucinationFlags) {
            console.log(`        🚩 ${hf.item}: ${hf.flags.join(', ')}`);
        }
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         CHAT SIMULATION TEST — Multi-Domain E2E            ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  API: ${API_BASE.padEnd(54)}║`);
    console.log(`║  Time: ${new Date().toISOString().padEnd(53)}║`);
    console.log(`║  Conversations: ${CONVERSATIONS.length.toString().padEnd(43)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    const results: ConversationResult[] = [];

    // Group by domain for organized output
    const domainGroups: Record<string, SimulatedConversation[]> = {};
    for (const conv of CONVERSATIONS) {
        const primaryDomain = conv.turns.find(t => t.domain)?.domain || 'unknown';
        if (!domainGroups[primaryDomain]) domainGroups[primaryDomain] = [];
        domainGroups[primaryDomain].push(conv);
    }

    for (const [domain, convs] of Object.entries(domainGroups)) {
        console.log(`\n═══ ${domain.toUpperCase()} ═══════════════════════════════════════════`);

        for (const conv of convs) {
            const result = await runConversation(conv);
            results.push(result);
            printConversationResult(result);
        }
    }

    // ── Summary ──────────────────────────────────────────────────
    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 OVERALL SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');

    const totalConvs = results.length;
    const totalSearchTurns = results.reduce((a, r) => a + r.turns.filter(t => t.type !== 'chat').length, 0);
    const totalResults = results.reduce((a, r) => a + r.turns.reduce((b, t) => b + t.results.length, 0), 0);
    const totalSkips = results.reduce((a, r) => a + r.skipCount, 0);
    const totalHallucinations = results.reduce((a, r) => a + r.hallucinationCount, 0);
    const totalErrors = results.reduce((a, r) => a + r.errors.length, 0);
    const avgLatency = results.reduce((a, r) => a + r.totalMs, 0) / Math.max(totalSearchTurns, 1);
    const successfulConvs = results.filter(r => r.errors.length === 0).length;
    const partialConvs = results.filter(r => r.errors.length > 0 && r.turns.some(t => t.results.length > 0)).length;
    const failedConvs = results.filter(r => r.turns.every(t => t.type === 'chat' || t.results.length === 0 || t.error)).length;

    // Domain breakdown
    const domainStats: Record<string, { searches: number; results: number; skips: number; errors: number }> = {};
    for (const r of results) {
        for (const t of r.turns) {
            if (t.type === 'chat') continue;
            const d = t.domain || 'unknown';
            if (!domainStats[d]) domainStats[d] = { searches: 0, results: 0, skips: 0, errors: 0 };
            domainStats[d].searches++;
            domainStats[d].results += t.results.length;
            domainStats[d].skips += t.skipFlags.reduce((a, sf) => a + sf.flags.length, 0);
            if (t.error) domainStats[d].errors++;
        }
    }

    console.log();
    console.log(`  Conversations:      ${successfulConvs}/${totalConvs} clean, ${partialConvs} partial, ${failedConvs} failed`);
    console.log(`  Search Turns:       ${totalSearchTurns} total`);
    console.log(`  Results Generated:  ${totalResults}`);
    console.log(`  Skip Instances:     ${totalSkips} (${(totalSkips * 100 / Math.max(totalResults, 1)).toFixed(1)}%)`);
    console.log(`  Hallucination Flags: ${totalHallucinations}`);
    console.log(`  Avg Latency:        ${(avgLatency / 1000).toFixed(1)}s per search`);
    console.log();
    console.log('  Domain Breakdown:');
    console.log('  ┌──────────────┬──────────┬─────────┬───────┬────────┐');
    console.log('  │ Domain       │ Searches │ Results │ Skips │ Errors │');
    console.log('  ├──────────────┼──────────┼─────────┼───────┼────────┤');
    for (const [domain, stats] of Object.entries(domainStats).sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  │ ${domain.padEnd(12)} │ ${String(stats.searches).padStart(8)} │ ${String(stats.results).padStart(7)} │ ${String(stats.skips).padStart(5)} │ ${String(stats.errors).padStart(6)} │`);
    }
    console.log('  └──────────────┴──────────┴─────────┴───────┴────────┘');

    // Profile breakdown
    const profileStats: Record<string, { convs: number; skips: number; hallucinations: number }> = {};
    for (const r of results) {
        if (!profileStats[r.profile]) profileStats[r.profile] = { convs: 0, skips: 0, hallucinations: 0 };
        profileStats[r.profile].convs++;
        profileStats[r.profile].skips += r.skipCount;
        profileStats[r.profile].hallucinations += r.hallucinationCount;
    }

    console.log();
    console.log('  Profile Breakdown:');
    for (const [profile, stats] of Object.entries(profileStats)) {
        const label = profile === 'emptySolo' ? '⚪ Empty' :
            profile === 'sparseSolo' ? '🔵 Sparse' :
                profile === 'richSolo' ? '🟢 Rich' : '🟣 Group';
        console.log(`    ${label}: ${stats.convs} convs, ${stats.skips} skips, ${stats.hallucinations} hallucination flags`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════\n');

    // Save full results
    const filename = `chat-simulation-${Date.now()}.json`;
    writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`  💾 Full results saved to: ${filename}`);
}

main().catch(console.error);
