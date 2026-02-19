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
 * Create a HookRegistry with all hooks registered.
 * This is the main entry point for setting up enrichment.
 */
export function createHookRegistry(): HookRegistry {
    const registry = new HookRegistry();
    const failures: string[] = [];

    // Places
    registry.register(new GooglePlacesHook());

    // Movies & TV
    registry.register(new TMDBHook());
    registry.register(new OMDbHook());

    // Music — AppleMusicHook throws on missing/invalid token
    try {
        registry.register(new AppleMusicHook());
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`APPLE_MUSIC: ${msg}`);
        console.error('🚨🚨🚨 [HOOK REGISTRY] APPLE MUSIC HOOK FAILED TO INITIALIZE 🚨🚨🚨');
        console.error(`    Reason: ${msg}`);
        console.error('    Impact: ALL music enrichment will fall back to MusicBrainz only.');
        console.error('    Fix: Regenerate APPLE_MUSIC_TOKEN (JWT expires every 6 months).');
    }
    registry.register(new MusicBrainzHook());

    // Events — now handled by search-first pipeline in cao-generator
    // (Ticketmaster + LLM/Wikipedia + Gemini grounded search → LLM ranking)
    // CompositeEventsHook is no longer registered.

    // Videos — disabled pending non-technical issue resolution
    // registry.register(new YouTubeHook());
    // registry.register(new VimeoHook());

    // Books (composite: OpenLibrary + Google Books + Wikipedia)
    registry.register(new CompositeBookHook());

    // Articles — DISABLED, domain not ready yet
    // registry.register(new ExaHook());
    // registry.register(new SerpApiArticlesHook());
    // registry.register(new CompositeArticlesHook());

    // News (composite: Exa + NewsAPI with source tiering)
    registry.register(new CompositeNewsHook());

    // Trusted Voices
    registry.register(new WikipediaHook());

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
