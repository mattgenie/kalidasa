/**
 * Temporality Classifier
 * 
 * Classifies search queries by temporal requirements to route
 * grounding decisions (grounded for current, ungrounded for evergreen).
 */

export type TemporalityType = 'current' | 'evergreen' | 'historical';

export interface TemporalityResult {
    type: TemporalityType;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    useGrounding: boolean;
}

// Patterns that indicate current/new content needs
const CURRENT_PATTERNS = [
    /\bnow\b/i,
    /\btoday\b/i,
    /\btonight\b/i,
    /\bthis week\b/i,
    /\bthis weekend\b/i,
    /\bthis month\b/i,
    /\bcurrently?\b/i,
    /\bplaying now\b/i,
    /\bopen now\b/i,
    /\bnew release/i,
    /\bnew album/i,
    /\bnew movie/i,
    /\bjust (released|opened|came out)/i,
    /\brecent(ly)?\b/i,
    /\blatest\b/i,
    /\b202[4-9]\b/,  // Years 2024+
    /\bupcoming\b/i,
    /\btrending\b/i,
    /\bhot right now\b/i,
    /\bin theaters\b/i,
    /\bnow streaming\b/i,
    /\bjust added\b/i,
];

// Patterns that indicate evergreen/classic content
const EVERGREEN_PATTERNS = [
    /\bbest\b/i,
    /\btop\s+\d+/i,
    /\bclassic/i,
    /\bfavorite/i,
    /\bpopular\b/i,
    /\brecommend/i,
    /\b(good|great)\s+(for|place|restaurant|movie)/i,
    /\blike\s+\w+$/i,  // "movies like X"
    /\bsimilar to\b/i,
    /\bhistoric/i,
    /\boldest\b/i,
    /\btimeless\b/i,
    /\b(90s|80s|70s|60s)\b/i,  // Decades
    /\b19\d{2}\b/,  // Years 1900-1999
    /\b20[0-2][0-3]\b/,  // Years 2000-2023
    /\ball[- ]time\b/i,
    /\bever\s+made\b/i,
];

// Domain defaults when patterns are ambiguous
const DOMAIN_DEFAULTS: Record<string, TemporalityType> = {
    places: 'current',      // Restaurant info changes (hours, reviews)
    movies: 'evergreen',    // Classic recommendations are common
    music: 'evergreen',     // Classic recommendations are common
    events: 'current',      // Events are inherently temporal
    videos: 'evergreen',    // Video recommendations usually not time-sensitive
    articles: 'current',    // News is temporal
    general: 'evergreen',   // Knowledge graphs don't change fast
};

/**
 * Classify the temporality of a search query
 */
export function classifyTemporality(
    query: string,
    domain: string
): TemporalityResult {
    const queryLower = query.toLowerCase();

    // Count pattern matches
    let currentScore = 0;
    let evergreenScore = 0;

    for (const pattern of CURRENT_PATTERNS) {
        if (pattern.test(query)) {
            currentScore++;
        }
    }

    for (const pattern of EVERGREEN_PATTERNS) {
        if (pattern.test(query)) {
            evergreenScore++;
        }
    }

    // Determine result
    if (currentScore > evergreenScore) {
        return {
            type: 'current',
            confidence: currentScore >= 2 ? 'high' : 'medium',
            reason: `Query contains ${currentScore} temporal indicators`,
            useGrounding: true,
        };
    }

    if (evergreenScore > currentScore) {
        return {
            type: 'evergreen',
            confidence: evergreenScore >= 2 ? 'high' : 'medium',
            reason: `Query contains ${evergreenScore} evergreen indicators`,
            useGrounding: false,
        };
    }

    // No strong signal - use domain default
    const defaultType = DOMAIN_DEFAULTS[domain] || 'evergreen';
    return {
        type: defaultType,
        confidence: 'low',
        reason: `Using domain default for ${domain}`,
        useGrounding: defaultType === 'current',
    };
}

/**
 * Quick check: does this query need grounding?
 */
export function needsGrounding(query: string, domain: string): boolean {
    return classifyTemporality(query, domain).useGrounding;
}
