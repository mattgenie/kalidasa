/**
 * Authority Facets (People & Organizations)
 */

import type { Facet } from '@kalidasa/types';

export const authorityFacets: Facet[] = [
    {
        id: 'authority.official',
        label: 'Official Source',
        signals: ['official', 'from the company', 'from the creator', 'primary source'],
    },
    {
        id: 'authority.expert',
        label: 'Expert',
        signals: ['expert', 'specialist', 'professional', 'authority on'],
    },
    {
        id: 'authority.practitioner',
        label: 'Practitioner',
        signals: ['practitioner', 'working in', 'hands-on experience', 'real-world'],
    },
    {
        id: 'authority.academic',
        label: 'Academic',
        signals: ['professor', 'researcher', 'academic', 'university'],
    },
    {
        id: 'authority.journalist',
        label: 'Journalist',
        signals: ['journalist', 'reporter', 'correspondent', 'investigative'],
    },
    {
        id: 'authority.influencer',
        label: 'Influencer',
        signals: ['influencer', 'content creator', 'popular', 'youtuber'],
    },
    {
        id: 'authority.institution',
        label: 'Institution',
        signals: ['institution', 'organization', 'company', 'government'],
    },
    {
        id: 'authority.community',
        label: 'Community Voice',
        signals: ['community', 'user', 'crowd-sourced', 'peer'],
    },
];
