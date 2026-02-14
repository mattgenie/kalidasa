/**
 * SerpAPI Articles Hook
 * 
 * Uses SerpAPI's Google Search to find real URLs for articles,
 * then optionally extracts article data via Diffbot.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class SerpApiArticlesHook implements EnrichmentHook {
    name = 'serpapi_articles';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 80;  // Lower than Exa — used as fallback

    private apiKey: string;
    private diffbotToken: string;
    private baseUrl = 'https://serpapi.com/search.json';

    constructor(apiKey?: string, diffbotToken?: string) {
        this.apiKey = apiKey || process.env.SERPAPI_API_KEY || '';
        this.diffbotToken = diffbotToken || process.env.DIFFBOT_TOKEN || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[SerpApiArticles] No API key configured');
            return null;
        }

        const title = candidate.name;
        const author = (candidate.identifiers?.author as string) || '';

        try {
            // Search Google for the exact article
            let query = `"${title}"`;
            if (author) query += ` ${author}`;

            const params = new URLSearchParams({
                engine: 'google',
                q: query,
                api_key: this.apiKey,
                hl: 'en',
                gl: 'us',
                num: '5',
            });

            const response = await fetch(`${this.baseUrl}?${params.toString()}`);

            if (!response.ok) {
                console.warn(`[SerpApiArticles] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const results = data.organic_results || [];

            if (results.length === 0) {
                console.log(`[SerpApiArticles] No results for "${title}"`);
                return null;
            }

            // Find best matching result
            const bestMatch = this.findBestMatch(results, title, author);
            if (!bestMatch) {
                console.log(`[SerpApiArticles] No good match for "${title}"`);
                return null;
            }

            console.log(`[SerpApiArticles] ✓ Found: "${bestMatch.title}" at ${bestMatch.link}`);

            // Try Diffbot extraction for richer data
            if (this.diffbotToken && bestMatch.link) {
                const diffbotResult = await this.extractWithDiffbot(bestMatch.link);
                if (diffbotResult) {
                    console.log(`[SerpApiArticles] ✓ Diffbot extracted: ${diffbotResult.author || 'unknown author'}`);
                    return {
                        verified: true,
                        source: 'serpapi_articles:diffbot',
                        canonical: { type: 'url', value: bestMatch.link },
                        articles: {
                            author: diffbotResult.author || author,
                            publishedAt: diffbotResult.date,
                            source: diffbotResult.siteName || this.extractDomain(bestMatch.link),
                            imageUrl: diffbotResult.imageUrl,
                            url: bestMatch.link,
                            summary: diffbotResult.text?.substring(0, 400),
                            wordCount: diffbotResult.wordCount,
                            readingTimeMinutes: diffbotResult.wordCount
                                ? Math.max(1, Math.round(diffbotResult.wordCount / 250))
                                : undefined,
                        },
                    };
                }
            }

            // Fall back to SerpAPI snippet data
            return {
                verified: true,
                source: 'serpapi_articles',
                canonical: { type: 'url', value: bestMatch.link },
                articles: {
                    author: author,
                    source: this.extractDomain(bestMatch.link),
                    url: bestMatch.link,
                    summary: bestMatch.snippet,
                },
            };
        } catch (error) {
            console.error('[SerpApiArticles] Error:', error);
            return null;
        }
    }

    private async extractWithDiffbot(url: string): Promise<{
        author?: string;
        date?: string;
        siteName?: string;
        imageUrl?: string;
        text?: string;
        wordCount?: number;
    } | null> {
        try {
            const apiUrl = `https://api.diffbot.com/v3/article?token=${this.diffbotToken}&url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl, {
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) return null;

            const data = await response.json();
            const object = data.objects?.[0];
            if (!object) return null;

            return {
                author: object.author,
                date: object.date,
                siteName: object.siteName,
                imageUrl: object.images?.[0]?.url,
                text: object.text,
                wordCount: object.text ? object.text.split(/\s+/).length : undefined,
            };
        } catch {
            return null;
        }
    }

    private findBestMatch(
        results: any[],
        targetTitle: string,
        targetAuthor: string
    ): any | null {
        const normalize = (t: string) =>
            t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

        const targetNorm = normalize(targetTitle);
        const targetWords = targetNorm.split(/\s+/).filter(w => w.length > 2);
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'from', 'that', 'this', 'with', 'what', 'how', 'why', 'who', 'when', 'where', 'about', 'into', 'will', 'been', 'more', 'than', 'them', 'then', 'some', 'very']);
        const contentWords = targetWords.filter(w => !stopWords.has(w));

        let bestResult = null;
        let bestScore = 0;

        for (const result of results) {
            const resultNorm = normalize(result.title || '');
            const resultWords = resultNorm.split(/\s+/).filter(w => w.length > 2);
            const resultContent = resultWords.filter(w => !stopWords.has(w));

            // Word overlap
            const targetSet = new Set(contentWords);
            const overlap = resultContent.filter(w => targetSet.has(w)).length;

            if (overlap < 2 && contentWords.length >= 2) continue;

            const fwd = contentWords.length > 0 ? overlap / contentWords.length : 0;
            const bwd = resultContent.length > 0 ? overlap / resultContent.length : 0;
            let score = fwd + bwd === 0 ? 0 : (2 * fwd * bwd) / (fwd + bwd);

            // Bonus for author in snippet or domain
            if (targetAuthor) {
                const authorLower = targetAuthor.toLowerCase();
                const snippetLower = (result.snippet || '').toLowerCase();
                const urlLower = (result.link || '').toLowerCase();
                if (snippetLower.includes(authorLower) || urlLower.includes(authorLower.split(' ').pop() || '')) {
                    score += 0.15;
                }
            }

            // Skip Wikipedia results (we have a dedicated Wikipedia path)
            if ((result.link || '').includes('wikipedia.org')) continue;

            if (score > bestScore) {
                bestScore = score;
                bestResult = result;
            }
        }

        return bestScore >= 0.35 ? bestResult : null;
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    async healthCheck(): Promise<boolean> {
        return !!this.apiKey;
    }
}
