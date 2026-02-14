/**
 * News Search Module
 * 
 * Search-first news pipeline using NewsMesh + NewsAPI + Exa in parallel.
 * Used by TwoStageGenerator.runNewsSearch() to bypass LLM candidate generation.
 * 
 * Features:
 * - Query mode classification (survey/thematic/deep)
 * - Parallel NewsMesh + NewsAPI + Exa search
 * - Diffbot content extraction with self-updating blocklist
 * - 273-source curated registry with tier/region/paywall metadata
 * - Mode-adaptive diversity scoring
 * - Topic clustering for summary cross-referencing
 * - Quality filters: Exa snippet minimum, nav junk detection
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Stage1aCandidate } from './stage-1a-prompt.js';
import { CURATED_SOURCES, SOURCE_NAME_TO_DOMAIN } from './curated-sources.js';
import { SourceTracker } from './source-tracker.js';
import { SourceDiscovery } from './source-discovery.js';
import { DiffbotCache } from './diffbot-cache.js';

// ============================================================================
// Types
// ============================================================================

export type NewsMode = 'survey' | 'thematic' | 'deep';

export interface SourceEntry {
    displayName: string;
    tier: 1 | 2 | 3;
    region: string;
    paywall: 'free' | 'metered' | 'hard';
    specialty?: string;
}

export interface RawNewsArticle {
    title: string;
    author?: string;
    publishedAt?: string;
    sourceDisplayName: string;
    sourceDomain: string;
    sourceTier: number;
    sourceRegion: string;
    paywall: 'free' | 'metered' | 'hard';
    articleType: 'reporting' | 'analysis' | 'opinion' | 'investigation' | 'explainer';
    imageUrl?: string;
    url: string;
    snippet?: string;
    wordCount?: number;
    readingTimeMinutes?: number;
    apiSource: 'exa' | 'newsmesh';
    isLive?: boolean;
}

export interface ArticleCluster {
    articles: RawNewsArticle[];
    keywords: Set<string>;
}

export interface NewsSearchResult {
    mode: NewsMode;
    candidates: Stage1aCandidate[];
    clusters: ArticleCluster[];
}

// ============================================================================
// Source Registry (hand-tuned overrides + 273-source curated expansion)
// ============================================================================

/** Hand-tuned overrides — these take precedence over CURATED_SOURCES */
const SOURCE_OVERRIDES: Record<string, SourceEntry> = {
    // Tier 1: Wire services + papers of record
    'reuters.com': { displayName: 'Reuters', tier: 1, region: 'Wire', paywall: 'free' },
    'apnews.com': { displayName: 'AP News', tier: 1, region: 'Wire', paywall: 'free' },
    'bbc.com': { displayName: 'BBC News', tier: 1, region: 'UK', paywall: 'free' },
    'bbc.co.uk': { displayName: 'BBC News', tier: 1, region: 'UK', paywall: 'free' },
    'nytimes.com': { displayName: 'The New York Times', tier: 1, region: 'US', paywall: 'hard' },
    'washingtonpost.com': { displayName: 'Washington Post', tier: 1, region: 'US', paywall: 'hard' },
    'wsj.com': { displayName: 'Wall Street Journal', tier: 1, region: 'US', paywall: 'hard' },
    'theguardian.com': { displayName: 'The Guardian', tier: 1, region: 'UK', paywall: 'free' },
    'ft.com': { displayName: 'Financial Times', tier: 1, region: 'UK', paywall: 'hard' },
    'economist.com': { displayName: 'The Economist', tier: 1, region: 'UK', paywall: 'hard' },
    'nature.com': { displayName: 'Nature', tier: 1, region: 'Global', paywall: 'metered' },
    'science.org': { displayName: 'Science', tier: 1, region: 'Global', paywall: 'metered' },

    // Tier 2: Respected specialist + quality national
    'wired.com': { displayName: 'Wired', tier: 2, region: 'US', paywall: 'metered', specialty: 'tech' },
    'arstechnica.com': { displayName: 'Ars Technica', tier: 2, region: 'US', paywall: 'free', specialty: 'tech' },
    'technologyreview.com': { displayName: 'MIT Tech Review', tier: 2, region: 'US', paywall: 'metered', specialty: 'tech' },
    'theatlantic.com': { displayName: 'The Atlantic', tier: 2, region: 'US', paywall: 'hard' },
    'newyorker.com': { displayName: 'The New Yorker', tier: 2, region: 'US', paywall: 'hard' },
    'propublica.org': { displayName: 'ProPublica', tier: 2, region: 'US', paywall: 'free' },
    'bloomberg.com': { displayName: 'Bloomberg', tier: 2, region: 'US', paywall: 'hard', specialty: 'finance' },
    'cnbc.com': { displayName: 'CNBC', tier: 2, region: 'US', paywall: 'free', specialty: 'finance' },
    'cnn.com': { displayName: 'CNN', tier: 2, region: 'US', paywall: 'free' },
    'cbsnews.com': { displayName: 'CBS News', tier: 2, region: 'US', paywall: 'free' },
    'abcnews.go.com': { displayName: 'ABC News', tier: 2, region: 'US', paywall: 'free' },
    'nbcnews.com': { displayName: 'NBC News', tier: 2, region: 'US', paywall: 'free' },
    'techcrunch.com': { displayName: 'TechCrunch', tier: 2, region: 'US', paywall: 'free', specialty: 'tech' },
    'theverge.com': { displayName: 'The Verge', tier: 2, region: 'US', paywall: 'free', specialty: 'tech' },
    'politico.com': { displayName: 'Politico', tier: 2, region: 'US', paywall: 'free', specialty: 'politics' },
    'politico.eu': { displayName: 'Politico EU', tier: 2, region: 'EU', paywall: 'free', specialty: 'politics' },
    'axios.com': { displayName: 'Axios', tier: 2, region: 'US', paywall: 'free' },
    'npr.org': { displayName: 'NPR', tier: 2, region: 'US', paywall: 'free' },
    'foreignaffairs.com': { displayName: 'Foreign Affairs', tier: 2, region: 'US', paywall: 'hard', specialty: 'geopolitics' },
    'foreignpolicy.com': { displayName: 'Foreign Policy', tier: 2, region: 'US', paywall: 'metered', specialty: 'geopolitics' },
    'aljazeera.com': { displayName: 'Al Jazeera', tier: 2, region: 'MENA', paywall: 'free' },
    'scmp.com': { displayName: 'South China Morning Post', tier: 2, region: 'Asia', paywall: 'metered' },
    'lemonde.fr': { displayName: 'Le Monde', tier: 2, region: 'EU', paywall: 'metered' },
    'time.com': { displayName: 'Time', tier: 2, region: 'US', paywall: 'metered' },
    'usatoday.com': { displayName: 'USA Today', tier: 2, region: 'US', paywall: 'free' },

    // Tier 3: Good regional/niche
    'salon.com': { displayName: 'Salon', tier: 3, region: 'US', paywall: 'free' },
    'slate.com': { displayName: 'Slate', tier: 3, region: 'US', paywall: 'free' },
    'vox.com': { displayName: 'Vox', tier: 3, region: 'US', paywall: 'free' },
    'zdnet.com': { displayName: 'ZDNet', tier: 3, region: 'US', paywall: 'free', specialty: 'tech' },
    'venturebeat.com': { displayName: 'VentureBeat', tier: 3, region: 'US', paywall: 'free', specialty: 'tech' },
    'defenseone.com': { displayName: 'Defense One', tier: 3, region: 'US', paywall: 'free', specialty: 'defense' },
    'theintercept.com': { displayName: 'The Intercept', tier: 3, region: 'US', paywall: 'free' },
    'sfchronicle.com': { displayName: 'San Francisco Chronicle', tier: 3, region: 'US', paywall: 'metered' },
    'latimes.com': { displayName: 'Los Angeles Times', tier: 3, region: 'US', paywall: 'hard' },
    'thehill.com': { displayName: 'The Hill', tier: 3, region: 'US', paywall: 'free', specialty: 'politics' },
    'yahoo.com': { displayName: 'Yahoo News', tier: 3, region: 'US', paywall: 'free' },
};

/** Merged registry: curated CSV sources + hand-tuned overrides */
export const SOURCE_REGISTRY: Record<string, SourceEntry> = {
    ...CURATED_SOURCES,  // 260 domains from user's 273-source CSV
    ...SOURCE_OVERRIDES, // Hand-tuned overrides take precedence
};

// ============================================================================
// News Search Engine
// ============================================================================

export class NewsSearchEngine {
    private genAI: GoogleGenerativeAI;
    private model: string;
    private exaApiKey: string;
    private newsMeshApiKey: string;
    private diffbotToken: string;
    private curatedDomains: string[];

    // Source quality tracking + discovery + caching
    private tracker: SourceTracker;
    private discovery: SourceDiscovery;
    private diffbotCache: DiffbotCache;

    // Canonical domain mapping — variant TLDs → canonical form
    private static readonly DOMAIN_CANONICALS: Record<string, string> = {
        'bbc.co.uk': 'bbc.com',
        'theguardian.co.uk': 'theguardian.com',
        'nytimes.co.uk': 'nytimes.com',
        'washingtonpost.co.uk': 'washingtonpost.com',
        'finance.yahoo.com': 'yahoo.com',
        'news.yahoo.com': 'yahoo.com',
    };

    // International source countries for NewsMesh diversity queries
    private static readonly INTL_SOURCE_COUNTRIES = 'gb,fr,de,au,jp,in,ng,br,ae,kr,il,za,ca,it,sg';

    constructor(genAI: GoogleGenerativeAI, model: string) {
        this.genAI = genAI;
        this.model = model;
        this.exaApiKey = process.env.EXA_API_KEY || '';
        this.newsMeshApiKey = process.env.NEWSMESH_KEY || '';
        this.diffbotToken = process.env.DIFFBOT_TOKEN || '';
        this.curatedDomains = Object.keys(SOURCE_REGISTRY);

        // Initialize tracker + discovery + cache
        this.tracker = new SourceTracker();
        this.discovery = new SourceDiscovery();
        this.diffbotCache = new DiffbotCache();

        // Merge any previously discovered sources into registry
        const discovered = this.discovery.getDiscoveredSources();
        for (const [domain, entry] of Object.entries(discovered)) {
            if (!SOURCE_REGISTRY[domain]) {
                SOURCE_REGISTRY[domain] = entry;
            }
        }

        // Run monthly maintenance if due
        this.tracker.runMaintenance();

        const summary = this.tracker.getSummary();
        console.log(`[NewsSearch] Tracker: ${summary.active} active, ${summary.probation} probation, ${summary.blocked} blocked (${summary.total} tracked)`);
    }

    /**
     * Normalize domain variants to a canonical form.
     * e.g., bbc.co.uk → bbc.com
     */
    private canonicalOutlet(domain: string): string {
        return NewsSearchEngine.DOMAIN_CANONICALS[domain] || domain;
    }

    /**
     * Full news search pipeline:
     * 1. Classify query mode, temporal recency, and expand into search queries
     * 2. Search Exa + NewsAPI in parallel (with date windowing)
     * 3. Deduplicate
     * 4. LLM relevance filter (fast — drops off-topic, garbage titles, listing pages)
     * 5. Score, select, cluster
     * 6. Return as Stage1aCandidates with pre-attached enrichment
     */
    async search(queryText: string, maxResults: number): Promise<NewsSearchResult> {
        console.log(`[NewsSearch] Starting search for: "${queryText}"`);
        this.diffbotCache.resetStats();

        // Step 1: Classify mode, recency, and expand queries
        const { mode, recency, queries, facets } = await this.classifyAndExpand(queryText);
        console.log(`[NewsSearch] Mode: ${mode}, Recency: ${recency}, Facets: ${facets.length}`);

        // Step 2: Parallel search across both APIs (date window from recency)
        const dateWindowDays = recency === 'breaking' ? 2 : recency === 'recent' ? 7 : 30;
        const rawArticles = await this.parallelSearch(queries, facets, mode, dateWindowDays);

        // Step 3: Deduplicate
        const deduped = this.deduplicateArticles(rawArticles);
        console.log(`[NewsSearch] After dedup: ${deduped.length} unique articles`);

        // Step 4: LLM relevance filter — drops off-topic, garbage, and listing content
        const filtered = await this.filterByRelevance(deduped, queryText);
        console.log(`[NewsSearch] After relevance filter: ${filtered.length}/${deduped.length} kept`);

        // Step 4b: If too few results after filtering, widen the date window and retry
        if (filtered.length < 10 && dateWindowDays < 30) {
            console.log('[NewsSearch] Yield too low after filter, widening date window...');
            const widerArticles = await this.parallelSearch(queries.slice(0, 2), facets.slice(0, 2), mode, 30);
            const widerDeduped = this.deduplicateArticles([...filtered, ...widerArticles]);
            const widerFiltered = await this.filterByRelevance(widerDeduped, queryText);
            filtered.splice(0, filtered.length, ...widerFiltered);
            console.log(`[NewsSearch] After wider pass: ${filtered.length} articles`);
        }

        // Step 5: Mode-adaptive scoring + selection
        const selected = this.selectArticles(filtered, mode, maxResults);

        // Step 6: Topic clustering (for summary cross-referencing)
        const clusters = this.clusterByTopic(selected);

        // Step 7: Convert to Stage1aCandidates with pre-attached enrichment
        const candidates = this.toCandidates(selected);

        console.log(`[NewsSearch] Final: ${candidates.length} candidates, ${clusters.length} topic clusters`);

        // Fire-and-forget: run discovery pipeline in background
        this.runDiscovery().catch(() => { });
        this.discovery.save();

        return { mode, candidates, clusters };
    }

    // ---- Step 1: Mode classification + temporal recency + query expansion ----

    private static readonly NEWSMESH_CATEGORIES = [
        'politics', 'technology', 'business', 'health',
        'entertainment', 'sports', 'science', 'lifestyle',
        'environment', 'world',
    ];

    private async classifyAndExpand(queryText: string): Promise<{
        mode: NewsMode;
        recency: 'breaking' | 'recent' | 'general';
        queries: string[];
        facets: { query: string; category?: string; country?: string }[];
    }> {
        const prompt = `Classify this news query and generate 4 FACETED search queries. Each facet gets a query AND a category filter to guarantee diversity.

Query: "${queryText}"

MODES:
- SURVEY: broad coverage across DIFFERENT topics ("what's happening", "news in [place]", "today's headlines")
- THEMATIC: coverage within one topic AREA ("climate", "tech", "economic" trends)
- DEEP: multiple perspectives on ONE specific issue ("takes on", "analysis of", specific event)

RECENCY:
- BREAKING: "today", "right now", "latest" → last 2 days
- RECENT: "this week", "updates", ongoing story → last 7 days
- GENERAL: no temporal signal, wants analysis → up to 30 days

AVAILABLE CATEGORIES (pick one per facet):
politics, technology, business, health, entertainment, sports, science, lifestyle, environment, world

RULES:
1. Generate exactly 4 facets, each with a DIFFERENT category
2. Keep queries SHORT: 2-4 words max. The category filter handles topic scoping, so queries just need the core concept
3. If query mentions a specific country/region, add its ISO 3166-1 alpha-2 "country" code
4. Each facet's query+category pair should find different articles than the others

EXAMPLES:

"important news in the world today" → survey + breaking
  facets: [
    { "query": "government policy", "category": "politics" },
    { "query": "trade economy", "category": "business" },
    { "query": "conflict diplomacy", "category": "world" },
    { "query": "AI technology", "category": "technology" }
  ]

"climate change policy updates" → thematic + recent
  facets: [
    { "query": "climate change", "category": "environment" },
    { "query": "renewable energy", "category": "business" },
    { "query": "climate agreements", "category": "politics" },
    { "query": "climate health", "category": "science" }
  ]

"what's happening in Greece today" → survey + breaking
  facets: [
    { "query": "Greece government", "category": "politics", "country": "gr" },
    { "query": "Greece economy", "category": "business", "country": "gr" },
    { "query": "Greece migration", "category": "world", "country": "gr" },
    { "query": "Greece tourism", "category": "lifestyle", "country": "gr" }
  ]

"opinions on social media regulation" → deep + general
  facets: [
    { "query": "social media regulation", "category": "politics" },
    { "query": "online safety", "category": "technology" },
    { "query": "social media antitrust", "category": "business" },
    { "query": "content moderation", "category": "world" }
  ]

BAD: queries longer than 4 words, using the same category twice, or rephrased duplicates.

Return JSON: { "mode": "survey"|"thematic"|"deep", "recency": "breaking"|"recent"|"general", "facets": [{ "query": "...", "category": "...", "country?": "..." }, ...] }`;


        try {
            const model = this.genAI.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.3,
                },
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const parsed = JSON.parse(text);

            const mode = ['survey', 'thematic', 'deep'].includes(parsed.mode)
                ? parsed.mode as NewsMode
                : 'thematic';
            const recency = ['breaking', 'recent', 'general'].includes(parsed.recency)
                ? parsed.recency as 'breaking' | 'recent' | 'general'
                : 'general';

            // Parse facets (new format) with fallback to old queries format
            let facets: { query: string; category?: string; country?: string }[] = [];
            if (Array.isArray(parsed.facets)) {
                facets = parsed.facets
                    .filter((f: any) => f && typeof f.query === 'string' && f.query.length > 3)
                    .map((f: any) => ({
                        query: f.query,
                        category: NewsSearchEngine.NEWSMESH_CATEGORIES.includes(f.category) ? f.category : undefined,
                        country: typeof f.country === 'string' && f.country.length === 2 ? f.country.toLowerCase() : undefined,
                    }));
            } else if (Array.isArray(parsed.queries)) {
                // Fallback: old format without categories
                facets = parsed.queries
                    .filter((q: any) => typeof q === 'string' && q.length > 3)
                    .map((q: string) => ({ query: q }));
            }

            // Ensure at least 4 facets — pad with original query if LLM returned fewer
            while (facets.length < 4) facets.push({ query: queryText });

            // Extract plain queries for Exa (which doesn't use categories)
            const queries = facets.map(f => f.query);

            console.log(`[NewsSearch] Facets: ${facets.map(f => `[${f.category || '?'}${f.country ? ':' + f.country : ''}] "${f.query.substring(0, 40)}"`).join(', ')}`);

            return { mode, recency, queries, facets };
        } catch (error) {
            console.error('[NewsSearch] Classification error, defaulting to thematic:', error);
            return {
                mode: 'thematic',
                recency: 'general',
                queries: [queryText],
                facets: [{ query: queryText }],
            };
        }
    }

    // ---- Step 4: LLM relevance filter ----

    /**
     * Ultra-fast LLM pass: drops clearly off-topic articles.
     * Compressed prompt + drop-only output → targets ~700ms.
     */
    private async filterByRelevance(
        articles: RawNewsArticle[],
        queryText: string
    ): Promise<RawNewsArticle[]> {
        if (articles.length === 0) return [];

        const titleList = articles.map((a, i) =>
            `${i + 1}. ${a.title}`
        ).join('\n');

        const prompt = `Query: "${queryText}"\n\n${titleList}\n\nWhich articles are clearly OFF-TOPIC? Err toward keeping. Return JSON: {"drop":[ids]}`;

        try {
            const model = this.genAI.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                    maxOutputTokens: 60,
                },
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const parsed = JSON.parse(text);

            const dropIds = new Set<number>(
                Array.isArray(parsed.drop)
                    ? parsed.drop.map(Number).filter((n: number) => !isNaN(n))
                    : []
            );

            if (dropIds.size > 0) {
                for (const id of dropIds) {
                    const a = articles[id - 1];
                    if (a) console.log(`[NewsSearch:Filter] Dropping #${id} "${a.title?.substring(0, 50)}"`);
                }
            }

            return articles.filter((_, i) => !dropIds.has(i + 1));
        } catch (error) {
            console.warn('[NewsSearch:Filter] LLM filter error, keeping all:', error);
            return articles;
        }
    }

    // ---- Step 2: Parallel search (complementary strategy) ----

    /**
     * Primary: NewsMesh (URL discovery) → Diffbot (content extraction)
     * Supplementary: Exa (2 queries for niche/international diversity)
     * Both run in parallel for zero latency increase.
     */
    private async parallelSearch(queries: string[], facets: { query: string; category?: string; country?: string }[], mode: NewsMode, dateWindowDays: number): Promise<RawNewsArticle[]> {
        // Deep mode leans more on Exa (NewsMesh struggles with niche opinion queries)
        const maxExaQueries = mode === 'deep' ? 3 : 2;
        const exaQueries = queries.slice(0, maxExaQueries);

        const [newsMeshRaw, exaResults] = await Promise.allSettled([
            this.searchNewsMesh(facets, mode, dateWindowDays),
            this.searchExa(exaQueries, dateWindowDays),
        ]);

        const newsMesh = newsMeshRaw.status === 'fulfilled' ? newsMeshRaw.value : [];
        const exaRaw = exaResults.status === 'fulfilled' ? exaResults.value : [];

        // --- Quality Filter 1: Exa minimum snippet + nav junk detection ---
        // Survey mode uses a higher threshold; thematic+deep use lower since analytical content is valuable
        const minSnippetLen = mode === 'survey' ? 325 : 200;
        const exa: RawNewsArticle[] = [];
        for (const a of exaRaw) {
            const len = a.snippet?.length || 0;
            if (len < minSnippetLen || this.isNavJunk(a.snippet || '')) {
                this.tracker.record(a.sourceDomain, 'junk');
                continue;
            }
            this.tracker.record(a.sourceDomain, 'success');
            exa.push(a);
        }
        if (exaRaw.length > exa.length) {
            console.log(`[NewsSearch] Exa quality filter: kept ${exa.length}/${exaRaw.length} (≥${minSnippetLen} chars, no nav junk)`);
        }

        // NewsMesh → Diffbot enrichment
        const enriched = await this.diffbotEnrichArticles(newsMesh);

        // --- Quality Filter 2: NewsMesh requires Diffbot enrichment ---
        const shipped = enriched.filter(a => (a.snippet?.length || 0) >= 325);
        const droppedNewsMesh = enriched.length - shipped.length;
        if (droppedNewsMesh > 0) {
            console.log(`[NewsSearch] Dropped ${droppedNewsMesh} unenriched NewsMesh articles`);
        }

        const diffbotCount = shipped.filter(a => a.snippet && a.snippet.length > 200).length;
        console.log(`[NewsSearch] Raw: ${exa.length} Exa + ${newsMesh.length} NewsMesh (${diffbotCount} Diffbot-enriched) (window: ${dateWindowDays}d)`);
        return [...shipped, ...exa];
    }

    /**
     * Exa: Broad neural search (no domain filter).
     * Neural search naturally finds articles, not sections.
     * Non-curated sources score lower in tier scoring.
     */
    private async searchExa(queries: string[], dateWindowDays = 30): Promise<RawNewsArticle[]> {
        if (!this.exaApiKey) {
            console.log('[NewsSearch:Exa] No API key configured');
            return [];
        }

        const startDate = new Date(Date.now() - dateWindowDays * 24 * 60 * 60 * 1000).toISOString();

        const promises = queries.map(async (query): Promise<RawNewsArticle[]> => {
            try {
                const body: Record<string, unknown> = {
                    query,
                    type: 'neural',            // neural finds content, not homepages
                    category: 'news',
                    numResults: 7,             // supplementary neural search
                    startPublishedDate: startDate,
                    contents: {
                        text: { maxCharacters: 1500 },
                        highlights: { numSentences: 3 },
                    },
                    // NO includeDomains — let neural search find the best articles
                };

                const response = await fetch('https://api.exa.ai/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': this.exaApiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    console.warn(`[NewsSearch:Exa] API error ${response.status} for "${query}"`);
                    return [];
                }

                const data = await response.json() as any;
                return (data.results || []).map((r: any) => this.exaToArticle(r));
            } catch (error) {
                console.warn(`[NewsSearch:Exa] Error for "${query}":`, error);
                return [];
            }
        });

        const results = await Promise.all(promises);
        return results.flat();
    }

    /**
     * NewsMesh: Primary news search.
     * For SURVEY mode, uses /trending (curated feed, fast).
     * For other modes, uses /search with keyword queries.
     */
    private async searchNewsMesh(facets: { query: string; category?: string; country?: string }[], mode: NewsMode, dateWindowDays = 30): Promise<RawNewsArticle[]> {
        if (!this.newsMeshApiKey) {
            console.log('[NewsSearch:NewsMesh] No API key configured');
            return [];
        }

        // SURVEY: trending + international /latest + faceted search
        if (mode === 'survey') {
            const [trending, international, searched] = await Promise.all([
                this.searchNewsMeshTrending(),
                this.searchNewsMeshLatest(['world', 'politics', 'business'], NewsSearchEngine.INTL_SOURCE_COUNTRIES),
                this.searchNewsMeshFacets(facets, dateWindowDays),
            ]);
            return [...trending, ...international, ...searched];
        }

        // THEMATIC/DEEP: faceted /search with category filters
        return this.searchNewsMeshFacets(facets, dateWindowDays);
    }

    /**
     * NewsMesh faceted search: each facet gets its own /search call with category + country filters.
     * Last facet uses sortBy=date for recency diversity.
     */
    private async searchNewsMeshFacets(facets: { query: string; category?: string; country?: string }[], dateWindowDays: number): Promise<RawNewsArticle[]> {
        const fromDate = new Date(Date.now() - dateWindowDays * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];

        const promises = facets.map(async (facet, idx): Promise<RawNewsArticle[]> => {
            try {
                const isLastFacet = idx === facets.length - 1;
                const params = new URLSearchParams({
                    apiKey: this.newsMeshApiKey,
                    q: facet.query,
                    limit: '25',
                    sortBy: isLastFacet ? 'date' : 'relevant',
                    from: fromDate,
                });

                // Add category filter if available
                if (facet.category) params.set('category', facet.category);

                // Add country filter if available (content relevance)
                if (facet.country) params.set('country', facet.country);

                // Force international sources on the last facet
                if (isLastFacet && !facet.country) {
                    params.set('sourceCountry', NewsSearchEngine.INTL_SOURCE_COUNTRIES);
                }

                const response = await fetch(
                    `https://api.newsmesh.co/v1/search?${params.toString()}`,
                    { signal: AbortSignal.timeout(5000) }
                );

                if (!response.ok) {
                    console.warn(`[NewsSearch:NewsMesh] API error ${response.status} for "${facet.query}"`);
                    return [];
                }

                const data = await response.json() as any;
                return (data.data || []).map((a: any) => this.newsMeshToArticle(a));
            } catch (error: any) {
                console.warn(`[NewsSearch:NewsMesh] ${error.name === 'TimeoutError' ? 'Timeout' : 'Error'} for "${facet.query}"`);
                return [];
            }
        });

        const results = await Promise.all(promises);
        return results.flat();
    }

    /**
     * NewsMesh /trending: curated trending feed.
     * Used for SURVEY mode — cached and fast.
     */
    private async searchNewsMeshTrending(): Promise<RawNewsArticle[]> {
        try {
            const params = new URLSearchParams({
                apiKey: this.newsMeshApiKey,
                limit: '25',
            });

            const response = await fetch(
                `https://api.newsmesh.co/v1/trending?${params.toString()}`,
                { signal: AbortSignal.timeout(5000) }
            );

            if (!response.ok) {
                console.warn(`[NewsSearch:NewsMesh] Trending error ${response.status}`);
                return [];
            }

            const data = await response.json() as any;
            return (data.data || []).map((a: any) => this.newsMeshToArticle(a));
        } catch (error: any) {
            console.warn(`[NewsSearch:NewsMesh] Trending ${error.name === 'TimeoutError' ? 'timeout' : 'error'}:`, error.message);
            return [];
        }
    }

    /**
     * NewsMesh /latest: latest articles filtered by category and source country.
     * Used alongside /trending in survey mode for international diversity.
     */
    private async searchNewsMeshLatest(categories: string[], sourceCountry: string): Promise<RawNewsArticle[]> {
        try {
            const params = new URLSearchParams({
                apiKey: this.newsMeshApiKey,
                limit: '25',
                category: categories.join(','),
                sourceCountry,
            });

            const response = await fetch(
                `https://api.newsmesh.co/v1/latest?${params.toString()}`,
                { signal: AbortSignal.timeout(5000) }
            );

            if (!response.ok) {
                console.warn(`[NewsSearch:NewsMesh] Latest (intl) error ${response.status}`);
                return [];
            }

            const data = await response.json() as any;
            return (data.data || []).map((a: any) => this.newsMeshToArticle(a));
        } catch (error: any) {
            console.warn(`[NewsSearch:NewsMesh] Latest (intl) ${error.name === 'TimeoutError' ? 'timeout' : 'error'}:`, error.message);
            return [];
        }
    }

    // NewsAPI retired — NewsMesh provides superior coverage with better descriptions

    // ---- Step 3: Deduplication ----

    private deduplicateArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
        const seen = new Map<string, RawNewsArticle>();
        // Pre-compute tokenized titles for O(n²) Dice comparison
        const tokenCache = new Map<string, Set<string>>();

        for (const article of articles) {
            if (!article.title || article.title.length < 10) continue;

            // Normalize WaPo syndication URLs
            if (article.url.includes('syndication.washingtonpost.com')) {
                console.log(`[NewsSearch] Skipping WaPo syndication URL: ${article.url}`);
                continue;
            }

            // Shallow URL check: must have at least 2 path segments
            try {
                const pathname = new URL(article.url).pathname;
                const segments = pathname.split('/').filter(Boolean);
                if (segments.length < 2) {
                    console.log(`[NewsSearch] Skipping shallow URL: ${article.url}`);
                    continue;
                }
            } catch {
                continue;
            }

            // Flag live/dynamic URLs
            if (article.url.includes('/live/') || article.url.includes('live-updates')
                || article.url.includes('/liveblog/')) {
                article.isLive = true;
            }

            // Exact URL dedup
            const urlKey = article.url.replace(/[?#].*$/, '').toLowerCase();
            if (seen.has(urlKey)) {
                if (article.apiSource === 'exa') seen.set(urlKey, article);
                continue;
            }

            // Title similarity dedup — cross-outlet syndication detection via Sørensen–Dice
            const titleTokens = this.tokenize(article.title);
            const canonical = this.canonicalOutlet(article.sourceDomain);
            let isDuplicate = false;
            for (const [existingUrl, existing] of seen) {
                const existingTokens = tokenCache.get(existingUrl);
                if (!existingTokens) continue;
                const dice = this.diceCoefficient(titleTokens, existingTokens);
                // Same outlet: lower threshold (catches reformatted headlines)
                // Cross-outlet: higher threshold (avoids false positives on similar topics)
                const existingCanonical = this.canonicalOutlet(existing.sourceDomain);
                const threshold = existingCanonical === canonical ? 0.6 : 0.7;
                if (dice >= threshold) {
                    isDuplicate = true;
                    // Keep the higher-tier or richer version
                    if (article.sourceTier > existing.sourceTier ||
                        (article.apiSource === 'exa' && (article.snippet?.length || 0) > (existing.snippet?.length || 0))) {
                        seen.delete(existingUrl);
                        tokenCache.delete(existingUrl);
                        isDuplicate = false; // Allow this one through
                    }
                    break;
                }
            }

            if (!isDuplicate) {
                seen.set(urlKey, article);
                tokenCache.set(urlKey, titleTokens);
            }
        }

        return Array.from(seen.values());
    }

    // ---- Step 5: Mode-adaptive scoring ----

    private selectArticles(
        articles: RawNewsArticle[],
        mode: NewsMode,
        maxResults: number
    ): RawNewsArticle[] {
        if (articles.length === 0) return [];

        // Score each article
        const scored = articles.map(article => ({
            article,
            baseScore: this.scoreArticle(article),
        }));

        // Sort by base score descending
        scored.sort((a, b) => b.baseScore - a.baseScore);

        // Hard outlet caps per mode
        const OUTLET_CAPS: Record<NewsMode, number> = {
            survey: 1,    // Max topic diversity: one article per outlet
            thematic: 2,  // Allow subtopic variation within same outlet
            deep: 1,      // Max perspective diversity: one per outlet
        };
        const outletCap = OUTLET_CAPS[mode];

        // Greedy selection with diversity tracking
        const selected: RawNewsArticle[] = [];
        const outletCounts = new Map<string, number>();
        const seenRegions = new Set<string>();
        const seenTopicWords = new Set<string>();

        for (const { article, baseScore } of scored) {
            if (selected.length >= maxResults) break;

            // Hard outlet cap — skip if this outlet has hit its limit
            const canonical = this.canonicalOutlet(article.sourceDomain);
            const currentCount = outletCounts.get(canonical) || 0;
            if (currentCount >= outletCap) continue;

            let diversityBonus = 0;

            if (mode === 'survey') {
                const topicWords = this.extractTopicWords(article.title);
                const newWords = topicWords.filter(w => !seenTopicWords.has(w));
                const isNewTopic = newWords.length > topicWords.length * 0.5;
                diversityBonus = isNewTopic ? 2 : -1;
            } else if (mode === 'thematic') {
                diversityBonus = currentCount === 0 ? 1 : 0;
                if (!seenRegions.has(article.sourceRegion)) diversityBonus += 0.5;
            } else { // deep
                diversityBonus = currentCount === 0 ? 2 : 0;
                if (!seenRegions.has(article.sourceRegion)) diversityBonus += 1;
            }

            const finalScore = baseScore + diversityBonus;

            // Skip if score is very negative
            if (finalScore < -1 && selected.length >= 3) continue;

            selected.push(article);
            outletCounts.set(canonical, currentCount + 1);
            seenRegions.add(article.sourceRegion);
            this.extractTopicWords(article.title).forEach(w => seenTopicWords.add(w));
        }

        // Second pass: if not enough results, relax caps by 1
        if (selected.length < maxResults && selected.length < articles.length) {
            for (const { article } of scored) {
                if (selected.length >= maxResults) break;
                if (selected.includes(article)) continue;
                const canonical = this.canonicalOutlet(article.sourceDomain);
                const currentCount = outletCounts.get(canonical) || 0;
                if (currentCount >= outletCap + 1) continue;
                selected.push(article);
                outletCounts.set(canonical, currentCount + 1);
            }
        }

        console.log(`[NewsSearch] Selected ${selected.length}/${articles.length} articles (mode: ${mode})`);
        return selected;
    }

    // ---- Step 6: Topic clustering ----

    private clusterByTopic(articles: RawNewsArticle[]): ArticleCluster[] {
        const clusters: ArticleCluster[] = [];

        for (const article of articles) {
            const words = this.extractTopicWords(article.title);
            const matchingCluster = clusters.find(c => {
                const overlap = words.filter(w => c.keywords.has(w)).length;
                return overlap > Math.min(words.length, c.keywords.size) * 0.4;
            });

            if (matchingCluster) {
                matchingCluster.articles.push(article);
                words.forEach(w => matchingCluster.keywords.add(w));
            } else {
                clusters.push({
                    articles: [article],
                    keywords: new Set(words),
                });
            }
        }

        return clusters.filter(c => c.articles.length >= 2);
    }

    // ---- Step 7: Convert to candidates ----

    private toCandidates(articles: RawNewsArticle[]): Stage1aCandidate[] {
        return articles.map(article => ({
            name: article.title,
            identifiers: {
                source: article.sourceDomain,
                date: article.publishedAt || '',
                author: article.author || '',
                url: article.url,
            },
            // Thread snippet content for downstream summary prompt
            search_hint: article.snippet
                ? `${article.title}\n---\n${article.snippet}`
                : article.title,
            enrichment_hooks: ['news_composite'],
            // Store full enrichment data for pass-through
            _newsEnrichment: {
                title: article.title,
                author: article.author,
                publishedAt: article.publishedAt,
                source: article.sourceDisplayName,
                sourceDomain: article.sourceDomain,
                sourceTier: article.sourceTier,
                sourceRegion: article.sourceRegion,
                paywall: article.paywall,
                articleType: article.articleType,
                imageUrl: article.imageUrl,
                url: article.url,
                summary: article.snippet,
                wordCount: article.wordCount,
                readingTimeMinutes: article.readingTimeMinutes,
                isLive: article.isLive || false,
                apiSource: article.apiSource,
            },
        } as Stage1aCandidate & { _newsEnrichment: any }));
    }

    // ---- Conversion helpers ----

    private exaToArticle(result: any): RawNewsArticle {
        const domain = this.extractDomain(result.url || '');
        const source = this.lookupSource(domain);
        const textLength = result.text?.length || 0;
        const wordCount = Math.round(textLength / 5);
        const snippet = result.highlights?.[0]?.replace(/\n/g, ' ').trim()
            || result.text?.substring(0, 300) || '';
        const title = normalizeTitle(result.title || '');

        // Feed unknown domains to discovery pipeline
        if (!source && domain && title) {
            this.recordUnknownSource(domain, title, snippet, result.url || '');
        }

        return {
            title,
            author: result.author || undefined,
            publishedAt: result.publishedDate || undefined,
            sourceDisplayName: source?.displayName || domain,
            sourceDomain: domain,
            sourceTier: source?.tier || 0,
            sourceRegion: source?.region || 'Unknown',
            paywall: source?.paywall || 'free',
            articleType: detectArticleType(result.url || '', result.author, title),
            url: result.url || '',
            snippet,
            wordCount,
            readingTimeMinutes: Math.max(1, Math.round(wordCount / 250)),
            apiSource: 'exa',
        };
    }

    // newsApiToArticle — removed (NewsAPI retired)

    private newsMeshToArticle(article: any): RawNewsArticle {
        const url = article.link || '';
        const domain = this.extractDomain(url);
        // Try domain lookup first, then fall back to name-based lookup
        const source = this.lookupSource(domain) || this.lookupSourceByName(article.source || '');
        const title = normalizeTitle(article.title || '');
        const author = Array.isArray(article.author) ? article.author[0] : article.author;

        // Feed unknown domains to discovery pipeline
        if (!source && domain && title) {
            this.recordUnknownSource(domain, title, article.description || '', url);
        }

        return {
            title,
            author: author || undefined,
            publishedAt: article.published_date || undefined,
            sourceDisplayName: source?.displayName || article.source || domain,
            sourceDomain: domain,
            sourceTier: source?.tier || 0,
            sourceRegion: source?.region || 'Unknown',
            paywall: source?.paywall || 'free',
            articleType: detectArticleType(url, author, title),
            imageUrl: article.media_url || undefined,
            url,
            snippet: article.description || '',
            apiSource: 'newsmesh',
        };
    }

    // ---- Scoring / utility helpers ----

    private scoreArticle(article: RawNewsArticle): number {
        let score = 0;
        score += article.sourceTier === 1 ? 3 : article.sourceTier === 2 ? 2 : article.sourceTier === 3 ? 1 : 0;
        score += article.paywall === 'free' ? 2 : article.paywall === 'metered' ? 1 : 0;
        if (article.publishedAt) {
            const hoursOld = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
            score += hoursOld < 24 ? 1 : hoursOld < 168 ? 0.5 : 0;
        }
        // Apply tracker penalty (probation: -1, blocked: -5)
        score += this.tracker.scorePenalty(article.sourceDomain);
        return score;
    }

    /**
     * Tokenize a title into a set of lowercase words (≥3 chars), stripping
     * punctuation and normalizing common variations (U.S. → us, etc.)
     */
    private tokenize(title: string): Set<string> {
        return new Set(
            title.toLowerCase()
                .replace(/u\.s\./g, 'us')   // U.S. → us
                .replace(/[^a-z0-9\s]/g, '') // strip punctuation
                .split(/\s+/)
                .filter(w => w.length >= 3)
        );
    }

    /**
     * Sørensen–Dice coefficient: 2 × |A ∩ B| / (|A| + |B|)
     * Returns 0–1 where 1 = identical token sets.
     */
    private diceCoefficient(a: Set<string>, b: Set<string>): number {
        if (a.size === 0 || b.size === 0) return 0;
        let intersection = 0;
        // Iterate the smaller set for efficiency
        const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
        for (const w of smaller) {
            if (larger.has(w)) intersection++;
        }
        return (2 * intersection) / (a.size + b.size);
    }

    private extractTopicWords(title: string): string[] {
        const STOP_WORDS = new Set([
            'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
            'her', 'was', 'one', 'our', 'out', 'has', 'have', 'from', 'that', 'this',
            'with', 'what', 'how', 'why', 'who', 'when', 'where', 'about', 'into',
            'will', 'been', 'more', 'than', 'them', 'then', 'some', 'very', 'new',
            'says', 'could', 'would', 'should', 'just', 'like', 'over', 'also',
        ]);
        return title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    }

    private extractDomain(url: string): string {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch { return ''; }
    }

    private lookupSource(domain: string): SourceEntry | undefined {
        if (SOURCE_REGISTRY[domain]) return SOURCE_REGISTRY[domain];
        const parts = domain.split('.');
        if (parts.length > 2) {
            const parent = parts.slice(-2).join('.');
            if (SOURCE_REGISTRY[parent]) return SOURCE_REGISTRY[parent];
            const parent3 = parts.slice(-3).join('.');
            if (SOURCE_REGISTRY[parent3]) return SOURCE_REGISTRY[parent3];
        }
        return undefined;
    }

    /**
     * Record an unknown domain for eventual LLM evaluation.
     * Called when lookupSource returns undefined.
     */
    private recordUnknownSource(domain: string, title: string, snippet: string, url: string): void {
        this.discovery.recordUnknown(domain, title, snippet, url);
    }
    // ---- Diffbot content extraction ----

    /**
     * Extract article content from a URL using Diffbot.
     * Returns null on failure (timeout, paywall, non-article).
     * Records outcomes to SourceTracker for evidence-based blocking.
     */
    private async extractWithDiffbot(url: string): Promise<{
        author?: string;
        date?: string;
        siteName?: string;
        imageUrl?: string;
        text?: string;
        wordCount?: number;
    } | null> {
        if (!this.diffbotToken) return null;

        const domain = this.extractDomain(url);

        // Check cache first
        const cached = this.diffbotCache.get(url);
        if (!DiffbotCache.isMiss(cached)) return cached;

        // Hard timeout wrapper — AbortSignal.timeout may not cancel body reads
        const hardTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 6000));

        const extraction = (async () => {
            try {
                const apiUrl = `https://api.diffbot.com/v3/article?token=${this.diffbotToken}&url=${encodeURIComponent(url)}`;
                const response = await fetch(apiUrl, {
                    signal: AbortSignal.timeout(3500),
                });
                if (!response.ok) {
                    console.log(`[NewsSearch:Diffbot] HTTP ${response.status} for ${domain}`);
                    this.tracker.record(domain, response.status === 403 || response.status === 401 ? 'paywall' : 'no-text');
                    return null;
                }

                const data = await response.json() as any;
                const object = data.objects?.[0];
                if (!object?.text) {
                    console.log(`[NewsSearch:Diffbot] No text extracted for ${domain}`);
                    this.tracker.record(domain, 'no-text');
                    return null;
                }

                this.tracker.record(domain, 'success');
                const result = {
                    author: object.author as string | undefined,
                    date: object.date as string | undefined,
                    siteName: object.siteName as string | undefined,
                    imageUrl: object.images?.[0]?.url as string | undefined,
                    text: object.text as string | undefined,
                    wordCount: object.text ? (object.text as string).split(/\s+/).length : undefined,
                };
                this.diffbotCache.set(url, result);
                return result;
            } catch (err: any) {
                const isTimeout = err.name === 'TimeoutError';
                console.log(`[NewsSearch:Diffbot] ${isTimeout ? 'Timeout' : 'Error'} for ${domain}`);
                this.tracker.record(domain, isTimeout ? 'timeout' : 'no-text');
                this.diffbotCache.set(url, null);
                return null;
            }
        })();

        return Promise.race([extraction, hardTimeout]);
    }

    /**
     * Enrich NewsAPI articles with Diffbot content extraction.
     * Staggers requests in batches of 5 to avoid Diffbot rate limits.
     */
    private async diffbotEnrichArticles(articles: RawNewsArticle[]): Promise<RawNewsArticle[]> {
        if (!this.diffbotToken || articles.length === 0) return articles;

        // Pick up to 20 unique URLs for extraction (cache makes this cheap)
        const seen = new Set<string>();
        const toEnrich: { index: number; url: string }[] = [];
        for (let i = 0; i < articles.length && toEnrich.length < 20; i++) {
            const urlKey = articles[i].url.replace(/[?#].*$/, '').toLowerCase();
            const domain = this.extractDomain(articles[i].url);
            // Skip blocked domains — saves API calls
            if (this.tracker.shouldSkip(domain)) {
                console.log(`[NewsSearch:Diffbot] Skipping blocked domain: ${domain}`);
                continue;
            }
            if (!seen.has(urlKey) && articles[i].url) {
                seen.add(urlKey);
                toEnrich.push({ index: i, url: articles[i].url });
            }
        }

        console.log(`[NewsSearch:Diffbot] Extracting ${toEnrich.length} articles...`);
        const start = Date.now();

        // Stagger in batches of 6 to avoid Diffbot rate limits
        const BATCH_SIZE = 6;
        const allResults: (PromiseSettledResult<{
            author?: string; date?: string; siteName?: string;
            imageUrl?: string; text?: string; wordCount?: number;
        } | null>)[] = [];

        for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
            if (b > 0) await new Promise(r => setTimeout(r, 500)); // brief rate limit gap
            const batch = toEnrich.slice(b, b + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(({ url }) => this.extractWithDiffbot(url))
            );
            allResults.push(...results);
        }

        let enrichedCount = 0;
        for (let j = 0; j < toEnrich.length; j++) {
            const result = allResults[j];
            if (result.status !== 'fulfilled' || !result.value?.text) continue;

            const article = articles[toEnrich[j].index];
            const extracted = result.value;

            // Merge Diffbot content into the article
            article.snippet = extracted.text!.substring(0, 1500);
            if (extracted.author && !article.author) article.author = extracted.author;
            if (extracted.imageUrl && !article.imageUrl) article.imageUrl = extracted.imageUrl;
            if (extracted.wordCount) {
                article.wordCount = extracted.wordCount;
                article.readingTimeMinutes = Math.max(1, Math.round(extracted.wordCount / 250));
            }
            if (extracted.date && !article.publishedAt) article.publishedAt = extracted.date;
            enrichedCount++;
        }

        console.log(`[NewsSearch:Diffbot] Enriched ${enrichedCount}/${toEnrich.length} in ${Date.now() - start}ms`);
        const cs = this.diffbotCache.stats();
        if (cs.hits > 0) console.log(`[NewsSearch:Diffbot] Cache: ${cs.hits} hits, ${cs.misses} misses (${cs.total} cached)`);

        // Persist tracker + cache data after enrichment batch
        this.tracker.save();
        this.diffbotCache.save();

        return articles;
    }

    // ---- Quality helpers ----

    /**
     * Detect navigation/sidebar junk in Exa snippets.
     * Catches content like "* [About] * [Contact] * [Topics]" that passes length checks.
     */
    private isNavJunk(snippet: string): boolean {
        const bracketLinks = (snippet.match(/\* \[/g) || []).length;
        const navPatterns = (snippet.match(/\[Into section|See more|About us|Contact|PROMARKET/gi) || []).length;
        return bracketLinks >= 3 || navPatterns >= 2;
    }

    /**
     * Look up a source by NewsMesh display name.
     * NewsMesh returns source names like "Deutsche Welle" which may not match domains.
     */
    private lookupSourceByName(sourceName: string): SourceEntry | undefined {
        const domain = SOURCE_NAME_TO_DOMAIN[sourceName];
        if (domain) return this.lookupSource(domain);
        return undefined;
    }

    /**
     * Run source discovery in the background.
     * Evaluates unknown domains that have been seen 3+ times.
     * Non-blocking — call after search results are returned.
     */
    async runDiscovery(): Promise<void> {
        if (this.discovery.pendingCount() === 0) return;
        try {
            const promoted = await this.discovery.evaluateCandidates(this.genAI, this.model);
            if (promoted.length > 0) {
                console.log(`[NewsSearch] Discovery: promoted ${promoted.length} new sources`);
            }
        } catch (err) {
            console.warn('[NewsSearch] Discovery error:', err);
        }
    }
}

// ============================================================================
// Title Normalization
// ============================================================================

/**
 * Clean raw article titles: decode HTML entities, collapse whitespace,
 * strip trailing " - Source" suffixes, and truncate overlong titles.
 */
function normalizeTitle(raw: string): string {
    // 1. Decode common HTML entities
    let title = raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ');

    // 2. Collapse whitespace (newlines, tabs, multiple spaces → single space)
    title = title.replace(/\s+/g, ' ').trim();

    // 3. Strip trailing " - Source" or " | Source" suffix
    const separators = [' - ', ' | ', ' — ', ' · '];
    for (const sep of separators) {
        const lastIdx = title.lastIndexOf(sep);
        if (lastIdx > 20) {  // don't strip if it would leave < 20 chars
            const suffix = title.substring(lastIdx + sep.length).trim();
            // Source names are 1-4 words, often ending with .com/.org
            const wordCount = suffix.split(/\s+/).length;
            if (wordCount <= 4) {
                title = title.substring(0, lastIdx).trim();
                break;
            }
        }
    }

    // 4. Truncate overly long titles
    if (title.length > 120) {
        const breakpoint = title.lastIndexOf(' ', 117);
        title = title.substring(0, breakpoint > 80 ? breakpoint : 117) + '…';
    }

    return title;
}

// ============================================================================
// Article Type Detection
// ============================================================================

export function detectArticleType(
    url: string,
    author?: string,
    title?: string
): 'reporting' | 'analysis' | 'opinion' | 'investigation' | 'explainer' {
    const urlLower = url.toLowerCase();
    const titleLower = (title || '').toLowerCase().trim();

    // URL path signals (highest confidence) — check for /segment/ in URL path
    const opinionPaths = ['/opinion/', '/editorial/', '/comment/', '/op-ed/',
        '/letters/', '/columnists/', '/commentisfree/', '/blogs/'];
    if (opinionPaths.some(p => urlLower.includes(p))) return 'opinion';

    const analysisPaths = ['/analysis/', '/in-depth/', '/long-read/', '/longread/', '/feature/', '/features/'];
    if (analysisPaths.some(p => urlLower.includes(p))) return 'analysis';

    const explainerPaths = ['/explainer/', '/what-is/', '/guide/', '/faq/', '/explained/'];
    if (explainerPaths.some(p => urlLower.includes(p))) return 'explainer';

    const investigationPaths = ['/investigation/', '/investigates/', '/exclusive/', '/special-report/'];
    if (investigationPaths.some(p => urlLower.includes(p))) return 'investigation';

    // Title prefix signals
    if (titleLower.startsWith('opinion:') || titleLower.startsWith('opinion :')) return 'opinion';
    if (titleLower.startsWith('editorial:') || titleLower.startsWith('editorial :')) return 'opinion';
    if (titleLower.includes('fact check') || titleLower.includes('fact-check')) return 'analysis';
    if (titleLower.startsWith('analysis:') || titleLower.startsWith('analysis :')) return 'analysis';
    if (titleLower.startsWith('explainer:') || titleLower.startsWith('explainer :')) return 'analysis';
    if (titleLower.startsWith('what to know about ')) return 'explainer';
    if (titleLower.startsWith('how ') || titleLower.startsWith('why ')) return 'analysis';
    if (titleLower.startsWith('exclusive:') || titleLower.startsWith('exclusive :')) return 'investigation';

    // Argumentative title patterns → opinion
    if (titleLower.includes('we must ') || titleLower.includes('we need to ')
        || titleLower.includes('we should ')) return 'opinion';

    // Author signals
    if (author) {
        const authorLower = author.toLowerCase();
        if (authorLower.includes('opinion by') || authorLower.includes('editorial board')) return 'opinion';
    }

    return 'reporting';
}

