/**
 * Prompt Builder
 * 
 * Builds structured prompts for CAO generation.
 */

import type { KalidasaSearchRequest } from '@kalidasa/types';
import type { FacetRegistry } from '@kalidasa/facet-libraries';

/**
 * Build the CAO generation prompt
 */
export function buildPrompt(
    request: KalidasaSearchRequest,
    facetRegistry: FacetRegistry,
    maxCandidates: number
): string {
    const domainFacets = getDomainFacets(request.query.domain, facetRegistry);
    const capsuleJson = JSON.stringify(request.capsule, null, 2);
    const logisticsJson = JSON.stringify(request.logistics, null, 2);
    const conversationContext = formatConversationContext(request.conversation);
    const excludesText = request.query.excludes?.length
        ? `\n\nEXCLUDE these from results:\n${request.query.excludes.map(e => `- ${e}`).join('\n')}`
        : '';

    return `# Kalidasa Search

You are an expert curator generating personalized recommendations. Use web grounding to find real, current options.

## Query
"${request.query.text}"

## Domain
${request.query.domain}${request.query.intent ? ` (Intent: ${request.query.intent})` : ''}${excludesText}

## Personalization Capsule
Who is searching and their preferences:
${capsuleJson}

## Logistics Context
When, where, and practical constraints:
${logisticsJson}
${conversationContext}
## Available Facets
Consider these quality signals when recommending:
${domainFacets}

## Task
Generate ${maxCandidates} high-quality recommendations that match this query.

IMPORTANT:
1. Use web grounding to find REAL, CURRENTLY EXISTING options
2. Include specific, verifiable details (exact names, locations)
3. Tailor recommendations to the personalization capsule
4. Consider all logistics constraints
5. Each recommendation must specify which enrichment_hooks to call

## Enrichment Hooks
For each result, specify which APIs should verify it:
- "google_places" - for restaurants, bars, cafes, venues
- "tmdb" - for movies and TV shows
- "omdb" - alternative for movies (use as backup to tmdb)
- "apple_music" - for songs and artists
- "youtube" - for videos
- "vimeo" - for videos (use as backup to youtube)
- "eventbrite" - for events and tickets
- "ticketmaster" - for concerts and shows
- "newsapi" - for news articles
- "wikipedia" - for general knowledge and people

## Output Format
Return valid JSON:
{
  "candidates": [
    {
      "name": "Exact, specific name",
      "type": "entity",
      "summary": "2-3 sentence description explaining what this is and why it's relevant",
      "reasoning": {
        "whyRecommended": "Why this specifically matches the query and user preferences",
        "pros": ["Specific positive aspect 1", "Specific positive aspect 2"],
        "cons": ["Honest limitation or caveat"]
      },
      "personalization": {
        "forGroup": [
          {
            "memberId": "member-id-from-capsule",
            "memberName": "Member Name",
            "note": {
              "text": "Why this is good for this specific member",
              "basis": "capsule",
              "confidence": "high"
            }
          }
        ],
        "groupNotes": ["How this satisfies the group as a whole"]
      },
      "enrichment_hooks": ["google_places"],
      "search_hint": "Specific search query to find this in external APIs",
      "facetScores": {
        "fit.budget": 0.9,
        "experience.vibe": 0.8
      }
    }
  ],
  "answerBundle": {
    "headline": "Brief summary of results, e.g., '${maxCandidates} Italian restaurants in SoHo'",
    "summary": "2-3 sentences describing what was found and key themes",
    "facetsApplied": ["fit.budget", "experience.vibe"]
  },
  "renderHints": {
    "componentType": "search_grid",
    "itemRenderer": "${getItemRenderer(request.query.domain)}"
  }
}`;
}

/**
 * Get facets formatted for the prompt
 */
function getDomainFacets(domain: string, registry: FacetRegistry): string {
    // Map API domains to facet library domains
    const domainMapping: Record<string, string[]> = {
        places: ['places'],
        movies: ['movies-tv'],
        music: ['music'],
        events: ['temporal'],
        videos: ['videos'],
        articles: ['articles', 'knowledge'],
        general: ['knowledge', 'authority'],
    };

    const facetDomains = domainMapping[domain] || ['knowledge'];
    const facets = facetDomains.flatMap(d => registry.getFacetsForDomain(d));

    if (facets.length === 0) {
        return 'No specific facets defined for this domain.';
    }

    return facets
        .slice(0, 15) // Limit to avoid prompt bloat
        .map(f => `- ${f.id}: ${f.label}`)
        .join('\n');
}

/**
 * Format conversation context for the prompt
 */
function formatConversationContext(
    conversation?: KalidasaSearchRequest['conversation']
): string {
    if (!conversation) return '';

    const parts: string[] = [];

    if (conversation.recentMessages?.length) {
        const messages = conversation.recentMessages
            .slice(-5) // Last 5 messages
            .map(m => `${m.speaker}: ${m.content}`)
            .join('\n');
        parts.push(`\n## Recent Conversation\n${messages}`);
    }

    if (conversation.previousSearches?.length) {
        parts.push(
            `\n## Previous Searches This Session\n${conversation.previousSearches.map(s => `- ${s}`).join('\n')}`
        );
    }

    if (conversation.corrections?.length) {
        parts.push(
            `\n## User Corrections (avoid repeating these issues)\n${conversation.corrections.map(c => `- ${c}`).join('\n')}`
        );
    }

    return parts.join('\n');
}

/**
 * Get the appropriate item renderer for a domain
 */
function getItemRenderer(domain: string): string {
    const renderers: Record<string, string> = {
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
