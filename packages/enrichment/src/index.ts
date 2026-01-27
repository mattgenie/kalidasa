/**
 * Kalidasa Enrichment Package
 * 
 * Provides the enrichment hook framework and all hook implementations.
 */

export { HookRegistry } from './registry.js';
export { EnrichmentExecutor } from './executor.js';
export { createHookRegistry } from './hooks/index.js';

// Re-export hook implementations for direct access if needed
export { GooglePlacesHook } from './hooks/google-places.js';
export { TMDBHook } from './hooks/tmdb.js';
export { OMDbHook } from './hooks/omdb.js';
export { YouTubeHook } from './hooks/youtube.js';
export { VimeoHook } from './hooks/vimeo.js';
export { AppleMusicHook } from './hooks/apple-music.js';
export { EventbriteHook } from './hooks/eventbrite.js';
export { TicketmasterHook } from './hooks/ticketmaster.js';
export { NewsAPIHook } from './hooks/newsapi.js';
export { DiffbotHook } from './hooks/diffbot.js';
export { NewsMeshHook } from './hooks/newsmesh.js';
export { WikipediaHook } from './hooks/wikipedia.js';
