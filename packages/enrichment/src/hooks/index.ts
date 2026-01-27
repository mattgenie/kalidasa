/**
 * Hook Registry Factory
 * 
 * Creates a fully populated HookRegistry with all available hooks.
 */

import { HookRegistry } from '../registry.js';

// Import all hooks
import { GooglePlacesHook } from './google-places.js';
import { TMDBHook } from './tmdb.js';
import { OMDbHook } from './omdb.js';
import { YouTubeHook } from './youtube.js';
import { VimeoHook } from './vimeo.js';
import { AppleMusicHook } from './apple-music.js';
import { EventbriteHook } from './eventbrite.js';
import { TicketmasterHook } from './ticketmaster.js';
import { NewsAPIHook } from './newsapi.js';
import { DiffbotHook } from './diffbot.js';
import { NewsMeshHook } from './newsmesh.js';
import { WikipediaHook } from './wikipedia.js';

/**
 * Create a HookRegistry with all hooks registered.
 * This is the main entry point for setting up enrichment.
 */
export function createHookRegistry(): HookRegistry {
    const registry = new HookRegistry();

    // Places
    registry.register(new GooglePlacesHook());

    // Movies & TV
    registry.register(new TMDBHook());
    registry.register(new OMDbHook());

    // Music
    registry.register(new AppleMusicHook());

    // Events
    registry.register(new EventbriteHook());
    registry.register(new TicketmasterHook());

    // Videos
    registry.register(new YouTubeHook());
    registry.register(new VimeoHook());

    // News & Articles
    registry.register(new NewsAPIHook());
    registry.register(new DiffbotHook());
    registry.register(new NewsMeshHook());

    // Trusted Voices
    registry.register(new WikipediaHook());

    return registry;
}

// Re-export all hooks
export { GooglePlacesHook } from './google-places.js';
export { TMDBHook } from './tmdb.js';
export { OMDbHook } from './omdb.js';
export { YouTubeHook } from './youtube.js';
export { VimeoHook } from './vimeo.js';
export { AppleMusicHook } from './apple-music.js';
export { EventbriteHook } from './eventbrite.js';
export { TicketmasterHook } from './ticketmaster.js';
export { NewsAPIHook } from './newsapi.js';
export { DiffbotHook } from './diffbot.js';
export { NewsMeshHook } from './newsmesh.js';
export { WikipediaHook } from './wikipedia.js';
