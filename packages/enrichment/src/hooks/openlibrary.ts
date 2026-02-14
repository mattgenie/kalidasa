/**
 * OpenLibrary Hook
 * 
 * Verifies books using OpenLibrary's free search API.
 * No API key required.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class OpenLibraryHook implements EnrichmentHook {
    name = 'openlibrary';
    domains: EnrichmentDomain[] = ['books'];
    priority = 90;

    private baseUrl = 'https://openlibrary.org';

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const title = candidate.name;
        const author = (candidate.identifiers?.author as string) || '';

        try {
            // Build search query
            const params = new URLSearchParams({
                q: title,
                limit: '5',
            });
            if (author) {
                params.set('author', author);
            }

            const response = await fetch(
                `${this.baseUrl}/search.json?${params.toString()}`,
                {
                    headers: { 'User-Agent': 'Kalidasa/1.0 (search-enrichment)' },
                }
            );

            if (!response.ok) {
                console.warn(`[OpenLibrary] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const docs = data.docs || [];

            if (docs.length === 0) {
                console.log(`[OpenLibrary] No results for "${title}"`);
                return null;
            }

            // Find best title match
            const bestMatch = this.findBestMatch(docs, title, author);
            if (!bestMatch) {
                console.log(`[OpenLibrary] No good title match for "${title}"`);
                return null;
            }

            const coverId = bestMatch.cover_i;
            const coverUrl = coverId
                ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
                : undefined;

            const olKey = bestMatch.key; // e.g. "/works/OL12345W"
            const openLibraryUrl = olKey ? `${this.baseUrl}${olKey}` : undefined;

            console.log(`[OpenLibrary] ✓ Matched: "${bestMatch.title}" by ${bestMatch.author_name?.[0] || 'unknown'}`);

            return {
                verified: true,
                source: 'openlibrary',
                canonical: {
                    type: 'openlibrary_key',
                    value: olKey || title,
                },
                books: {
                    title: bestMatch.title,
                    author: bestMatch.author_name?.[0] || author,
                    publisher: bestMatch.publisher?.[0],
                    year: bestMatch.first_publish_year,
                    pageCount: bestMatch.number_of_pages_median,
                    coverUrl,
                    isbn: bestMatch.isbn?.[0],
                    openLibraryUrl,
                    subjects: bestMatch.subject?.slice(0, 5),
                    summary: bestMatch.first_sentence?.join(' '),
                },
            };
        } catch (error) {
            console.error('[OpenLibrary] Error:', error);
            return null;
        }
    }

    private findBestMatch(
        docs: any[],
        targetTitle: string,
        targetAuthor: string
    ): any | null {
        const normalizeTitle = (t: string) =>
            t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const stripSub = (t: string) => t.split(/[:\-\u2013\u2014]/)[0].trim();
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'has', 'have', 'from', 'that', 'this', 'with']);

        const targetNorm = normalizeTitle(targetTitle);
        const targetWords = targetNorm.split(/\s+/).filter(w => w.length > 2);
        const mainTarget = normalizeTitle(stripSub(targetTitle)).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

        let bestDoc = null;
        let bestScore = 0;

        for (const doc of docs) {
            const docNorm = normalizeTitle(doc.title || '');
            const docWords = docNorm.split(/\s+/).filter(w => w.length > 2);
            const mainDoc = normalizeTitle(stripSub(doc.title || '')).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

            // Main-title comparison (ignore subtitle differences)
            let score = 0;
            if (mainTarget.length > 0 && mainDoc.length > 0) {
                const mainSet = new Set(mainDoc);
                const mainOverlap = mainTarget.filter(w => mainSet.has(w)).length;
                const mainFwd = mainOverlap / mainTarget.length;
                const mainBwd = mainOverlap / mainDoc.length;
                if (mainFwd >= 0.8 && mainBwd >= 0.8) score = 0.85;
            }

            // Full word overlap score
            if (score === 0) {
                const targetSet = new Set(targetWords);
                const overlap = docWords.filter(w => targetSet.has(w)).length;
                const minOverlap = targetWords.length <= 3 ? 1 : 2;
                if (overlap < minOverlap) continue;

                const fwd = overlap / targetWords.length;
                const bwd = docWords.length > 0 ? overlap / docWords.length : 0;
                score = fwd + bwd === 0 ? 0 : (2 * fwd * bwd) / (fwd + bwd);
            }

            // Bonus for author match
            if (targetAuthor && doc.author_name) {
                const authorLower = targetAuthor.toLowerCase();
                const docAuthors = doc.author_name.map((a: string) => a.toLowerCase());
                if (docAuthors.some((a: string) => a.includes(authorLower) || authorLower.includes(a))) {
                    score += 0.3;
                }
            }

            // Bonus for exact title match
            if (docNorm === targetNorm) {
                score += 0.5;
            }

            if (score > bestScore) {
                bestScore = score;
                bestDoc = doc;
            }
        }

        // Minimum threshold
        return bestScore >= 0.4 ? bestDoc : null;
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/search.json?q=test&limit=1`, {
                headers: { 'User-Agent': 'Kalidasa/1.0 (health-check)' },
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
