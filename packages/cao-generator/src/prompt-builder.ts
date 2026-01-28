/**
 * Prompt Builder
 * 
 * Builds structured prompts for CAO generation.
 * Optimized for latency with domain-specific identifiers.
 */

import type { KalidasaSearchRequest } from '@kalidasa/types';
import type { FacetRegistry } from '@kalidasa/facet-libraries';

/**
 * Get domain-specific identifier requirements
 */
function getIdentifierSpec(domain: string): string {
  const specs: Record<string, string> = {
    places: '"identifiers": {"address": "...", "city": "..."}',
    movies: '"identifiers": {"year": 2024, "director": "..."}',
    music: '"identifiers": {"artist": "...", "album": "..."}',
    articles: '"identifiers": {"source": "...", "date": "YYYY-MM-DD", "url": "..."}',
    videos: '"identifiers": {"channel": "...", "url": "..."}',
    events: '"identifiers": {"venue": "...", "date": "YYYY-MM-DD", "city": "..."}',
    general: '"identifiers": {"wikipedia_title": "..."}',
  };
  return specs[domain] || specs.general;
}

/**
 * Build the CAO generation prompt
 */
export function buildPrompt(
  request: KalidasaSearchRequest,
  facetRegistry: FacetRegistry,
  maxCandidates: number
): string {
  const capsuleJson = JSON.stringify(request.capsule, null, 2);
  const logisticsJson = JSON.stringify(request.logistics, null, 2);
  const conversationContext = formatConversationContext(request.conversation);
  const excludesText = request.query.excludes?.length
    ? `\nEXCLUDE: ${request.query.excludes.join(', ')}`
    : '';
  const identifierSpec = getIdentifierSpec(request.query.domain);

  return `# Kalidasa Search

You are a curator generating personalized recommendations. Use web grounding to find real, current options.

## Query: "${request.query.text}"
## Domain: ${request.query.domain}${excludesText}

## User Preferences
${capsuleJson}

## Context
${logisticsJson}${conversationContext}

## Task
Generate ${maxCandidates} high-quality recommendations. Use web grounding for real, verifiable results.

For personalization: Think about why each result matches the user's preferences. Include personalization notes in output.

## Enrichment Hooks (specify which API verifies each result)
- google_places (restaurants/venues) | tmdb/omdb (movies) | apple_music (songs)
- youtube/vimeo (videos) | eventbrite/ticketmaster (events) | newsapi (articles) | wikipedia (general)

## Output Format
Return ONLY valid JSON (no markdown, no explanation):
{
  "candidates": [
    {
      "name": "Exact name",
      ${identifierSpec},
      "summary": "Brief description",
      "personalization": {"forUser": "Why this is good for the user based on their preferences"},
      "enrichment_hooks": ["hook_name"],
      "search_hint": "search query for enrichment API"
    }
  ],
  "answerBundle": {"headline": "N results found", "summary": "Brief summary of what was found"}
}`;
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
      .slice(-3) // Last 3 messages
      .map(m => `${m.speaker}: ${m.content}`)
      .join('\n');
    parts.push(`\n## Recent Conversation\n${messages}`);
  }

  if (conversation.previousSearches?.length) {
    parts.push(
      `\n## Previous Searches\n${conversation.previousSearches.slice(-3).map(s => `- ${s}`).join('\n')}`
    );
  }

  return parts.join('\n');
}
