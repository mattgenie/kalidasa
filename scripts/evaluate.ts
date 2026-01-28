/**
 * Kalidasa Quality Evaluation Protocol
 * 
 * Runs 20 diverse searches and uses an LLM Judge to evaluate:
 * - Enrichment consistency (verified vs actual data)
 * - Result quality and relevance
 * - Personalization accuracy
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_BASE = process.env.KALIDASA_API || 'http://localhost:3200';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Sample personalization capsule
const SAMPLE_CAPSULE = {
    mode: 'solo' as const,
    members: [{
        id: 'eval-user',
        name: 'Alex',
        preferences: {
            places: {
                favoriteCuisines: ['Italian', 'Japanese', 'Mexican'],
                priceRange: { min: 2, max: 4 },
                vibePreferences: ['cozy', 'romantic', 'trendy'],
            },
            movies: {
                favoriteGenres: ['thriller', 'sci-fi', 'drama'],
                dislikedGenres: ['horror'],
            },
            music: {
                favoriteGenres: ['indie', 'electronic', 'jazz'],
            },
        },
    }],
};

// 20 diverse test queries across domains
const TEST_QUERIES = [
    // Places (8 queries)
    { text: 'best Italian restaurants in SoHo NYC', domain: 'places', location: 'New York' },
    { text: 'cozy coffee shops for working in Brooklyn', domain: 'places', location: 'New York' },
    { text: 'romantic dinner spots in the West Village', domain: 'places', location: 'New York' },
    { text: 'best sushi near Tribeca', domain: 'places', location: 'New York' },
    { text: 'trendy brunch spots in Williamsburg', domain: 'places', location: 'New York' },
    { text: 'best tacos in East Village', domain: 'places', location: 'New York' },
    { text: 'rooftop bars with views in Manhattan', domain: 'places', location: 'New York' },
    { text: 'quiet wine bars in Greenwich Village', domain: 'places', location: 'New York' },

    // Movies (6 queries)
    { text: 'best sci-fi movies like Blade Runner', domain: 'movies', location: null },
    { text: 'underrated thriller movies from the 90s', domain: 'movies', location: null },
    { text: 'best drama films of 2023', domain: 'movies', location: null },
    { text: 'mind-bending movies like Inception', domain: 'movies', location: null },
    { text: 'classic noir films everyone should watch', domain: 'movies', location: null },
    { text: 'best foreign language thrillers', domain: 'movies', location: null },

    // Music (4 queries)
    { text: 'chill electronic albums for focus', domain: 'music', location: null },
    { text: 'indie bands similar to Radiohead', domain: 'music', location: null },
    { text: 'best jazz albums for dinner parties', domain: 'music', location: null },
    { text: 'new electronic artists to discover', domain: 'music', location: null },

    // General (2 queries)
    { text: 'best hiking trails near NYC', domain: 'places', location: 'New York' },
    { text: 'unique date ideas in Manhattan', domain: 'general', location: 'New York' },
];

interface SearchResult {
    name: string;
    verified: boolean;
    enrichment?: any;
    personalization?: { forUser: string };
    summary?: string;
}

interface SearchResponse {
    results: SearchResult[];
    debug?: {
        timing: { totalMs: number; caoGenerationMs: number; enrichmentMs: number };
        enrichment: { candidatesGenerated: number; candidatesVerified: number };
    };
}

interface EvaluationResult {
    query: string;
    domain: string;
    resultCount: number;
    verifiedCount: number;
    verificationRate: number;
    latencyMs: number;
    llmScore: {
        relevance: number;          // 1-5: How relevant are results to query?
        enrichmentAccuracy: number; // 1-5: Does enrichment data match result names?
        personalization: number;    // 1-5: Are personalization notes accurate?
        diversity: number;          // 1-5: Good variety in results?
        overall: number;            // 1-5: Overall quality
    };
    issues: string[];
    rawResults: SearchResult[];
}

/**
 * Run a single search
 */
async function runSearch(query: typeof TEST_QUERIES[0]): Promise<SearchResponse> {
    const request = {
        query: {
            text: query.text,
            domain: query.domain,
        },
        capsule: SAMPLE_CAPSULE,
        logistics: {
            searchLocation: query.location ? { city: query.location } : undefined,
        },
        options: {
            maxResults: 10,
            includeDebug: true,
        },
    };

    const response = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
    }

    return response.json();
}

/**
 * LLM Judge evaluation
 */
async function evaluateWithLLM(
    query: string,
    domain: string,
    results: SearchResult[],
    genAI: GoogleGenerativeAI
): Promise<{ scores: EvaluationResult['llmScore']; issues: string[] }> {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
        },
    });

    const resultsJson = JSON.stringify(results.map(r => ({
        name: r.name,
        verified: r.verified,
        hasEnrichment: !!r.enrichment,
        enrichmentSource: r.enrichment?.source,
        personalization: r.personalization?.forUser,
        summary: r.summary,
        // Include key enrichment data for validation
        enrichmentPreview: r.enrichment?.places ? {
            address: r.enrichment.places.address,
            rating: r.enrichment.places.rating,
        } : r.enrichment?.movies ? {
            title: r.enrichment.movies.title,
            year: r.enrichment.movies.releaseYear,
        } : null,
    })), null, 2);

    const prompt = `You are evaluating search results quality.

Query: "${query}"
Domain: ${domain}
User preferences: Italian/Japanese/Mexican food, cozy/romantic/trendy vibes, likes thrillers/sci-fi, dislikes horror

Results:
${resultsJson}

Evaluate and return JSON:
{
  "scores": {
    "relevance": <1-5>,      // Do results match query intent?
    "enrichmentAccuracy": <1-5>, // Does enrichment data match result names? Any mismatches?
    "personalization": <1-5>, // Do personalization notes reflect user preferences?
    "diversity": <1-5>,       // Good variety, not repetitive?
    "overall": <1-5>          // Overall quality
  },
  "issues": ["list", "of", "any", "problems", "found"]
}

Issues to look for:
- Enrichment showing wrong entity (e.g., "Carbone" enriched as different restaurant)
- Results not relevant to query
- Personalization generic or wrong
- Duplicates or near-duplicates
- Verified=false but has enrichment, or vice versa`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);
        return {
            scores: parsed.scores,
            issues: parsed.issues || [],
        };
    } catch (error) {
        console.error('LLM evaluation failed:', error);
        return {
            scores: { relevance: 0, enrichmentAccuracy: 0, personalization: 0, diversity: 0, overall: 0 },
            issues: ['LLM evaluation failed'],
        };
    }
}

/**
 * Run full evaluation protocol
 */
async function runEvaluation(): Promise<void> {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║           KALIDASA QUALITY EVALUATION PROTOCOL            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    if (!GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY required for LLM Judge');
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const evaluations: EvaluationResult[] = [];

    console.log(`Running ${TEST_QUERIES.length} searches...\n`);

    for (let i = 0; i < TEST_QUERIES.length; i++) {
        const query = TEST_QUERIES[i];
        console.log(`[${i + 1}/${TEST_QUERIES.length}] "${query.text}" (${query.domain})`);

        try {
            const startTime = Date.now();
            const response = await runSearch(query);
            const latencyMs = Date.now() - startTime;

            const verifiedCount = response.results.filter(r => r.verified).length;

            console.log(`   → ${response.results.length} results, ${verifiedCount} verified (${latencyMs}ms)`);

            // LLM Judge evaluation
            const { scores, issues } = await evaluateWithLLM(
                query.text,
                query.domain,
                response.results,
                genAI
            );

            console.log(`   → LLM Score: ${scores.overall}/5 ${issues.length ? `(${issues.length} issues)` : '✓'}`);

            evaluations.push({
                query: query.text,
                domain: query.domain,
                resultCount: response.results.length,
                verifiedCount,
                verificationRate: verifiedCount / response.results.length,
                latencyMs,
                llmScore: scores,
                issues,
                rawResults: response.results,
            });

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));

        } catch (error) {
            console.error(`   ❌ Error: ${error}`);
            evaluations.push({
                query: query.text,
                domain: query.domain,
                resultCount: 0,
                verifiedCount: 0,
                verificationRate: 0,
                latencyMs: 0,
                llmScore: { relevance: 0, enrichmentAccuracy: 0, personalization: 0, diversity: 0, overall: 0 },
                issues: [`Search failed: ${error}`],
                rawResults: [],
            });
        }
    }

    // Generate report
    generateReport(evaluations);
}

/**
 * Generate summary report
 */
function generateReport(evaluations: EvaluationResult[]): void {
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                    EVALUATION REPORT                       ');
    console.log('═══════════════════════════════════════════════════════════\n');

    const successful = evaluations.filter(e => e.resultCount > 0);

    // Aggregate stats
    const avgLatency = successful.reduce((sum, e) => sum + e.latencyMs, 0) / successful.length;
    const avgVerificationRate = successful.reduce((sum, e) => sum + e.verificationRate, 0) / successful.length;
    const avgRelevance = successful.reduce((sum, e) => sum + e.llmScore.relevance, 0) / successful.length;
    const avgEnrichmentAccuracy = successful.reduce((sum, e) => sum + e.llmScore.enrichmentAccuracy, 0) / successful.length;
    const avgPersonalization = successful.reduce((sum, e) => sum + e.llmScore.personalization, 0) / successful.length;
    const avgDiversity = successful.reduce((sum, e) => sum + e.llmScore.diversity, 0) / successful.length;
    const avgOverall = successful.reduce((sum, e) => sum + e.llmScore.overall, 0) / successful.length;

    console.log('SUMMARY');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`Queries run:           ${evaluations.length}`);
    console.log(`Successful:            ${successful.length}`);
    console.log(`Avg latency:           ${Math.round(avgLatency)}ms`);
    console.log(`Avg verification rate: ${(avgVerificationRate * 100).toFixed(1)}%`);
    console.log('');
    console.log('LLM JUDGE SCORES (1-5)');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`Relevance:             ${avgRelevance.toFixed(2)}/5`);
    console.log(`Enrichment Accuracy:   ${avgEnrichmentAccuracy.toFixed(2)}/5`);
    console.log(`Personalization:       ${avgPersonalization.toFixed(2)}/5`);
    console.log(`Diversity:             ${avgDiversity.toFixed(2)}/5`);
    console.log(`Overall:               ${avgOverall.toFixed(2)}/5`);

    // Issues summary
    const allIssues = evaluations.flatMap(e => e.issues);
    if (allIssues.length > 0) {
        console.log('\nISSUES FOUND');
        console.log('───────────────────────────────────────────────────────────');
        const issueCounts: Record<string, number> = {};
        for (const issue of allIssues) {
            const key = issue.substring(0, 50);
            issueCounts[key] = (issueCounts[key] || 0) + 1;
        }
        for (const [issue, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
            console.log(`  [${count}x] ${issue}`);
        }
    }

    // Per-domain breakdown
    console.log('\nBY DOMAIN');
    console.log('───────────────────────────────────────────────────────────');
    const domains = ['places', 'movies', 'music', 'general'];
    for (const domain of domains) {
        const domainEvals = successful.filter(e => e.domain === domain);
        if (domainEvals.length > 0) {
            const domainAvg = domainEvals.reduce((sum, e) => sum + e.llmScore.overall, 0) / domainEvals.length;
            const domainVerify = domainEvals.reduce((sum, e) => sum + e.verificationRate, 0) / domainEvals.length;
            console.log(`${domain.padEnd(12)} ${domainAvg.toFixed(2)}/5  (${(domainVerify * 100).toFixed(0)}% verified)`);
        }
    }

    // Bottom performers
    const sorted = [...successful].sort((a, b) => a.llmScore.overall - b.llmScore.overall);
    if (sorted.length > 0) {
        console.log('\nLOWEST SCORING QUERIES');
        console.log('───────────────────────────────────────────────────────────');
        for (const e of sorted.slice(0, 3)) {
            console.log(`  [${e.llmScore.overall}/5] "${e.query}"`);
            if (e.issues.length > 0) {
                console.log(`         Issues: ${e.issues[0]}`);
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Save full results to file
    const fs = require('fs');
    const outputPath = `eval-results-${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(evaluations, null, 2));
    console.log(`Full results saved to: ${outputPath}`);
}

// Run if called directly
runEvaluation().catch(console.error);
