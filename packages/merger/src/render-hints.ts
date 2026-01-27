/**
 * Render Hints Generator
 * 
 * Generates frontend rendering hints based on domain and results.
 */

import type { RenderHints, Domain } from '@kalidasa/types';

/**
 * Generate render hints for a search response
 */
export function generateRenderHints(domain: Domain, resultCount: number): RenderHints {
    const itemRenderer = getItemRenderer(domain);
    const componentType = getComponentType(domain, resultCount);

    return {
        componentType,
        domain,
        itemRenderer,
        layout: getLayout(componentType, resultCount),
    };
}

function getItemRenderer(domain: Domain): RenderHints['itemRenderer'] {
    const renderers: Record<Domain, RenderHints['itemRenderer']> = {
        places: 'place_card',
        movies: 'movie_card',
        music: 'music_card',
        events: 'event_card',
        videos: 'video_card',
        articles: 'article_card',
        general: 'generic_card',
    };
    return renderers[domain] || 'generic_card';
}

function getComponentType(
    domain: Domain,
    resultCount: number
): RenderHints['componentType'] {
    // For small result sets, use carousel
    if (resultCount <= 5) {
        return 'carousel';
    }

    // For places with map data, use grid with map
    if (domain === 'places') {
        return 'search_grid';
    }

    // For movies/music, carousel works well
    if (domain === 'movies' || domain === 'music') {
        return resultCount <= 8 ? 'carousel' : 'search_grid';
    }

    // For articles, detailed list is better
    if (domain === 'articles') {
        return 'detailed_list';
    }

    // Default to grid
    return 'search_grid';
}

function getLayout(
    componentType: RenderHints['componentType'],
    resultCount: number
): RenderHints['layout'] {
    switch (componentType) {
        case 'search_grid':
            return {
                columns: resultCount <= 6 ? 2 : 3,
                showMap: true,
            };
        case 'carousel':
            return {
                columns: 1,
            };
        case 'detailed_list':
            return {
                columns: 1,
            };
        default:
            return {
                columns: 3,
            };
    }
}
