/**
 * Startup Environment Validation
 *
 * Runs immediately after dotenv loads. Checks every required API key
 * and refuses to start the server if any are missing.
 *
 * This file MUST be imported before any enrichment hooks or other
 * modules that read process.env in their constructors.
 */

interface EnvSpec {
    key: string;
    domain: string;
    critical: boolean;
}

const REQUIRED_KEYS: EnvSpec[] = [
    // Core — always required
    { key: 'GEMINI_API_KEY', domain: 'Core', critical: true },

    // Places
    { key: 'GOOGLE_PLACES_API_KEY', domain: 'Places', critical: true },

    // Events
    { key: 'TICKETMASTER_CONSUMER_KEY', domain: 'Events', critical: true },
    { key: 'EVENTBRITE_API_KEY', domain: 'Events', critical: false },
    { key: 'SERPAPI_API_KEY', domain: 'Events', critical: false },

    // Movies & TV
    { key: 'TMDB_LB_BASE_URL', domain: 'Movies', critical: true },
    { key: 'OMDB_API_KEY', domain: 'Movies', critical: false },

    // Music
    { key: 'APPLE_MUSIC_TOKEN', domain: 'Music', critical: false },

    // News & Articles
    { key: 'NEWSAPI_KEY', domain: 'News', critical: true },
    { key: 'DIFFBOT_TOKEN', domain: 'News', critical: false },
    { key: 'NEWSMESH_KEY', domain: 'News', critical: false },

    // Books
    { key: 'GOOGLE_BOOKS_API_KEY', domain: 'Books', critical: false },

    // Video
    { key: 'VIMEO_ACCESS_TOKEN', domain: 'Video', critical: false },
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

    const criticalMissing = missing.filter(k => k.critical);
    const optionalMissing = missing.filter(k => !k.critical);

    // Always print the status banner
    const width = 55;
    const line = '═'.repeat(width);

    if (criticalMissing.length > 0) {
        // FATAL — refuse to start
        console.error('');
        console.error(`╔${line}╗`);
        console.error(`║  ❌ ENV VALIDATION FAILED — SERVER WILL NOT START   ║`);
        console.error(`╠${line}╣`);

        for (const spec of criticalMissing) {
            const label = `  ❌ ${spec.key}`;
            const domain = `(${spec.domain})`;
            const padded = `${label} ${domain}`.padEnd(width);
            console.error(`║${padded}║`);
        }

        for (const spec of optionalMissing) {
            const label = `  ⚠️  ${spec.key}`;
            const domain = `(${spec.domain}, optional)`;
            const padded = `${label} ${domain}`.padEnd(width);
            console.error(`║${padded}║`);
        }

        console.error(`╠${line}╣`);
        const msg = `  ${criticalMissing.length} critical key(s) missing.`;
        console.error(`║${msg.padEnd(width)}║`);
        console.error(`║${'  Check .env file and restart.'.padEnd(width)}║`);
        console.error(`╚${line}╝`);
        console.error('');
        process.exit(1);
    }

    // All critical keys present — print success
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

// Run immediately on import
validateEnvironment();
