/**
 * Startup Environment Validation
 *
 * Runs immediately after dotenv loads. Checks every required API key
 * and refuses to start the server if any are missing.
 *
 * This file MUST be imported before any enrichment hooks or other
 * modules that read process.env in their constructors.
 *
 * Terminology:
 *   - domainCritical: true  = key is essential for its domain (e.g., NEWSMESH_KEY for News).
 *                              Missing → that domain is degraded/disabled via circuit breaker.
 *   - domainCritical: false = key is supplementary (e.g., DIFFBOT_TOKEN for News).
 *                              Missing → reduced quality, but domain still works.
 *
 * System-fatal keys (GEMINI_API_KEY) are handled separately by the boot
 * reachability probe in index.ts — this file only controls the startup banner.
 */

interface EnvSpec {
    key: string;
    domain: string;
    domainCritical: boolean;
}

const REQUIRED_KEYS: EnvSpec[] = [
    // Core — always required (also validated by boot probe in index.ts)
    { key: 'GEMINI_API_KEY', domain: 'Core', domainCritical: true },

    // Places
    { key: 'GOOGLE_PLACES_API_KEY', domain: 'Places', domainCritical: true },

    // Events
    { key: 'TICKETMASTER_CONSUMER_KEY', domain: 'Events', domainCritical: true },
    { key: 'EVENTBRITE_API_KEY', domain: 'Events', domainCritical: false },
    { key: 'SERPAPI_API_KEY', domain: 'Events', domainCritical: false },

    // Movies & TV
    { key: 'TMDB_LB_BASE_URL', domain: 'Movies', domainCritical: true },
    { key: 'OMDB_API_KEY', domain: 'Movies', domainCritical: false },

    // Music
    { key: 'APPLE_MUSIC_TOKEN', domain: 'Music', domainCritical: false },

    // News & Articles
    { key: 'NEWSAPI_KEY', domain: 'News', domainCritical: false },
    { key: 'DIFFBOT_TOKEN', domain: 'News', domainCritical: false },
    { key: 'NEWSMESH_KEY', domain: 'News', domainCritical: true },

    // Books
    { key: 'GOOGLE_BOOKS_API_KEY', domain: 'Books', domainCritical: false },

    // Video
    { key: 'VIMEO_ACCESS_TOKEN', domain: 'Video', domainCritical: false },
];

function validateEnvironment(): void {
    const missing: EnvSpec[] = [];
    const present: EnvSpec[] = [];

    for (const spec of REQUIRED_KEYS) {
        const value = process.env[spec.key];
        if (!value || value === '' || value.startsWith('your-')) {
            missing.push(spec);
        } else {
            present.push(spec);
        }
    }

    const domainCriticalMissing = missing.filter(k => k.domainCritical);
    const optionalMissing = missing.filter(k => !k.domainCritical);

    // Always print the status banner
    const width = 55;
    const line = '═'.repeat(width);

    if (domainCriticalMissing.length > 0) {
        // WARNING — domains will be degraded, but server still starts
        console.error('');
        console.error(`╔${line}╗`);
        console.error(`║  ⚠️  ENV VALIDATION — SOME DOMAINS WILL BE DEGRADED  ║`);
        console.error(`╠${line}╣`);

        for (const spec of domainCriticalMissing) {
            const label = `  ⚠️  ${spec.key}`;
            const domain = `(${spec.domain}, domain-critical)`;
            const padded = `${label} ${domain}`.padEnd(width);
            console.error(`║${padded}║`);
        }

        for (const spec of optionalMissing) {
            const label = `  ℹ️  ${spec.key}`;
            const domain = `(${spec.domain}, optional)`;
            const padded = `${label} ${domain}`.padEnd(width);
            console.error(`║${padded}║`);
        }

        console.error(`╠${line}╣`);
        const msg = `  ${domainCriticalMissing.length} domain-critical key(s) missing.`;
        console.error(`║${msg.padEnd(width)}║`);
        console.error(`║${'  Affected domains will be disabled at runtime.'.padEnd(width)}║`);
        console.error(`╚${line}╝`);
        console.error('');
    } else {
        // All domain-critical keys present — print success
        console.log('');
        console.log(`╔${line}╗`);
        if (optionalMissing.length === 0) {
            const msg = `  ✅ ENV VALIDATION — ALL ${REQUIRED_KEYS.length} KEYS LOADED`;
            console.log(`║${msg.padEnd(width)}║`);
        } else {
            const msg = `  ✅ ENV VALIDATION — ${present.length}/${REQUIRED_KEYS.length} keys loaded`;
            console.log(`║${msg.padEnd(width)}║`);
        }
        console.log(`╠${line}╣`);

        // Group by domain for cleaner output
        const domains = [...new Set(REQUIRED_KEYS.map(k => k.domain))];
        for (const domain of domains) {
            const domainKeys = REQUIRED_KEYS.filter(k => k.domain === domain);
            const allPresent = domainKeys.every(k => present.includes(k));
            const somePresent = domainKeys.some(k => present.includes(k));

            const icon = allPresent ? '✅' : somePresent ? '⚠️ ' : '❌';
            const lineContent = `  ${icon} ${domain}`;
            console.log(`║${lineContent.padEnd(width)}║`);

            // Only show individual keys if there's a problem
            if (!allPresent) {
                for (const spec of domainKeys) {
                    if (missing.includes(spec)) {
                        const detail = `      └─ ${spec.key} (missing)`;
                        console.log(`║${detail.padEnd(width)}║`);
                    }
                }
            }
        }

        console.log(`╚${line}╝`);
        console.log('');
    }
}

// Run immediately on import
validateEnvironment();

