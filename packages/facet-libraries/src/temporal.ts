/**
 * Temporal Facets (Events & Time)
 */

import type { Facet } from '@kalidasa/types';

export const temporalFacets: Facet[] = [
    {
        id: 'temporal.now_trending',
        label: 'Trending Now',
        signals: ['trending', 'viral', 'hot', 'buzzing', 'popular now'],
    },
    {
        id: 'temporal.upcoming',
        label: 'Upcoming',
        signals: ['upcoming', 'coming soon', 'next week', 'this weekend', 'future'],
    },
    {
        id: 'temporal.seasonal',
        label: 'Seasonal',
        signals: ['seasonal', 'holiday', 'summer', 'winter', 'spring', 'fall'],
    },
    {
        id: 'temporal.limited_time',
        label: 'Limited Time',
        signals: ['limited time', 'ends soon', 'last chance', 'expires'],
    },
    {
        id: 'temporal.recurring',
        label: 'Recurring',
        signals: ['weekly', 'monthly', 'annual', 'regular', 'ongoing'],
    },
    {
        id: 'temporal.historical',
        label: 'Historical',
        signals: ['historical', 'past', 'classic', 'vintage', 'retrospective'],
    },
];
