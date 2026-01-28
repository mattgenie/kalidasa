/**
 * Kalidasa LLM-Driven Evaluation
 * 
 * Generates test queries via LLM for each domain, then runs searches
 * and evaluates with LLM Judge. 10 queries per domain.
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_BASE = process.env.KALIDASA_API || 'http://localhost:3200';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const DOMAINS = ['places', 'movies', 'music', 'videos'] as const;
const QUERIES_PER_DOMAIN = 10;

// Sample personalization capsule
const SAMPLE_CAPSULE = {
    mode: 'solo' as const,
    members: [{
        id: 'eval-user',
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
            videos: {
                interests: ['cooking', 'travel', 'science'],
            },
        },
    }],
};

interface GeneratedQuery {
    text: string;
    domain: string;
    location: string | null;
}

interface SearchResult {
    name: string;
    enrichment?: { verified: boolean; source: string };
    personalization?: { forUser: string };
}

interface EvaluationResult {
    query: string;
    domain: string;
    resultCount: number;
    verifiedCount: number;
    latencyMs: number;
    llmScore: {
        relevance: number;
        diversity: number;
        personalization: number;
        overall: number;
    };
    issues: string[];
}

/**
 * Generate diverse test queries for a domain using LLM
 */
async function generateQueriesForDomain(
    genAI: GoogleGenerativeAI,
    domain: string,
    count: number
): Promise<GeneratedQuery[]> {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 1.0, // High temperature for diversity
        },
    });

    const domainContext: Record<string, string> = {
        places: 'restaurants, cafes, bars, venues in New York City. Vary by cuisine, vibe, occasion, neighborhood, price point.',
        movies: 'films to watch. Vary by genre, era, style, mood, country of origin, director style.',
        music: 'albums, artists, playlists. Vary by genre, mood, era, instrumentation, use case (working, party, relaxing).',
        videos: 'YouTube videos or channels. Vary by topic, format (tutorial, documentary, entertainment), length, creator style.',
    };

    const prompt = `Generate ${count} diverse, realistic search queries for: ${domainContext[domain] || domain}

Requirements:
- Each query should be distinct in intent, style, or focus
- Include a mix of specific and exploratory queries
- Vary complexity (simple vs nuanced requests)
- Make queries feel natural, like real user searches

Return JSON array:
[{"text": "query text", "location": "city or null"}]`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);
        return parsed.map((q: any) => ({
            text: q.text,
            domain,
            location: q.location || (domain === 'places' ? 'New York' : null),
        }));
    } catch (error) {
        console.error(`Failed to generate queries for ${domain}:`, error);
        return [];
    }
}

/**
 * Run a single search
 */
async function runSearch(query: GeneratedQuery): Promise<{
    results: SearchResult[];
    latencyMs: number;
}> {
    const request = {
        query: { text: query.text, domain: query.domain },
        capsule: SAMPLE_CAPSULE,
        logistics: {
            searchLocation: query.location ? { city: query.location } : undefined,
        },
        options: { maxResults: 10, includeDebug: true },
    };

    const startTime = Date.now();
    const response = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();
    return { results: data.results || [], latencyMs };
}

/**
 * LLM Judge evaluation
 */
async function evaluateResults(
    genAI: GoogleGenerativeAI,
    query: string,
    domain: string,
    results: SearchResult[]
): Promise<{ scores: EvaluationResult['llmScore']; issues: string[] }> {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
        },
    });

    const resultsJson = JSON.stringify(results.slice(0, 5).map(r => ({
        name: r.name,
        verified: r.enrichment?.verified,
        source: r.enrichment?.source,
        personalization: r.personalization?.forUser,
    })), null, 2);

    const userPrefs = JSON.stringify(SAMPLE_CAPSULE.members[0].preferences);

    const prompt = `Evaluate search results quality. IMPORTANT: Evaluate RELATIVE TO THE QUERY, not the user's general preferences.

Query: "${query}"
Domain: ${domain}
User preferences: ${userPrefs}

Results (first 5):
${resultsJson}

SCORING GUIDELINES:
- RELEVANCE: Do results match the QUERY INTENT? If user searches for "Italian restaurants", Italian results are relevant even if their preferences say Thai.
- DIVERSITY: Within the query constraints, is there variety? (different price points, vibes, styles, subgenres)
- PERSONALIZATION: Do the notes acknowledge both query fit AND user preference alignment/tension?
- OVERALL: Holistic quality considering the above

Score 1-5 and list issues:
{
  "scores": {
    "relevance": <1-5>,
    "diversity": <1-5>,
    "personalization": <1-5>,
    "overall": <1-5>
  },
  "issues": ["list problems found"]
}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return JSON.parse(text);
    } catch {
        return {
            scores: { relevance: 0, diversity: 0, personalization: 0, overall: 0 },
            issues: ['Evaluation failed'],
        };
    }
}

/**
 * Main evaluation
 */
async function runEvaluation(): Promise<void> {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║        KALIDASA LLM-DRIVEN EVALUATION PROTOCOL            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    if (!GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY required');
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const allResults: EvaluationResult[] = [];

    // Generate and run queries for each domain
    for (const domain of DOMAINS) {
        console.log(`\n━━━ ${domain.toUpperCase()} ━━━`);
        console.log(`Generating ${QUERIES_PER_DOMAIN} test queries...`);

        const queries = await generateQueriesForDomain(genAI, domain, QUERIES_PER_DOMAIN);
        console.log(`Generated ${queries.length} queries\n`);

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`[${i + 1}/${queries.length}] "${query.text}"`);

            try {
                const { results, latencyMs } = await runSearch(query);
                const verifiedCount = results.filter(r => r.enrichment?.verified).length;

                const { scores, issues } = await evaluateResults(genAI, query.text, domain, results);

                console.log(`   → ${results.length} results, ${verifiedCount} verified (${latencyMs}ms)`);
                console.log(`   → Score: ${scores.overall}/5 ${issues.length ? `(${issues.length} issues)` : '✓'}`);

                allResults.push({
                    query: query.text,
                    domain,
                    resultCount: results.length,
                    verifiedCount,
                    latencyMs,
                    llmScore: scores,
                    issues,
                });

                // Rate limit
                await new Promise(r => setTimeout(r, 500));
            } catch (error) {
                console.error(`   ❌ Error: ${error}`);
                allResults.push({
                    query: query.text,
                    domain,
                    resultCount: 0,
                    verifiedCount: 0,
                    latencyMs: 0,
                    llmScore: { relevance: 0, diversity: 0, personalization: 0, overall: 0 },
                    issues: [`${error}`],
                });
            }
        }
    }

    // Generate report
    printReport(allResults);
}

/**
 * Print summary report
 */
function printReport(results: EvaluationResult[]): void {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('                    EVALUATION REPORT                       ');
    console.log('═══════════════════════════════════════════════════════════\n');

    const successful = results.filter(e => e.resultCount > 0);

    if (successful.length === 0) {
        console.log('No successful queries to report.');
        return;
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    console.log('OVERALL');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`Total queries:         ${results.length}`);
    console.log(`Successful:            ${successful.length}`);
    console.log(`Avg latency:           ${Math.round(avg(successful.map(e => e.latencyMs)))}ms`);
    console.log(`Avg verification:      ${(avg(successful.map(e => e.verifiedCount / e.resultCount)) * 100).toFixed(0)}%`);
    console.log(`Avg relevance:         ${avg(successful.map(e => e.llmScore.relevance)).toFixed(2)}/5`);
    console.log(`Avg diversity:         ${avg(successful.map(e => e.llmScore.diversity)).toFixed(2)}/5`);
    console.log(`Avg personalization:   ${avg(successful.map(e => e.llmScore.personalization)).toFixed(2)}/5`);
    console.log(`Avg overall:           ${avg(successful.map(e => e.llmScore.overall)).toFixed(2)}/5`);

    console.log('\nBY DOMAIN');
    console.log('───────────────────────────────────────────────────────────');
    for (const domain of DOMAINS) {
        const domainResults = successful.filter(e => e.domain === domain);
        if (domainResults.length > 0) {
            const overall = avg(domainResults.map(e => e.llmScore.overall));
            const verified = avg(domainResults.map(e => e.verifiedCount / e.resultCount)) * 100;
            console.log(`${domain.padEnd(12)} ${overall.toFixed(2)}/5  (${verified.toFixed(0)}% verified, ${domainResults.length} queries)`);
        }
    }

    // Save results
    const fs = require('fs');
    const outputPath = `eval-llm-${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ Full results saved to: ${outputPath}`);
}

runEvaluation().catch(console.error);
