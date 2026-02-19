/**
 * Hook Registry Factory
 * 
 * Creates a fully populated HookRegistry with all available hooks.
 * 
 * IMPORTANT: Hook initialization failures are LOUD — they log critical
 * warnings at startup so degraded service is immediately visible.
 * The build does NOT fail, but every missing hook is flagged.
 */

import { HookRegistry } from '../registry.js';

// Import all hooks
import { GooglePlacesHook } from './google-places.js';
import { TMDBHook } from './tmdb.js';
import { OMDbHook } from './omdb.js';
// Videos disabled pending non-technical issue resolution
// import { YouTubeHook } from './youtube.js';
// import { VimeoHook } from './vimeo.js';
import { AppleMusicHook } from './apple-music.js';
import { MusicBrainzHook } from './musicbrainz.js';
// Events — handled by search-first pipeline in cao-generator, not enrichment hooks
// import { CompositeEventsHook } from './composite-events.js';
import { WikipediaHook } from './wikipedia.js';
import { CompositeBookHook } from './composite-books.js';
import { CompositeNewsHook } from './composite-news.js';

// Articles domain — DISABLED, not ready yet
// import { CompositeArticlesHook } from './composite-articles.js';
// import { ExaHook } from './exa.js';
// import { SerpApiArticlesHook } from './serpapi-articles.js';

/**
 * Safely construct and register a hook. If the constructor throws,
 * log the failure and continue — never crash the boot process.
 */
function safeRegister(
    registry: HookRegistry,
    failures: string[],
    name: string,
    factory: () => import('@kalidasa/types').EnrichmentHook,
    impact?: string,
): void {
    try {
        registry.register(factory());
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${msg}`);
        console.error(`🚨 [HOOK REGISTRY] ${name} FAILED TO INITIALIZE`);
        console.error(`    Reason: ${msg}`);
        if (impact) console.error(`    Impact: ${impact}`);
    }
}

/**
 * Create a HookRegistry with all hooks registered.
 * This is the main entry point for setting up enrichment.
 */
export function createHookRegistry(): HookRegistry {
    const registry = new HookRegistry();
    const failures: string[] = [];

    // Places
    safeRegister(registry, failures, 'GooglePlaces', () => new GooglePlacesHook(),
        'Places domain enrichment unavailable.');

    // Movies & TV
    safeRegister(registry, failures, 'TMDB', () => new TMDBHook(),
        'Movies domain enrichment unavailable.');
    safeRegister(registry, failures, 'OMDb', () => new OMDbHook(),
        'Supplementary movie data (Rotten Tomatoes) unavailable.');

    // Music
    safeRegister(registry, failures, 'AppleMusic', () => new AppleMusicHook(),
        'Music enrichment will fall back to MusicBrainz only. Fix: regenerate APPLE_MUSIC_TOKEN (JWT expires every 6 months).');
    safeRegister(registry, failures, 'MusicBrainz', () => new MusicBrainzHook(),
        'MusicBrainz fallback unavailable.');

    // Events — now handled by search-first pipeline in cao-generator
    // (Ticketmaster + LLM/Wikipedia + Gemini grounded search → LLM ranking)
    // CompositeEventsHook is no longer registered.

    // Videos — disabled pending non-technical issue resolution
    // registry.register(new YouTubeHook());
    // registry.register(new VimeoHook());

    // Books (composite: OpenLibrary + Google Books + Wikipedia)
    safeRegister(registry, failures, 'CompositeBooks', () => new CompositeBookHook(),
        'Books domain enrichment unavailable.');

    // Articles — DISABLED, domain not ready yet
    // registry.register(new ExaHook());
    // registry.register(new SerpApiArticlesHook());
    // registry.register(new CompositeArticlesHook());

    // News (composite: Exa + NewsAPI with source tiering)
    safeRegister(registry, failures, 'CompositeNews', () => new CompositeNewsHook(),
        'News domain enrichment unavailable.');

    // Trusted Voices
    safeRegister(registry, failures, 'Wikipedia', () => new WikipediaHook(),
        'Wikipedia enrichment for all domains unavailable.');

    // ── Startup health summary ──
    if (failures.length > 0) {
        console.error('');
        console.error('╔══════════════════════════════════════════════════════════════╗');
        console.error('║  ⚠️  ENRICHMENT HOOKS — DEGRADED SERVICE                    ║');
        console.error('╠══════════════════════════════════════════════════════════════╣');
        for (const f of failures) {
            console.error(`║  🚨 ${f.padEnd(56)}║`);
        }
        console.error('╚══════════════════════════════════════════════════════════════╝');
        console.error('');
    } else {
        console.log('[HookRegistry] ✅ All enrichment hooks initialized successfully');
    }

    return registry;
}

// Re-export all hooks
export { GooglePlacesHook } from './google-places.js';
export { TMDBHook } from './tmdb.js';
export { OMDbHook } from './omdb.js';
export { YouTubeHook } from './youtube.js';
export { VimeoHook } from './vimeo.js';
export { AppleMusicHook } from './apple-music.js';
export { MusicBrainzHook } from './musicbrainz.js';
export { TicketmasterHook } from './ticketmaster.js';
// Events composite and Eventbrite removed — events pipeline is now in cao-generator
// export { CompositeEventsHook } from './composite-events.js';
export { SerpApiEventsHook } from './serpapi-events.js';
export { CompositeArticlesHook } from './composite-articles.js';
export { CompositeBookHook } from './composite-books.js';
export { ExaHook } from './exa.js';
export { SerpApiArticlesHook } from './serpapi-articles.js';
export { NewsAPIHook } from './newsapi.js';
export { DiffbotHook } from './diffbot.js';
export { WikipediaHook } from './wikipedia.js';
export { CompositeNewsHook, NewsSearcher } from './composite-news.js';
