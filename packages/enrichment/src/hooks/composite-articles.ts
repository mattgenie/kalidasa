/**
 * Composite Articles Hook
 * 
 * Multi-source article enrichment that queries NewsAPI,
 * Wikipedia, and Curated Crawler in parallel, picks the best
 * match by title similarity.
 * 
 * Curated Crawler integration is stubbed for when query-api is deployed.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

interface ArticleMatch {
    source: string;
    title: string;
    author?: string;
    publishedAt?: string;
    sourceName?: string;
    imageUrl?: string;
    url?: string;
    summary?: string;
    readingTimeMinutes?: number;
    wordCount?: number;
    qualityScore?: number;
    topics?: string[];
    similarity: number; // 0-1 title similarity score
}

export class CompositeArticlesHook implements EnrichmentHook {
    name = 'articles_composite';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 95;

    private newsapiKey: string;
    private diffbotToken: string;
    private curatedApiUrl: string;

    constructor() {
        this.newsapiKey = process.env.NEWSAPI_KEY || '';
        this.diffbotToken = process.env.DIFFBOT_TOKEN || '';
        this.curatedApiUrl = process.env.CURATED_QUERY_API || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const candidateTitle = candidate.name;
        const candidateAuthor = candidate.identifiers?.author as string || '';
        const searchQuery = candidate.search_hint || `${candidateTitle} ${candidateAuthor}`;

        console.log(`[CompositeArticles] Searching for: "${candidateTitle}" by ${candidateAuthor || 'unknown'}`);

        // Query sources in parallel (Exa and SerpAPI are separate hooks;
        // this composite handles NewsAPI, Wikipedia, and Curated Crawler)
        const [newsapiMatch, wikiMatch, curatedMatch] = await Promise.allSettled([
            this.queryNewsAPI(searchQuery, candidateTitle),
            this.queryWikipedia(candidateTitle, candidateAuthor),
            this.queryCurated(searchQuery, candidateTitle),
        ]);

        // Collect all successful matches
        const matches: ArticleMatch[] = [];

        if (newsapiMatch.status === 'fulfilled' && newsapiMatch.value) {
            matches.push(newsapiMatch.value);
        }
        if (curatedMatch.status === 'fulfilled' && curatedMatch.value) {
            matches.push(curatedMatch.value);
        }
        if (wikiMatch.status === 'fulfilled' && wikiMatch.value) {
            matches.push(wikiMatch.value);
        }

        if (matches.length === 0) {
            console.log(`[CompositeArticles] ✗ No matches found for "${candidateTitle}"`);
            return null;
        }

        // Sort by similarity score (highest first), then by source priority
        const sourcePriority: Record<string, number> = {
            curated: 4,
            newsapi: 3,
            newsmesh: 2,  // kept for legacy source priority
            wikipedia: 1,
        };

        matches.sort((a, b) => {
            // First by similarity
            if (Math.abs(a.similarity - b.similarity) > 0.1) {
                return b.similarity - a.similarity;
            }
            // Then by source priority
            return (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0);
        });

        const best = matches[0];
        console.log(`[CompositeArticles] ✓ Best match: "${best.title}" from ${best.source} (similarity: ${best.similarity.toFixed(2)})`);

        // Only accept matches with reasonable title similarity
        const minSimilarity = 0.35;
        if (best.similarity < minSimilarity) {
            console.log(`[CompositeArticles] ✗ Best match similarity too low (${best.similarity.toFixed(2)} < ${minSimilarity})`);
            return null;
        }

        return {
            verified: true,
            source: `articles_composite:${best.source}`,
            articles: {
                author: best.author || candidateAuthor,
                publishedAt: best.publishedAt,
                source: best.sourceName,
                imageUrl: best.imageUrl,
                url: best.url,
                summary: best.summary,
                readingTimeMinutes: best.readingTimeMinutes,
                wordCount: best.wordCount,
                qualityScore: best.qualityScore,
                topics: best.topics,
            },
        };
    }

    // =========================================================================
    // NewsAPI
    // =========================================================================

    private async queryNewsAPI(query: string, candidateTitle: string): Promise<ArticleMatch | null> {
        if (!this.newsapiKey) return null;

        try {
            const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&apiKey=${this.newsapiKey}&pageSize=3&sortBy=relevancy`;
            const response = await fetch(url);

            if (!response.ok) {
                console.log(`[CompositeArticles:NewsAPI] HTTP ${response.status}`);
                return null;
            }

            const data = await response.json();
            const articles = data.articles || [];

            // Find the best title match
            let bestMatch: ArticleMatch | null = null;
            for (const article of articles) {
                const similarity = this.titleSimilarity(candidateTitle, article.title || '');
                if (!bestMatch || similarity > bestMatch.similarity) {
                    bestMatch = {
                        source: 'newsapi',
                        title: article.title,
                        author: article.author,
                        publishedAt: article.publishedAt,
                        sourceName: article.source?.name,
                        imageUrl: article.urlToImage,
                        url: article.url,
                        summary: article.description,
                        similarity,
                    };
                }
            }

            if (bestMatch) {
                console.log(`[CompositeArticles:NewsAPI] Found: "${bestMatch.title}" (sim: ${bestMatch.similarity.toFixed(2)})`);
            }
            return bestMatch;
        } catch (error) {
            console.log(`[CompositeArticles:NewsAPI] Error: ${error}`);
            return null;
        }
    }


    // =========================================================================
    // Wikipedia (fallback for books, papers, reports)
    // =========================================================================

    private async queryWikipedia(candidateTitle: string, candidateAuthor: string = ''): Promise<ArticleMatch | null> {
        try {
            // Search Wikipedia for the article/book title
            const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateTitle)}`;
            const response = await fetch(searchUrl);

            if (!response.ok) {
                // Try search API instead
                return this.queryWikipediaSearch(candidateTitle, candidateAuthor);
            }

            const data = await response.json();

            if (data.type === 'disambiguation') {
                // Don't use disambiguation pages
                return this.queryWikipediaSearch(candidateTitle, candidateAuthor);
            }

            // Check if the Wikipedia result is actually about the right topic
            if (!this.isRelevantWikipediaMatch(data.extract || '', candidateTitle, candidateAuthor)) {
                return this.queryWikipediaSearch(candidateTitle, candidateAuthor);
            }

            const similarity = this.titleSimilarity(candidateTitle, data.title || '');

            return {
                source: 'wikipedia',
                title: data.title,
                summary: data.extract,
                url: data.content_urls?.desktop?.page,
                imageUrl: data.thumbnail?.source,
                sourceName: 'Wikipedia',
                similarity,
            };
        } catch (error) {
            console.log(`[CompositeArticles:Wikipedia] Error: ${error}`);
            return null;
        }
    }

    /**
     * Check if a Wikipedia result is actually about the expected topic.
     * Prevents false positives like "What Lies Beneath" (climate) → horror movie.
     */
    private isRelevantWikipediaMatch(summary: string, candidateTitle: string, candidateAuthor: string): boolean {
        if (!summary) return true; // Can't check, assume OK

        const summaryLower = summary.toLowerCase();

        // Check if the author name appears in the summary
        if (candidateAuthor) {
            const authorParts = candidateAuthor.toLowerCase().split(/\s+/).filter(p => p.length > 2);
            if (authorParts.some(part => summaryLower.includes(part))) {
                return true;
            }
        }

        // Check if "book", "article", "essay", "paper", "publication" appear —
        // signs that the Wikipedia page is about a written work
        const workIndicators = ['book', 'article', 'essay', 'paper', 'publication', 'report', 'journal', 'magazine', 'authored', 'written by', 'published'];
        if (workIndicators.some(w => summaryLower.includes(w))) {
            return true;
        }

        // If the Wikipedia summary is about a movie, song, band, or clearly unrelated
        const wrongDomainIndicators = ['film directed', 'starring', 'album by', 'song by', 'television series', 'video game', 'sports team'];
        if (wrongDomainIndicators.some(w => summaryLower.includes(w))) {
            console.log(`[CompositeArticles:Wikipedia] Rejected wrong-domain match: "${summary.substring(0, 60)}..."`);
            return false;
        }

        return true; // Default: allow
    }

    private async queryWikipediaSearch(candidateTitle: string, candidateAuthor: string = ''): Promise<ArticleMatch | null> {
        try {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(candidateTitle)}&format=json&srlimit=3`;
            const response = await fetch(searchUrl);

            if (!response.ok) return null;

            const data = await response.json();
            const results = data.query?.search || [];

            if (results.length === 0) return null;

            // Find best title match
            let bestResult = results[0];
            let bestSim = this.titleSimilarity(candidateTitle, bestResult.title);

            for (const result of results.slice(1)) {
                const sim = this.titleSimilarity(candidateTitle, result.title);
                if (sim > bestSim) {
                    bestResult = result;
                    bestSim = sim;
                }
            }

            // Get summary for best result
            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestResult.title)}`;
            const summaryResponse = await fetch(summaryUrl);

            if (!summaryResponse.ok) return null;

            const summaryData = await summaryResponse.json();

            // Check relevance
            if (!this.isRelevantWikipediaMatch(summaryData.extract || '', candidateTitle, candidateAuthor)) {
                return null;
            }

            return {
                source: 'wikipedia',
                title: summaryData.title,
                summary: summaryData.extract,
                url: summaryData.content_urls?.desktop?.page,
                imageUrl: summaryData.thumbnail?.source,
                sourceName: 'Wikipedia',
                similarity: bestSim,
            };
        } catch (error) {
            console.log(`[CompositeArticles:Wikipedia:Search] Error: ${error}`);
            return null;
        }
    }

    // =========================================================================
    // Curated Crawler (when deployed)
    // =========================================================================

    private async queryCurated(query: string, candidateTitle: string): Promise<ArticleMatch | null> {
        if (!this.curatedApiUrl) return null;

        try {
            const url = `${this.curatedApiUrl}/api/search`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: 3 }),
            });

            if (!response.ok) {
                console.log(`[CompositeArticles:Curated] HTTP ${response.status}`);
                return null;
            }

            const data = await response.json();
            const results = data.results || [];

            let bestMatch: ArticleMatch | null = null;
            for (const result of results) {
                const similarity = this.titleSimilarity(candidateTitle, result.title || '');
                if (!bestMatch || similarity > bestMatch.similarity) {
                    bestMatch = {
                        source: 'curated',
                        title: result.title,
                        author: result.author_name,
                        publishedAt: result.published_at,
                        sourceName: result.source_name,
                        imageUrl: result.og_image,
                        url: result.canonical_url,
                        summary: result.lede,
                        readingTimeMinutes: result.reading_time_minutes,
                        wordCount: result.word_count,
                        qualityScore: result.quality_score,
                        topics: result.topics,
                        similarity,
                    };
                }
            }

            if (bestMatch) {
                console.log(`[CompositeArticles:Curated] Found: "${bestMatch.title}" (sim: ${bestMatch.similarity.toFixed(2)})`);
            }
            return bestMatch;
        } catch (error) {
            console.log(`[CompositeArticles:Curated] Error: ${error}`);
            return null;
        }
    }

    // =========================================================================
    // Title Similarity
    // =========================================================================

    /**
     * Compute bidirectional word overlap between two titles.
     * Returns 0-1 score where 1 = perfect match.
     * Requires at least 2 overlapping content words to avoid
     * single-word false positives (e.g. "sea" matching across unrelated titles).
     */
    private titleSimilarity(a: string, b: string): number {
        const wordsA = this.normalizeTitle(a);
        const wordsB = this.normalizeTitle(b);

        if (wordsA.length === 0 || wordsB.length === 0) return 0;

        const setB = new Set(wordsB);

        const overlap = wordsA.filter(w => setB.has(w)).length;

        // Require at least 2 overlapping content words
        // Single-word matches are too noisy (e.g. "sea" in both "The Darkening Sea" and "Dead Sea Scrolls")
        if (overlap < 2 && wordsA.length >= 2) return 0;

        // Bidirectional: fraction of A words in B, and fraction of B words in A
        const fwd = overlap / wordsA.length;
        const bwd = overlap / wordsB.length;

        // Harmonic mean for balanced score
        if (fwd + bwd === 0) return 0;
        return (2 * fwd * bwd) / (fwd + bwd);
    }

    private normalizeTitle(title: string): string[] {
        // Lowercase, remove punctuation, split into words, filter stopwords
        const stopwords = new Set([
            'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
            'for', 'of', 'with', 'by', 'from', 'is', 'it', 'its', 'as',
            'was', 'are', 'be', 'been', 'being', 'have', 'has', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'can', 'that', 'which', 'who', 'whom',
            'this', 'these', 'those', 'not', 'no', 'nor',
        ]);

        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopwords.has(w));
    }

    async healthCheck(): Promise<boolean> {
        // At least one source should be configured
        return !!(this.newsapiKey || this.curatedApiUrl);
    }
}
