/**
 * Composite Books Hook
 * 
 * Orchestrates book verification across multiple sources:
 * 1. OpenLibrary (primary — free, no key)
 * 2. Google Books API (fallback — better covers/ratings)
 * 3. Wikipedia (last resort — for well-known books)
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class CompositeBookHook implements EnrichmentHook {
    name = 'books_composite';
    domains: EnrichmentDomain[] = ['books'];
    priority = 95;

    private googleBooksKey: string;

    constructor(googleBooksKey?: string) {
        this.googleBooksKey = googleBooksKey || process.env.GOOGLE_BOOKS_API_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const title = candidate.name;
        const author = (candidate.identifiers?.author as string) || '';

        console.log(`[CompositeBooks] Searching for: "${title}" by ${author || 'unknown'}`);

        // Query sources in parallel
        const [openLibResult, googleResult, wikiResult] = await Promise.allSettled([
            this.queryOpenLibrary(title, author),
            this.queryGoogleBooks(title, author),
            this.queryWikipedia(title, author),
        ]);

        // Collect valid results
        const matches: Array<EnrichmentData & { score: number }> = [];

        if (openLibResult.status === 'fulfilled' && openLibResult.value) {
            matches.push({ ...openLibResult.value, score: 3 }); // Highest priority
        }
        if (googleResult.status === 'fulfilled' && googleResult.value) {
            matches.push({ ...googleResult.value, score: 2 });
        }
        if (wikiResult.status === 'fulfilled' && wikiResult.value) {
            matches.push({ ...wikiResult.value, score: 1 });
        }

        if (matches.length === 0) {
            console.log(`[CompositeBooks] ✗ No matches found for "${title}"`);
            return null;
        }

        // Sort by priority score
        matches.sort((a, b) => b.score - a.score);
        const best = matches[0];

        // Merge: use OpenLibrary as base, supplement with Google Books data
        if (matches.length > 1) {
            const merged = this.mergeResults(matches);
            console.log(`[CompositeBooks] ✓ Verified "${title}" from ${merged.source} (${matches.length} sources)`);
            return merged;
        }

        console.log(`[CompositeBooks] ✓ Verified "${title}" from ${best.source}`);
        return best;
    }

    private mergeResults(matches: EnrichmentData[]): EnrichmentData {
        const base = { ...matches[0] };
        const books = { ...base.books };

        // Fill in missing fields from lower-priority sources
        for (const match of matches.slice(1)) {
            const other = match.books;
            if (!other) continue;

            if (!books.coverUrl && other.coverUrl) books.coverUrl = other.coverUrl;
            if (!books.rating && other.rating) books.rating = other.rating;
            if (!books.ratingsCount && other.ratingsCount) books.ratingsCount = other.ratingsCount;
            if (!books.pageCount && other.pageCount) books.pageCount = other.pageCount;
            if (!books.publisher && other.publisher) books.publisher = other.publisher;
            if (!books.isbn && other.isbn) books.isbn = other.isbn;
            if (!books.year && other.year) books.year = other.year;
            if (!books.summary && other.summary) books.summary = other.summary;
            if (!books.googleBooksUrl && other.googleBooksUrl) books.googleBooksUrl = other.googleBooksUrl;
        }

        base.books = books;
        return base;
    }

    // ---- OpenLibrary ----

    private async queryOpenLibrary(title: string, author: string): Promise<EnrichmentData | null> {
        try {
            const params = new URLSearchParams({ q: title, limit: '5' });
            if (author) params.set('author', author);

            const response = await fetch(
                `https://openlibrary.org/search.json?${params.toString()}`,
                { headers: { 'User-Agent': 'Kalidasa/1.0' } }
            );

            if (!response.ok) return null;

            const data = await response.json();
            const docs = data.docs || [];

            const best = this.findBestMatch(docs, title, author);
            if (!best) return null;

            const coverId = best.cover_i;
            const coverUrl = coverId
                ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
                : undefined;

            console.log(`[CompositeBooks:OpenLib] ✓ "${best.title}" by ${best.author_name?.[0] || 'unknown'}`);

            return {
                verified: true,
                source: 'books_composite:openlibrary',
                books: {
                    title: best.title,
                    author: best.author_name?.[0] || author,
                    publisher: best.publisher?.[0],
                    year: best.first_publish_year,
                    pageCount: best.number_of_pages_median,
                    coverUrl,
                    isbn: best.isbn?.[0],
                    openLibraryUrl: best.key ? `https://openlibrary.org${best.key}` : undefined,
                    subjects: best.subject?.slice(0, 5),
                },
            };
        } catch (error) {
            console.log(`[CompositeBooks:OpenLib] Error: ${error}`);
            return null;
        }
    }

    // ---- Google Books ----

    private async queryGoogleBooks(title: string, author: string): Promise<EnrichmentData | null> {
        if (!this.googleBooksKey) return null;

        try {
            let query = `intitle:${title}`;
            if (author) query += `+inauthor:${author}`;

            const params = new URLSearchParams({
                q: query,
                key: this.googleBooksKey,
                maxResults: '5',
                langRestrict: 'en',
            });

            const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
            console.log(`[CompositeBooks:Google] Querying for "${title}"...`);
            const response = await fetch(url);

            if (!response.ok) {
                console.log(`[CompositeBooks:Google] API error ${response.status} for "${title}"`);
                return null;
            }

            const data = await response.json();
            const items = data.items || [];

            if (items.length === 0) {
                console.log(`[CompositeBooks:Google] No items for "${title}"`);
                return null;
            }

            const best = this.findBestGoogleMatch(items, title, author);
            if (!best) {
                console.log(`[CompositeBooks:Google] No title match for "${title}" (${items.length} candidates)`);
                return null;
            }

            const vol = best.volumeInfo;

            console.log(`[CompositeBooks:Google] ✓ "${vol.title}" by ${vol.authors?.[0] || 'unknown'}`);

            return {
                verified: true,
                source: 'books_composite:google_books',
                books: {
                    title: vol.title,
                    author: vol.authors?.[0] || author,
                    publisher: vol.publisher,
                    year: vol.publishedDate ? parseInt(vol.publishedDate.substring(0, 4)) : undefined,
                    pageCount: vol.pageCount,
                    coverUrl: vol.imageLinks?.thumbnail?.replace('http:', 'https:'),
                    isbn: vol.industryIdentifiers?.find((id: any) => id.type === 'ISBN_13')?.identifier
                        || vol.industryIdentifiers?.find((id: any) => id.type === 'ISBN_10')?.identifier,
                    googleBooksUrl: vol.infoLink,
                    rating: vol.averageRating,
                    ratingsCount: vol.ratingsCount,
                    summary: vol.description?.substring(0, 400),
                    subjects: vol.categories?.slice(0, 5),
                },
            };
        } catch (error) {
            console.log(`[CompositeBooks:Google] Error: ${error}`);
            return null;
        }
    }

    // ---- Wikipedia ----

    private async queryWikipedia(title: string, author: string): Promise<EnrichmentData | null> {
        try {
            const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
            const response = await fetch(searchUrl);

            if (!response.ok) return null;

            const data = await response.json();
            if (data.type === 'disambiguation') return null;

            // Must be a book-related article
            const extract = (data.extract || '').toLowerCase();
            const bookIndicators = ['book', 'novel', 'memoir', 'biography', 'written by', 'authored', 'published', 'nonfiction', 'non-fiction', 'chapters', 'pages'];
            const isBook = bookIndicators.some(w => extract.includes(w));

            // Reject non-book pages
            const wrongDomain = ['film directed', 'starring', 'album by', 'song by', 'television series', 'video game', 'sports team'];
            const isWrongDomain = wrongDomain.some(w => extract.includes(w));

            if (!isBook || isWrongDomain) return null;

            // Title similarity check
            const sim = this.titleSimilarity(title, data.title || '');
            if (sim < 0.35) return null;

            // Try to extract year from extract (e.g. "published in 2014", "first published 2014")
            const yearMatch = extract.match(/(?:published|released|written)\s+(?:in\s+)?(\d{4})/i)
                || extract.match(/\b((?:19|20)\d{2})\b.*(?:book|novel|published)/i);
            const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

            console.log(`[CompositeBooks:Wiki] ✓ "${data.title}"${year ? ` (${year})` : ''}`);

            return {
                verified: true,
                source: 'books_composite:wikipedia',
                books: {
                    title: data.title,
                    author: author,  // Wikipedia doesn't always give author clearly
                    year,
                    coverUrl: data.thumbnail?.source,
                    summary: data.extract,
                },
            };
        } catch (error) {
            console.log(`[CompositeBooks:Wiki] Error: ${error}`);
            return null;
        }
    }

    // ---- Matching helpers ----

    private findBestMatch(docs: any[], targetTitle: string, targetAuthor: string): any | null {
        const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const targetNorm = normalize(targetTitle);

        let bestDoc = null;
        let bestScore = 0;

        for (const doc of docs) {
            let score = this.titleSimilarity(targetTitle, doc.title || '');

            // Author match bonus
            if (targetAuthor && doc.author_name) {
                const authorLower = targetAuthor.toLowerCase();
                if (doc.author_name.some((a: string) => a.toLowerCase().includes(authorLower) || authorLower.includes(a.toLowerCase()))) {
                    score += 0.3;
                }
            }

            // Exact title bonus
            if (normalize(doc.title || '') === targetNorm) score += 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestDoc = doc;
            }
        }

        return bestScore >= 0.4 ? bestDoc : null;
    }

    private findBestGoogleMatch(items: any[], targetTitle: string, targetAuthor: string): any | null {
        let bestItem = null;
        let bestScore = 0;

        for (const item of items) {
            const vol = item.volumeInfo || {};
            let score = this.titleSimilarity(targetTitle, vol.title || '');

            // Author bonus
            if (targetAuthor && vol.authors) {
                const authorLower = targetAuthor.toLowerCase();
                if (vol.authors.some((a: string) => a.toLowerCase().includes(authorLower) || authorLower.includes(a.toLowerCase()))) {
                    score += 0.3;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestItem = item;
            }
        }

        return bestScore >= 0.4 ? bestItem : null;
    }

    private titleSimilarity(a: string, b: string): number {
        const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'has', 'have', 'from', 'that', 'this', 'with']);

        // Also compare stripped versions (before subtitle colon/dash)
        const stripSub = (t: string) => t.split(/[:\-–—]/)[0].trim();
        const strippedA = stripSub(a);
        const strippedB = stripSub(b);

        // If the main title parts match well, boost significantly
        const mainA = normalize(strippedA).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
        const mainB = normalize(strippedB).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

        const wordsA = normalize(a).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
        const wordsB = normalize(b).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

        if (wordsA.length === 0 || wordsB.length === 0) return 0;

        // Main-title-only comparison (ignore subtitle differences)
        if (mainA.length > 0 && mainB.length > 0) {
            const mainSetB = new Set(mainB);
            const mainOverlap = mainA.filter(w => mainSetB.has(w)).length;
            const mainFwd = mainOverlap / mainA.length;
            const mainBwd = mainOverlap / mainB.length;
            // If main titles match nearly perfectly, return high score
            if (mainFwd >= 0.8 && mainBwd >= 0.8) return 0.85;
        }

        const setB = new Set(wordsB);
        const overlap = wordsA.filter(w => setB.has(w)).length;

        // Relaxed: require ≥1 word overlap for short titles (≤3 words)
        const minOverlap = wordsA.length <= 3 ? 1 : 2;
        if (overlap < minOverlap) return 0;

        const fwd = overlap / wordsA.length;
        const bwd = overlap / wordsB.length;

        if (fwd + bwd === 0) return 0;
        return (2 * fwd * bwd) / (fwd + bwd);
    }

    async healthCheck(): Promise<boolean> {
        return true; // OpenLibrary doesn't need a key
    }
}
