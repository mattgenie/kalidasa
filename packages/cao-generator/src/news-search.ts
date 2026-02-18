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
    articleType: 'reporting' | 'analysis' | 'opinion' | 'investigation' | 'explainer' | 'ai_generated';
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

    // Tier 2 (cont.): quality specialist outlets (Q5)
    'hollywoodreporter.com': { displayName: 'Hollywood Reporter', tier: 2, region: 'US', paywall: 'free', specialty: 'entertainment' },
    'fastcompany.com': { displayName: 'Fast Company', tier: 2, region: 'US', paywall: 'metered', specialty: 'business' },
    'forbes.com': { displayName: 'Forbes', tier: 2, region: 'US', paywall: 'metered', specialty: 'business' },
    'businessinsider.com': { displayName: 'Business Insider', tier: 2, region: 'US', paywall: 'metered', specialty: 'business' },
    'variety.com': { displayName: 'Variety', tier: 2, region: 'US', paywall: 'metered', specialty: 'entertainment' },
    'deadline.com': { displayName: 'Deadline', tier: 2, region: 'US', paywall: 'free', specialty: 'entertainment' },
    'engadget.com': { displayName: 'Engadget', tier: 2, region: 'US', paywall: 'free', specialty: 'tech' },
    'thedailybeast.com': { displayName: 'The Daily Beast', tier: 2, region: 'US', paywall: 'metered' },
    'theconversation.com': { displayName: 'The Conversation', tier: 2, region: 'Global', paywall: 'free' },

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
    'washingtontimes.com': { displayName: 'Washington Times', tier: 3, region: 'US', paywall: 'free' },
    'gartner.com': { displayName: 'Gartner', tier: 3, region: 'US', paywall: 'metered', specialty: 'tech' },
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

        // Step 2: Always search 30 days — recency is handled by scoring, not window.
        // This eliminates the costly widen-retry second pass (~7s saved).
        const dateWindowDays = 30;
        const rawArticles = await this.parallelSearch(queries, facets, mode, dateWindowDays, queryText);

        // Step 3: Deduplicate
        const deduped = this.deduplicateArticles(rawArticles);
        console.log(`[NewsSearch] After dedup: ${deduped.length} unique articles`);

        // Step 4: LLM relevance filter — keeps only topically relevant articles
        const filtered = await this.filterByRelevance(deduped, queryText);
        console.log(`[NewsSearch] After relevance filter: ${filtered.length}/${deduped.length} kept`);

        // Step 5: Mode-adaptive scoring + selection (with query relevance)
        const selected = this.selectArticles(filtered, mode, maxResults, queryText, recency);

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
        // Exp 1: Slim prompt — compact examples, fewer tokens
        // Exp 8: 4th facet must use a contrasting/unexpected category for diversity
        const prompt = `Classify this news query and generate 4 FACETED search queries.

Query: "${queryText}"

MODES: survey (broad topics), thematic (one topic area), deep (one specific issue)
RECENCY: breaking (today/now), recent (this week), general (up to 30 days)
CATEGORIES: politics, technology, business, health, entertainment, sports, science, lifestyle, environment, world

RULES:
1. Exactly 4 facets, each with a DIFFERENT category
2. Queries: 2-4 words max (category handles scoping)
3. Add ISO alpha-2 "country" code if query mentions a specific country
4. Facet 4 MUST use a contrasting category unrelated to the primary topic — find unexpected intersections (e.g., for tech → health or lifestyle; for politics → science or entertainment)

EXAMPLES:
"world news today" → survey/breaking: [politics:"government policy", business:"trade economy", world:"conflict diplomacy", technology:"AI breakthroughs"]
"climate change updates" → thematic/recent: [environment:"climate change", business:"renewable energy", politics:"climate agreements", health:"air quality impact"]

BAD: queries >4 words, same category twice, rephrased duplicates, similar categories for facet 4.

Return JSON: { "mode": "survey"|"thematic"|"deep", "recency": "breaking"|"recent"|"general", "facets": [{ "query": "...", "category": "...", "country?": "..." }, ...] }`;


        try {
            const model = this.genAI.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.3,
                    maxOutputTokens: 200,
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
     * LLM relevance pass: keeps only topically relevant articles.
     * Inverted from "drop off-topic" → "keep relevant" for higher precision.
     */
    private async filterByRelevance(
        articles: RawNewsArticle[],
        queryText: string
    ): Promise<RawNewsArticle[]> {
        if (articles.length === 0) return [];

        // Strict relevance filter with examples for common off-topic patterns
        const titleList = articles.map((a, i) =>
            `${i + 1}. ${a.title.length > 80 ? a.title.substring(0, 77) + '...' : a.title}`
        ).join('\n');

        const prompt = `Query: "${queryText}"

${titleList}

STRICT RELEVANCE CHECK: Does each headline's MAIN SUBJECT directly match the query topic?
- "stock market news" → KEEP finance/market/stock/earnings articles. DROP health, celebrity, gaming, weather even if they mention money.
- "AI news" → KEEP articles ABOUT artificial intelligence. DROP articles where a person who works in AI is the subject but the article is NOT about AI.
- "climate change" → KEEP climate science, environmental policy. DROP fashion, unrelated court rulings, general politics unless directly about climate.

Tangential connections do NOT count. Return JSON: {"keep":[ids]}`;

        try {
            const model = this.genAI.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                    maxOutputTokens: 150,
                },
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const parsed = JSON.parse(text);

            const keepIds = new Set<number>(
                Array.isArray(parsed.keep)
                    ? parsed.keep.map(Number).filter((n: number) => !isNaN(n))
                    : []
            );

            const dropped = articles.length - keepIds.size;
            if (dropped > 0) {
                for (let i = 0; i < articles.length; i++) {
                    if (!keepIds.has(i + 1)) {
                        console.log(`[NewsSearch:Filter] Dropping #${i + 1} "${articles[i].title?.substring(0, 50)}"`);
                    }
                }
            }

            // Safety: if LLM returned empty keep list, fall back to keeping all
            if (keepIds.size === 0) {
                console.warn('[NewsSearch:Filter] LLM returned empty keep list, keeping all');
                return articles;
            }

            return articles.filter((_, i) => keepIds.has(i + 1));
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
    private async parallelSearch(queries: string[], facets: { query: string; category?: string; country?: string }[], mode: NewsMode, dateWindowDays: number, queryText: string = ''): Promise<RawNewsArticle[]> {
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

        // Exp 2: Dedup NewsMesh BEFORE Diffbot — eliminates redundant API calls
        // Cross-facet NewsMesh queries often return overlapping articles.
        // Deduplicating now saves ~200ms per duplicate removed.
        const dedupedNewsMesh = this.deduplicateArticles(newsMesh);
        if (newsMesh.length > dedupedNewsMesh.length) {
            console.log(`[NewsSearch] Pre-Diffbot dedup: ${newsMesh.length} → ${dedupedNewsMesh.length} (-${newsMesh.length - dedupedNewsMesh.length} duplicates)`);
        }

        // NewsMesh → Diffbot enrichment (on deduplicated set)
        // P1: Run OG image extraction on Exa articles in parallel — zero extra latency
        const [enriched] = await Promise.all([
            this.diffbotEnrichArticles(dedupedNewsMesh, queryText),
            this.enrichWithOgImages(exa),
        ]);

        // --- Quality Filter 2: NewsMesh requires Diffbot enrichment ---
        const shipped = enriched.filter(a => (a.snippet?.length || 0) >= 325);
        const droppedNewsMesh = enriched.length - shipped.length;
        if (droppedNewsMesh > 0) {
            console.log(`[NewsSearch] Dropped ${droppedNewsMesh} unenriched NewsMesh articles`);
        }

        const diffbotCount = shipped.filter(a => a.snippet && a.snippet.length > 200).length;
        console.log(`[NewsSearch] Raw: ${exa.length} Exa + ${newsMesh.length} NewsMesh (${diffbotCount} Diffbot-enriched) (window: ${dateWindowDays}d)`);

        // Q3: Filter lead-gen / non-article pages
        // Q8: Filter future-dated articles (> now + 24h)
        // Q9: Fill missing wordCount from snippet
        // Q10: Flag AI-generated bylines
        const allArticles = [...shipped, ...exa];
        const qualityFiltered = allArticles.filter(a => {
            // Q3: Lead-gen pages
            if (this.isLeadGenPage(a.snippet || '')) {
                console.log(`[NewsSearch:Q3] Dropped lead-gen page: ${a.sourceDomain} — "${a.title.substring(0, 60)}"`);
                return false;
            }
            // Q8: Future dates
            if (a.publishedAt) {
                const pubTime = new Date(a.publishedAt).getTime();
                if (pubTime > Date.now() + 24 * 60 * 60 * 1000) {
                    console.log(`[NewsSearch:Q8] Dropped future-dated article: ${a.publishedAt} — "${a.title.substring(0, 60)}"`);
                    return false;
                }
            }
            // Q9: Fill missing wordCount from snippet
            if (!a.wordCount && a.snippet) {
                a.wordCount = a.snippet.split(/\s+/).length;
                a.readingTimeMinutes = Math.ceil(a.wordCount / 250);
            }
            // Q10: Flag AI-generated bylines
            if (a.author && NewsSearchEngine.AI_AUTHOR_PATTERNS.some(p => a.author!.toLowerCase().includes(p))) {
                a.articleType = 'ai_generated';
            }
            return true;
        });
        if (allArticles.length > qualityFiltered.length) {
            console.log(`[NewsSearch] Quality filters (Q3+Q8): ${allArticles.length} → ${qualityFiltered.length}`);
        }

        // Signal 5: HEAD-validate all image URLs — clear broken/tiny (<5KB) images
        await this.validateImageUrls(qualityFiltered);

        return qualityFiltered;
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
                    signal: AbortSignal.timeout(6000),
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
        maxResults: number,
        queryText: string = '',
        recency: 'breaking' | 'recent' | 'general' = 'general'
    ): RawNewsArticle[] {
        if (articles.length === 0) return [];

        // Score each article (with query relevance and recency-weighted scoring)
        const scored = articles.map(article => ({
            article,
            baseScore: this.scoreArticle(article, queryText, recency),
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

    private scoreArticle(
        article: RawNewsArticle,
        queryText: string = '',
        recency: 'breaking' | 'recent' | 'general' = 'general'
    ): number {
        let score = 0;
        score += article.sourceTier === 1 ? 3 : article.sourceTier === 2 ? 2 : article.sourceTier === 3 ? 1 : 0;
        score += article.paywall === 'free' ? 2 : article.paywall === 'metered' ? 1 : 0;

        // Recency-weighted scoring (replaces hard date window filtering)
        if (article.publishedAt) {
            const hoursOld = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
            if (recency === 'breaking') {
                score += hoursOld < 24 ? 3 : hoursOld < 48 ? 1 : -1;
            } else if (recency === 'recent') {
                score += hoursOld < 48 ? 2 : hoursOld < 168 ? 1 : 0;
            } else {
                score += hoursOld < 168 ? 1 : hoursOld < 720 ? 0.5 : 0;
            }
        }

        // Keyword relevance: boost articles whose title matches query terms
        if (queryText) {
            const queryWords = new Set(
                queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3)
            );
            const titleWords = article.title.toLowerCase().split(/\s+/);
            const hits = titleWords.filter(w => queryWords.has(w)).length;
            score += Math.min(hits, 3); // Cap at +3
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

    // ---- Image quality helpers (P1, P2) ----

    /** Known ad network, tracking, and map/street-view domains */
    // Q3: Lead-gen / non-article page detection patterns
    private static readonly LEAD_GEN_PATTERNS = [
        'all fields are required', 'download your', 'sign up for', 'subscribe now',
        'fill out the form', 'request a demo', 'contact information',
        'first name', 'last name', 'business phone', 'job title',
        'get the report', 'whitepaper', 'webinar registration',
    ];

    // Q10: AI-generated byline patterns
    private static readonly AI_AUTHOR_PATTERNS = [
        'ai news desk', 'ai reporter', 'automated insights', 'ai staff',
        'ai-generated', 'machine-generated',
    ];

    /**
     * Q3: Check if a snippet looks like a lead-gen page rather than an article.
     * Requires 2+ pattern matches to avoid false positives.
     */
    private isLeadGenPage(snippet: string): boolean {
        const lower = snippet.toLowerCase();
        return NewsSearchEngine.LEAD_GEN_PATTERNS.filter(p => lower.includes(p)).length >= 2;
    }

    private static readonly AD_IMAGE_PATTERNS = [
        'doubleclick', 'googlesyndication', 'adnxs', 'adsrvr',
        'taboola', 'outbrain', 'moatads', 'criteo', 'amazon-adsystem',
        'facebook.com/tr', 'pixel.', 'tracker.',
        'maps.googleapis.com/maps/api/streetview', 'maps.gstatic.com',
        'pbs.twimg.com/profile_images', 'graph.facebook.com',
    ];

    /** URL path patterns that indicate ads/placeholders */
    private static readonly BAD_PATH_PATTERNS = [
        '/ads/', '/banner/', '/sponsor/', '/pixel/', '/tracking/',
        '/placeholder', '/default-image', '/no-image', '/generic',
        'thumbnail_default', 'og-default', '/avatar/',
    ];

    /**
     * P2: Smart image selection from Diffbot images array.
     * Filters out ad/street-view images, tracking pixels, and tiny images.
     * Scores by: primary flag (+10), area, then picks highest.
     */
    private selectBestImage(images: Array<{ url?: string; width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; primary?: boolean }>): string | undefined {
        if (!images || images.length === 0) return undefined;

        const candidates = images.filter(img => {
            if (!img.url) return false;
            const urlLower = img.url.toLowerCase();

            // Reject ad network / street view images
            if (NewsSearchEngine.AD_IMAGE_PATTERNS.some(p => urlLower.includes(p))) return false;

            // Reject bad URL path patterns
            if (NewsSearchEngine.BAD_PATH_PATTERNS.some(p => urlLower.includes(p))) return false;

            // Reject tiny images (tracking pixels, icons, avatars)
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            if ((w > 0 || h > 0) && (w < 200 || h < 150)) return false;

            return true;
        });

        if (candidates.length === 0) return images[0]?.url; // fallback to first if all filtered

        // Score-based ranking: primary flag dominates, then area
        candidates.sort((a, b) => {
            // Diffbot primary flag = editorial hero image (+10)
            const aPrimary = a.primary ? 10 : 0;
            const bPrimary = b.primary ? 10 : 0;
            if (aPrimary !== bPrimary) return bPrimary - aPrimary;

            // Then by area descending
            const aArea = (a.naturalWidth || a.width || 0) * (a.naturalHeight || a.height || 0);
            const bArea = (b.naturalWidth || b.width || 0) * (b.naturalHeight || b.height || 0);
            return bArea - aArea;
        });

        return candidates[0]?.url;
    }

    /**
     * P1: Extract og:image from a URL by fetching the HTML <head>.
     * Lightweight — only fetches ~10KB to get meta tags.
     * Returns the og:image URL or undefined.
     */
    private async extractOgImage(url: string): Promise<string | undefined> {
        try {
            const response = await fetch(url, {
                headers: {
                    'Range': 'bytes=0-10000',
                    'User-Agent': 'Mozilla/5.0 (compatible; KalidasaBot/1.0)',
                },
                signal: AbortSignal.timeout(2000),
                redirect: 'follow',
            });

            if (!response.ok && response.status !== 206) return undefined;

            const html = await response.text();

            // Parse og:image meta tag (handles both attribute orderings)
            const match = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
                || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);

            if (match?.[1]) {
                const imageUrl = match[1];
                if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                    return imageUrl;
                }
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * P1: Batch-extract og:image for articles missing images.
     * Uses a concurrency pool of 5 to avoid overwhelming servers.
     */
    private async enrichWithOgImages(articles: RawNewsArticle[]): Promise<void> {
        const needsImage = articles.filter(a => !a.imageUrl && a.url);
        if (needsImage.length === 0) return;

        console.log(`[NewsSearch:OG] Extracting og:image for ${needsImage.length} articles...`);
        const start = Date.now();

        let nextIdx = 0;
        let extracted = 0;
        const runNext = async (): Promise<void> => {
            while (nextIdx < needsImage.length) {
                const myIdx = nextIdx++;
                const article = needsImage[myIdx];
                const imageUrl = await this.extractOgImage(article.url);
                if (imageUrl) {
                    article.imageUrl = imageUrl;
                    extracted++;
                }
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(5, needsImage.length) }, () => runNext())
        );

        console.log(`[NewsSearch:OG] Extracted ${extracted}/${needsImage.length} og:images in ${Date.now() - start}ms`);
    }

    /**
     * Signal 5: HEAD-validate image URLs — clear broken/tiny images.
     * Catches <5KB tracking pixels, 404s, and non-image responses.
     */
    private async validateImageUrls(articles: RawNewsArticle[]): Promise<void> {
        const withImages = articles.filter(a => a.imageUrl);
        if (withImages.length === 0) return;

        const MIN_BYTES = 5000; // <5KB is almost certainly not a real photo
        let cleared = 0;

        const validate = async (article: RawNewsArticle): Promise<void> => {
            try {
                const resp = await fetch(article.imageUrl!, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(1500),
                    redirect: 'follow',
                });

                if (!resp.ok) {
                    article.imageUrl = undefined;
                    cleared++;
                    return;
                }

                // Check Content-Type — reject non-image (e.g., HTML error pages)
                const ct = resp.headers.get('content-type') || '';
                if (ct && !ct.startsWith('image/')) {
                    article.imageUrl = undefined;
                    cleared++;
                    return;
                }

                // Check Content-Length — reject tiny files
                const cl = resp.headers.get('content-length');
                if (cl && parseInt(cl, 10) < MIN_BYTES) {
                    article.imageUrl = undefined;
                    cleared++;
                }
            } catch {
                // Timeout or network error — keep the URL (might work for the client)
            }
        };

        // Concurrency pool of 8 (HEAD requests are cheap)
        let nextIdx = 0;
        const runNext = async (): Promise<void> => {
            while (nextIdx < withImages.length) {
                const article = withImages[nextIdx++];
                await validate(article);
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(8, withImages.length) }, () => runNext())
        );

        if (cleared > 0) {
            console.log(`[NewsSearch:Validate] Cleared ${cleared}/${withImages.length} broken/tiny image URLs`);
        }
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
                    imageUrl: this.selectBestImage(object.images || []),
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
     * Enrich NewsMesh articles with Diffbot content extraction.
     * Rate-limited to 5 calls/second (paid plan limit) via staggered launch.
     */
    private async diffbotEnrichArticles(articles: RawNewsArticle[], queryText: string = ''): Promise<RawNewsArticle[]> {
        if (!this.diffbotToken || articles.length === 0) return articles;

        // Exp 3: Pre-score to top-8 — only enrich the most promising articles
        // Tier 1 sources always qualify; remaining ranked by score
        const MAX_DIFFBOT = 8;
        const scored = articles.map((a, i) => ({
            index: i,
            article: a,
            score: this.scoreArticle(a, queryText),
        }));
        scored.sort((a, b) => b.score - a.score);

        // Always include Tier 1 sources, then fill remaining slots by score
        const tier1Indices = new Set(scored.filter(s => s.article.sourceTier === 1).map(s => s.index));
        const topIndices = new Set<number>();
        for (const s of scored) {
            if (tier1Indices.has(s.index)) {
                topIndices.add(s.index);
            } else if (topIndices.size < MAX_DIFFBOT) {
                topIndices.add(s.index);
            }
            if (topIndices.size >= MAX_DIFFBOT) break;
        }

        if (articles.length > topIndices.size) {
            console.log(`[NewsSearch:Diffbot] Pre-score: ${articles.length} → ${topIndices.size} (top-${MAX_DIFFBOT}, ${tier1Indices.size} Tier 1 kept)`);
        }

        // Pick unique URLs for extraction from pre-scored set
        const seen = new Set<string>();
        const toEnrich: { index: number; url: string }[] = [];
        for (const idx of topIndices) {
            const a = articles[idx];
            const urlKey = a.url.replace(/[?#].*$/, '').toLowerCase();
            const domain = this.extractDomain(a.url);
            // Skip blocked domains — saves API calls
            if (this.tracker.shouldSkip(domain)) {
                console.log(`[NewsSearch:Diffbot] Skipping blocked domain: ${domain}`);
                continue;
            }
            if (!seen.has(urlKey) && a.url) {
                seen.add(urlKey);
                toEnrich.push({ index: idx, url: a.url });
            }
        }

        console.log(`[NewsSearch:Diffbot] Extracting ${toEnrich.length} articles...`);
        const start = Date.now();

        // Exp 4: Concurrency pool — fire up to 5 concurrent Diffbot requests.
        // As each completes, the next fires immediately (no artificial 200ms gaps).
        const POOL_SIZE = 5; // Matches Diffbot 5 req/s rate limit
        type DiffbotResult = { author?: string; date?: string; siteName?: string; imageUrl?: string; text?: string; wordCount?: number; } | null;
        const allResults: (PromiseSettledResult<DiffbotResult>)[] = new Array(toEnrich.length);

        // Process in concurrent batches using a sliding pool
        let nextIdx = 0;
        const runNext = async (): Promise<void> => {
            while (nextIdx < toEnrich.length) {
                const myIdx = nextIdx++;
                try {
                    const result = await this.extractWithDiffbot(toEnrich[myIdx].url);
                    allResults[myIdx] = { status: 'fulfilled', value: result };
                } catch (reason: any) {
                    allResults[myIdx] = { status: 'rejected', reason };
                }
            }
        };
        // Launch POOL_SIZE workers — each grabs the next job when done
        await Promise.all(
            Array.from({ length: Math.min(POOL_SIZE, toEnrich.length) }, () => runNext())
        );

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

