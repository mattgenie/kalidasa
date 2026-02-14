/**
 * Exa Search Hook
 * 
 * Uses Exa's neural search API to find and verify articles, essays, and blog posts.
 * Exa excels at finding specific written works that aren't indexed by Wikipedia.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class ExaHook implements EnrichmentHook {
    name = 'exa';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 95;

    private apiKey: string;
    private baseUrl = 'https://api.exa.ai';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.EXA_API_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[Exa] No API key configured');
            return null;
        }

        const title = candidate.name;
        const author = (candidate.identifiers?.author as string) || '';
        const publication = (candidate.identifiers?.source as string) || '';

        try {
            // Build a focused search query
            let query = `"${title}"`;
            if (author) query += ` ${author}`;

            const response = await fetch(`${this.baseUrl}/search`, {
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    type: 'auto',
                    numResults: 5,
                    contents: {
                        text: { maxCharacters: 500 },
                        highlights: { numSentences: 2 },
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.warn(`[Exa] API error: ${response.status} ${errorText.substring(0, 100)}`);
                return null;
            }

            const data = await response.json();
            const results = data.results || [];

            if (results.length === 0) {
                console.log(`[Exa] No results for "${title}"`);
                return null;
            }

            // Find best matching result
            const bestMatch = this.findBestMatch(results, title, author);
            if (!bestMatch) {
                console.log(`[Exa] No good match for "${title}"`);
                return null;
            }

            // Extract reading time from text length
            const textLength = bestMatch.text?.length || 0;
            const estimatedWords = Math.round(textLength / 5);
            const readingTimeMinutes = Math.max(1, Math.round(estimatedWords / 250));

            console.log(`[Exa] ✓ Matched: "${bestMatch.title}" at ${bestMatch.url}`);

            return {
                verified: true,
                source: 'exa',
                canonical: {
                    type: 'url',
                    value: bestMatch.url,
                },
                articles: {
                    author: bestMatch.author || author,
                    publishedAt: bestMatch.publishedDate,
                    source: this.extractDomain(bestMatch.url) || publication,
                    url: bestMatch.url,
                    summary: bestMatch.highlights?.[0] || bestMatch.text?.substring(0, 300),
                    readingTimeMinutes,
                    wordCount: estimatedWords,
                },
            };
        } catch (error) {
            console.error('[Exa] Error:', error);
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

            // Bonus for author match in URL or title
            if (targetAuthor) {
                const authorLower = targetAuthor.toLowerCase();
                const authorParts = authorLower.split(/\s+/).filter(p => p.length > 2);
                const urlLower = (result.url || '').toLowerCase();
                if (authorParts.some((p: string) => urlLower.includes(p) || resultNorm.includes(p))) {
                    score += 0.2;
                }
            }

            // Exa provides a relevance score — use it as a tiebreaker
            if (result.score && result.score > 0.8) {
                score += 0.1;
            }

            if (score > bestScore) {
                bestScore = score;
                bestResult = result;
            }
        }

        return bestScore >= 0.35 ? bestResult : null;
    }

    private extractDomain(url: string): string {
        try {
            const hostname = new URL(url).hostname;
            // Strip www. and common TLDs for cleaner display
            return hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    async healthCheck(): Promise<boolean> {
        return !!this.apiKey;
    }
}
