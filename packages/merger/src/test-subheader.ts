/**
 * Test script for subheader generation across all domains.
 * Run: npx tsx packages/merger/src/test-subheader.ts
 */

import { generateSubheader } from './subheader.js';
import type { EnrichmentResult } from '@kalidasa/types';

interface TestCase {
    label: string;
    domain: string;
    enrichment: EnrichmentResult;
    expected: string | undefined;
}

const tests: TestCase[] = [
    // ── Places ──────────────────────────────────────────
    {
        label: 'Places: full data',
        domain: 'places',
        enrichment: {
            verified: true,
            places: {
                rating: 4.5,
                reviewCount: 1200,
                priceLevel: '$$',
                openNow: true,
                address: '567 Union Ave, Brooklyn',
            },
        },
        expected: 'Open now · 4.5★ · $$',
    },
    {
        label: 'Places: closed, no price',
        domain: 'places',
        enrichment: {
            verified: true,
            places: {
                rating: 3.8,
                openNow: false,
            },
        },
        expected: 'Closed · 3.8★',
    },
    {
        label: 'Places: no enrichment',
        domain: 'places',
        enrichment: { verified: false },
        expected: undefined,
    },

    // ── Movies ──────────────────────────────────────────
    {
        label: 'Movies: full data',
        domain: 'movies',
        enrichment: {
            verified: true,
            movies: {
                year: '2018',
                director: 'Alex Garland',
                runtime: 115,
                genres: ['Sci-Fi', 'Thriller'],
            },
        },
        expected: '2018 · Alex Garland · 1h 55m',
    },
    {
        label: 'Movies: short film',
        domain: 'movies',
        enrichment: {
            verified: true,
            movies: {
                year: '2023',
                runtime: 45,
            },
        },
        expected: '2023 · 45m',
    },
    {
        label: 'Movies: exactly 2 hours',
        domain: 'movies',
        enrichment: {
            verified: true,
            movies: {
                year: '2001',
                director: 'Christopher Nolan',
                runtime: 120,
            },
        },
        expected: '2001 · Christopher Nolan · 2h',
    },

    // ── Music ───────────────────────────────────────────
    {
        label: 'Music: full data',
        domain: 'music',
        enrichment: {
            verified: true,
            music: {
                artist: 'Bon Iver',
                album: 'Bon Iver, Bon Iver',
                releaseDate: '2011-06-21',
            },
        },
        expected: 'Bon Iver · Bon Iver, Bon Iver · 2011',
    },
    {
        label: 'Music: artist only',
        domain: 'music',
        enrichment: {
            verified: true,
            music: {
                artist: 'Radiohead',
            },
        },
        expected: 'Radiohead',
    },

    // ── Events ──────────────────────────────────────────
    {
        label: 'Events: full data',
        domain: 'events',
        enrichment: {
            verified: true,
            events: {
                venue: 'The McKittrick Hotel',
                startDate: '2026-02-07T20:00:00Z',
                priceRange: '$100–$150',
            },
        },
        expected: undefined, // will be a formatted date + venue + price
    },
    {
        label: 'Events: venue only',
        domain: 'events',
        enrichment: {
            verified: true,
            events: {
                venue: 'Madison Square Garden',
            },
        },
        expected: 'Madison Square Garden',
    },

    // ── Videos ──────────────────────────────────────────
    {
        label: 'Videos: full data',
        domain: 'videos',
        enrichment: {
            verified: true,
            videos: {
                channelName: 'Vox',
                duration: '12:34',
                viewCount: 2_100_000,
            },
        },
        expected: 'Vox · 12:34 · 2.1M views',
    },
    {
        label: 'Videos: small count',
        domain: 'videos',
        enrichment: {
            verified: true,
            videos: {
                channelName: 'TechCrunch',
                duration: '5:02',
                viewCount: 53_000,
            },
        },
        expected: 'TechCrunch · 5:02 · 53K views',
    },
    {
        label: 'Videos: tiny count',
        domain: 'videos',
        enrichment: {
            verified: true,
            videos: {
                channelName: 'Indie Channel',
                viewCount: 450,
            },
        },
        expected: 'Indie Channel · 450 views',
    },

    // ── Articles ─────────────────────────────────────────
    {
        label: 'Articles: full data',
        domain: 'articles',
        enrichment: {
            verified: true,
            articles: {
                source: 'Stratechery',
                author: 'Ben Thompson',
                publishedAt: '2026-01-15T10:00:00Z',
            },
        },
        expected: undefined, // will be source + author + formatted date
    },
    {
        label: 'Articles: source only',
        domain: 'articles',
        enrichment: {
            verified: true,
            articles: {
                source: 'The Verge',
            },
        },
        expected: 'The Verge',
    },

    // ── General ─────────────────────────────────────────
    {
        label: 'General: returns undefined (no structured data)',
        domain: 'general',
        enrichment: {
            verified: true,
            general: {
                summary: 'A cookbook about flavor',
            },
        },
        expected: undefined,
    },
];

// ── Run tests ───────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════');
console.log('  🧪 Subheader Generation Tests');
console.log('════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

for (const test of tests) {
    const result = generateSubheader(test.domain as any, test.enrichment);

    // For cases where we set expected to undefined but just want to verify it produces something
    if (test.expected === undefined && test.label.includes('full data')) {
        // Just verify it produces a non-empty string
        if (result && result.length > 0) {
            console.log(`  ✅ ${test.label}`);
            console.log(`     → "${result}"`);
            passed++;
        } else {
            console.log(`  ❌ ${test.label}`);
            console.log(`     Expected: non-empty string`);
            console.log(`     Got:      ${JSON.stringify(result)}`);
            failed++;
        }
    } else if (test.expected === undefined) {
        if (result === undefined) {
            console.log(`  ✅ ${test.label}`);
            console.log(`     → undefined (expected)`);
            passed++;
        } else {
            console.log(`  ❌ ${test.label}`);
            console.log(`     Expected: undefined`);
            console.log(`     Got:      "${result}"`);
            failed++;
        }
    } else if (result === test.expected) {
        console.log(`  ✅ ${test.label}`);
        console.log(`     → "${result}"`);
        passed++;
    } else {
        console.log(`  ❌ ${test.label}`);
        console.log(`     Expected: "${test.expected}"`);
        console.log(`     Got:      "${result}"`);
        failed++;
    }
}

console.log('\n════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${tests.length} total`);
console.log('════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
