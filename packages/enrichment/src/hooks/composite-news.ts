/**
 * Composite News Hook
 * 
 * Search-first news enrichment using Exa + NewsAPI in parallel.
 * Features:
 * - Source quality tiering (1-3, user-curated)
 * - Paywall detection
 * - Geographic diversity scoring
 * - Article type classification
 * - Mode-adaptive selection (survey/thematic/deep)
 * - Topic clustering for perspective comparison
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain,
    NewsEnrichment,
} from '@kalidasa/types';

// ============================================================================
// Source Registry (user-curated)
// ============================================================================

export interface SourceEntry {
    displayName: string;
    tier: 1 | 2 | 3;
    region: string;
    paywall: 'free' | 'metered' | 'hard';
    specialty?: string;
}

/**
 * Curated source registry. Placeholder — user will expand.
 */
export const SOURCE_REGISTRY: Record<string, SourceEntry> = {
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

    // Tier 3: Good regional/niche
    'salon.com': { displayName: 'Salon', tier: 3, region: 'US', paywall: 'free' },
    'slate.com': { displayName: 'Slate', tier: 3, region: 'US', paywall: 'free' },
    'vox.com': { displayName: 'Vox', tier: 3, region: 'US', paywall: 'free' },
    'zdnet.com': { displayName: 'ZDNet', tier: 3, region: 'US', paywall: 'free', specialty: 'tech' },
    'venturebeat.com': { displayName: 'VentureBeat', tier: 3, region: 'US', paywall: 'free', specialty: 'tech' },
    'defenseone.com': { displayName: 'Defense One', tier: 3, region: 'US', paywall: 'free', specialty: 'defense' },
    'theintercept.com': { displayName: 'The Intercept', tier: 3, region: 'US', paywall: 'free' },
};

// ============================================================================
// Raw Article Type (internal)
// ============================================================================

export interface RawNewsArticle {
    title: string;
    author?: string;
    publishedAt?: string;
    sourceDisplayName: string;
    sourceDomain: string;
    sourceTier: number;
    sourceRegion: string;
    paywall: 'free' | 'metered' | 'hard';
    articleType: NewsEnrichment['articleType'];
    imageUrl?: string;
    url: string;
    snippet?: string;
    wordCount?: number;
    readingTimeMinutes?: number;
    apiSource: 'exa' | 'newsapi';
}

export type NewsMode = 'survey' | 'thematic' | 'deep';

// ============================================================================
// Composite News Hook (pass-through for pre-enriched data)
// ============================================================================

export class CompositeNewsHook implements EnrichmentHook {
    name = 'news_composite';
    domains: EnrichmentDomain[] = ['news'];
    priority = 95;

    /**
     * Pass-through: news candidates arrive pre-enriched from stage 1a search.
     * This hook just validates the data is present.
     */
    async enrich(
        candidate: RawCAOCandidate,
        _context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        // If the candidate already has pre-attached enrichment (from stage 1a search),
        // it's passed through the candidate's enrichment field
        // The executor handles this — we return null to indicate no additional enrichment needed
        console.log(`[CompositeNews] Pass-through for "${candidate.name}"`);
        return null;
    }

    async healthCheck(): Promise<boolean> {
        return true;
    }
}

// ============================================================================
// News Searcher (used by TwoStageGenerator.runNewsSearch)
// ============================================================================

export class NewsSearcher {
    private exaApiKey: string;
    private newsApiKey: string;
    private curatedDomains: string[];

    constructor() {
        this.exaApiKey = process.env.EXA_API_KEY || '';
        this.newsApiKey = process.env.NEWSAPI_KEY || '';
        this.curatedDomains = Object.keys(SOURCE_REGISTRY);
    }

    /**
     * Search for news articles across Exa + NewsAPI
     */
    async search(
        queries: string[],
        maxResults: number = 10
    ): Promise<RawNewsArticle[]> {
        console.log(`[NewsSearcher] Searching ${queries.length} queries across Exa + NewsAPI...`);

        // Run both APIs in parallel across all queries
        const [exaResults, newsApiResults] = await Promise.allSettled([
            this.searchExa(queries),
            this.searchNewsAPI(queries),
        ]);

        const exaArticles = exaResults.status === 'fulfilled' ? exaResults.value : [];
        const newsApiArticles = newsApiResults.status === 'fulfilled' ? newsApiResults.value : [];

        console.log(`[NewsSearcher] Raw: ${exaArticles.length} Exa + ${newsApiArticles.length} NewsAPI`);

        // Combine and deduplicate
        const allArticles = [...exaArticles, ...newsApiArticles];
        const deduped = this.deduplicateArticles(allArticles);

        console.log(`[NewsSearcher] After dedup: ${deduped.length} unique articles`);

        return deduped;
    }

    /**
     * Mode-adaptive article selection
     */
    selectArticles(
        articles: RawNewsArticle[],
        mode: NewsMode,
        maxResults: number
    ): RawNewsArticle[] {
        if (articles.length === 0) return [];

        // Score each article
        const scored = articles.map(article => ({
            article,
            score: this.scoreArticle(article),
        }));

        // Greedy selection with diversity
        const selected: RawNewsArticle[] = [];
        const seenOutlets = new Set<string>();
        const seenRegions = new Set<string>();
        const seenTopicWords = new Set<string>();

        // Sort by base score descending
        scored.sort((a, b) => b.score - a.score);

        for (const { article } of scored) {
            if (selected.length >= maxResults) break;

            let diversityBonus = 0;

            if (mode === 'survey') {
                // Topic diversity: new topic keywords = big bonus
                const topicWords = this.extractTopicWords(article.title);
                const isNewTopic = topicWords.filter(w => !seenTopicWords.has(w)).length >
                    topicWords.length * 0.5;
                diversityBonus = isNewTopic ? 2 : -1;
            } else if (mode === 'thematic') {
                // Balance: new outlet or subtopic bonus
                const isNewOutlet = !seenOutlets.has(article.sourceDomain);
                diversityBonus = isNewOutlet ? 1 : 0;
                if (!seenRegions.has(article.sourceRegion)) diversityBonus += 0.5;
            } else {
                // Deep: max source diversity
                const isNewOutlet = !seenOutlets.has(article.sourceDomain);
                diversityBonus = isNewOutlet ? 2 : -2;
                if (!seenRegions.has(article.sourceRegion)) diversityBonus += 1;
            }

            const finalScore = this.scoreArticle(article) + diversityBonus;

            // Only skip if score is very negative (duplicate outlet in deep mode)
            if (finalScore < -1 && selected.length >= 3) continue;

            selected.push(article);
            seenOutlets.add(article.sourceDomain);
            seenRegions.add(article.sourceRegion);
            this.extractTopicWords(article.title).forEach(w => seenTopicWords.add(w));
        }

        console.log(`[NewsSearcher] Selected ${selected.length}/${articles.length} articles (mode: ${mode})`);
        return selected;
    }

    /**
     * Topic clustering for cross-referencing in summaries
     */
    clusterByTopic(articles: RawNewsArticle[]): ArticleCluster[] {
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

    // ---- Private: Search APIs ----

    private async searchExa(queries: string[]): Promise<RawNewsArticle[]> {
        if (!this.exaApiKey) {
            console.log('[NewsSearcher:Exa] No API key');
            return [];
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const articles: RawNewsArticle[] = [];

        // Batch: run all queries in parallel
        const promises = queries.map(async (query) => {
            try {
                const body: any = {
                    query,
                    type: 'auto',
                    category: 'news',
                    numResults: 8,
                    startPublishedDate: thirtyDaysAgo,
                    contents: {
                        text: { maxCharacters: 500 },
                        highlights: { numSentences: 2 },
                    },
                };

                // Use curated domains if available (Pass 1)
                if (this.curatedDomains.length > 0) {
                    body.includeDomains = this.curatedDomains;
                }

                const response = await fetch('https://api.exa.ai/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': this.exaApiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    console.warn(`[NewsSearcher:Exa] API error ${response.status} for "${query}"`);
                    return [];
                }

                const data = await response.json();
                return (data.results || []).map((r: any) => this.exaToArticle(r));
            } catch (error) {
                console.warn(`[NewsSearcher:Exa] Error for "${query}":`, error);
                return [];
            }
        });

        const results = await Promise.all(promises);
        results.forEach(r => articles.push(...r));

        console.log(`[NewsSearcher:Exa] Found ${articles.length} articles`);
        return articles;
    }

    private async searchNewsAPI(queries: string[]): Promise<RawNewsArticle[]> {
        if (!this.newsApiKey) {
            console.log('[NewsSearcher:NewsAPI] No API key');
            return [];
        }

        const articles: RawNewsArticle[] = [];
        const domainFilter = this.curatedDomains.slice(0, 20).join(','); // NewsAPI limits domains

        const promises = queries.map(async (query) => {
            try {
                const params = new URLSearchParams({
                    q: query,
                    apiKey: this.newsApiKey,
                    pageSize: '8',
                    sortBy: 'relevancy',
                    language: 'en',
                });
                if (domainFilter) {
                    params.set('domains', domainFilter);
                }

                const response = await fetch(
                    `https://newsapi.org/v2/everything?${params.toString()}`
                );

                if (!response.ok) {
                    console.warn(`[NewsSearcher:NewsAPI] API error ${response.status} for "${query}"`);
                    return [];
                }

                const data = await response.json();
                return (data.articles || []).map((a: any) => this.newsApiToArticle(a));
            } catch (error) {
                console.warn(`[NewsSearcher:NewsAPI] Error for "${query}":`, error);
                return [];
            }
        });

        const results = await Promise.all(promises);
        results.forEach(r => articles.push(...r));

        console.log(`[NewsSearcher:NewsAPI] Found ${articles.length} articles`);
        return articles;
    }

    // ---- Private: Conversion helpers ----

    private exaToArticle(result: any): RawNewsArticle {
        const domain = this.extractDomain(result.url || '');
        const source = this.lookupSource(domain);
        const textLength = result.text?.length || 0;
        const wordCount = Math.round(textLength / 5);

        // Prefer highlights over raw text for snippet
        const snippet = result.highlights?.[0]?.replace(/\n/g, ' ').trim()
            || result.text?.substring(0, 300)
            || '';

        return {
            title: result.title || '',
            author: result.author || undefined,
            publishedAt: result.publishedDate || undefined,
            sourceDisplayName: source?.displayName || domain,
            sourceDomain: domain,
            sourceTier: source?.tier || 0,
            sourceRegion: source?.region || 'Unknown',
            paywall: source?.paywall || 'free',
            articleType: detectArticleType(result.url || '', result.author),
            imageUrl: undefined, // Exa doesn't provide images
            url: result.url || '',
            snippet,
            wordCount,
            readingTimeMinutes: Math.max(1, Math.round(wordCount / 250)),
            apiSource: 'exa',
        };
    }

    private newsApiToArticle(article: any): RawNewsArticle {
        const domain = this.extractDomain(article.url || '');
        const source = this.lookupSource(domain);

        return {
            title: article.title || '',
            author: article.author || undefined,
            publishedAt: article.publishedAt || undefined,
            sourceDisplayName: source?.displayName || article.source?.name || domain,
            sourceDomain: domain,
            sourceTier: source?.tier || 0,
            sourceRegion: source?.region || 'Unknown',
            paywall: source?.paywall || 'free',
            articleType: detectArticleType(article.url || '', article.author),
            imageUrl: article.urlToImage || undefined,
            url: article.url || '',
            snippet: article.description || '',
            apiSource: 'newsapi',
        };
    }

    // ---- Private: Scoring & utilities ----

    private scoreArticle(article: RawNewsArticle): number {
        let score = 0;

        // Tier scoring
        score += article.sourceTier === 1 ? 3 : article.sourceTier === 2 ? 2 : article.sourceTier === 3 ? 1 : 0;

        // Paywall preference (free articles preferred)
        score += article.paywall === 'free' ? 2 : article.paywall === 'metered' ? 1 : 0;

        // Recency bonus
        if (article.publishedAt) {
            const hoursOld = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
            score += hoursOld < 24 ? 1 : hoursOld < 168 ? 0.5 : 0;
        }

        return score;
    }

    private deduplicateArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
        const seen = new Map<string, RawNewsArticle>();

        for (const article of articles) {
            if (!article.title || article.title.length < 10) continue;

            // Exact URL dedup
            const urlKey = article.url.replace(/[?#].*$/, '').toLowerCase();
            if (seen.has(urlKey)) {
                // Prefer Exa version (better text extraction)
                if (article.apiSource === 'exa') {
                    seen.set(urlKey, article);
                }
                continue;
            }

            // Title similarity dedup (same domain)
            const titleNorm = article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            let isDuplicate = false;
            for (const [, existing] of seen) {
                if (existing.sourceDomain === article.sourceDomain) {
                    const existingNorm = existing.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
                    if (this.titleOverlap(titleNorm, existingNorm) > 0.7) {
                        isDuplicate = true;
                        break;
                    }
                }
            }

            if (!isDuplicate) {
                seen.set(urlKey, article);
            }
        }

        return Array.from(seen.values());
    }

    private titleOverlap(a: string, b: string): number {
        const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
        if (wordsA.size === 0 || wordsB.size === 0) return 0;
        const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
        return overlap / Math.max(wordsA.size, wordsB.size);
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
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    private lookupSource(domain: string): SourceEntry | undefined {
        // Direct match
        if (SOURCE_REGISTRY[domain]) return SOURCE_REGISTRY[domain];
        // Try without subdomain (e.g., news.bbc.co.uk → bbc.co.uk)
        const parts = domain.split('.');
        if (parts.length > 2) {
            const parent = parts.slice(-2).join('.');
            if (SOURCE_REGISTRY[parent]) return SOURCE_REGISTRY[parent];
            // Try 3-part (e.g., bbc.co.uk)
            const parent3 = parts.slice(-3).join('.');
            if (SOURCE_REGISTRY[parent3]) return SOURCE_REGISTRY[parent3];
        }
        return undefined;
    }
}

// ============================================================================
// Article Type Detection
// ============================================================================

export function detectArticleType(url: string, author?: string): NewsEnrichment['articleType'] {
    const urlLower = url.toLowerCase();

    if (/\/(opinion|editorial|comment|op-ed|letters|columnists)\//.test(urlLower)) return 'opinion';
    if (/\/(analysis|in-depth|long-read|longread|feature|features)\//.test(urlLower)) return 'analysis';
    if (/\/(explainer|what-is|guide|faq|explained)\//.test(urlLower)) return 'explainer';
    if (/\/(investigation|investigates|exclusive|special-report)\//.test(urlLower)) return 'investigation';

    // Author field signals
    if (author) {
        const authorLower = author.toLowerCase();
        if (authorLower.includes('opinion by') || authorLower.includes('editorial board')) return 'opinion';
    }

    return 'reporting';
}

// ============================================================================
// Article Cluster Type
// ============================================================================

export interface ArticleCluster {
    articles: RawNewsArticle[];
    keywords: Set<string>;
}
