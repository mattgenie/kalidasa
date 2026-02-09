/**
 * Stage 1c Prompts: Summary + Personalization (Parallel)
 * 
 * Two independent LLM calls that run in parallel:
 * - Summary: What the result IS and how it fits the query (informative, third-person)
 * - ForUser: How it matches the user's personal preferences (conversational, second-person)
 */

import type { PersonalizationCapsule } from '@kalidasa/types';
import type { Stage1aCandidate } from './stage-1a-prompt.js';

// ============================================================================
// Domain Guidance
// ============================================================================

function getSummaryGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Focus on: what you'd actually eat there, the vibe when you walk in, what regulars love about it.
Do NOT repeat the address — that's shown separately.`,
        movies: `Focus on: what the experience of watching it feels like, its mood, standout performances or directorial choices.`,
        music: `Focus on: what it sounds like, the feeling it evokes, where it sits in the artist's journey.`,
        events: `Focus on: what you'd actually experience there, the energy, what makes it worth showing up for.`,
        videos: `Focus on: what you'll learn or feel watching it, the creator's approach, what sticks with you after.`,
        articles: `Focus on: the core argument or revelation, why it matters now, the perspective it offers.`,
    };
    return guidance[domain] || guidance.places;
}

function getForUserGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Connect to: their cuisine cravings, the vibe they're after, their budget sweet spot.
Flag honestly: noise level, long waits, dietary gaps, if it's more of a scene than a meal.`,
        movies: `Connect to: genres and directors they already love, themes that resonate with them.
Flag honestly: pacing, intensity, if it's a very different style from their usual picks.`,
        music: `Connect to: artists and sounds they already enjoy, the mood they're chasing.
Flag honestly: if it's a departure from their comfort zone, very experimental, or lyrically intense.`,
        events: `Connect to: the kind of fun they're looking for, energy level, social dynamics.
Flag honestly: timing, crowds, cost, if it's really more of a couples/solo thing.`,
        videos: `Connect to: topics they nerd out about, creator styles they gravitate toward.
Flag honestly: length, if it's too basic or too advanced for where they are.`,
        articles: `Connect to: topics they follow, intellectual curiosity, career relevance.
Flag honestly: reading time, paywall, if the perspective might challenge their views.`,
    };
    return guidance[domain] || guidance.places;
}

// ============================================================================
// Summary Prompt (informative, third-person)
// ============================================================================

/**
 * Build prompt for generating summaries of candidates.
 * These describe WHAT each result is and how it fits the search criteria.
 */
export function buildSummaryPrompt(
    candidates: Stage1aCandidate[],
    queryText: string,
    domain?: string
): string {
    const candidateNames = candidates.map(c => c.name).join(', ');
    const domainGuidance = getSummaryGuidance(domain || 'places');

    return `Query: "${queryText}"

For each item, write a brief summary that makes someone genuinely curious about it. Be honest — if it's a great fit, say why; if it's a stretch, say that too.

${domainGuidance}

PERSONA: You're an enthusiast sharing a find, not a guide describing options. Think food blogger, film critic, music journalist — someone with genuine opinions and personality.

STYLE:
- 1-2 sentences max
- Write with genuine enthusiasm and personality — have an OPINION, take a STANCE
- Lead with the most interesting or distinctive thing about it
- COMMIT to your take — say "this is incredible" or "this falls short" — not "this might be good"

ACCURACY (critical):
- Only name a specific dish, song, scene, or feature if you are GENUINELY CONFIDENT it exists
- If unsure whether a specific item is real, describe the CATEGORY instead: "the handmade pasta" not "the truffle pappardelle"
- Describe what the EXPERIENCE is like rather than naming items you're unsure about
- Do NOT invent menu items, comedy bits, songs, or features — say what you know

GOOD: "The handmade pasta here is outstanding — the open kitchen and buzzing energy make it worth braving the wait."
GOOD: "A slow-burn sci-fi that gets under your skin — the final act is genuinely unsettling."
BAD: "The truffle-infused rigatoni al forno is a must-try" (unless you're CERTAIN this dish exists)
BAD: "His bit about airline food is killer" (unless you're CERTAIN this bit exists)

Anti-patterns (NEVER do these):
- No hedging: no "might be", "could be", "it depends on", "suitable for", "may appeal to"
- No distancing: no "it is known for", "it is considered" — just state your take directly
- No catalog words: no "offers", "features", or "provides"
- No user names, UUIDs, or scoring mechanics
- No generic adjectives without specifics: not "interesting themes" but name the theme

Items: ${candidateNames}

Return ONLY JSON:
{
  "summaries": {"ItemName": "1-2 sentence summary"}
}

If you don't recognize an item or can't write a genuine summary, set its value to null — do NOT write an explanation or apology.`;
}

// ============================================================================
// ForUser Prompt (conversational, second-person)
// ============================================================================

/**
 * Check if preferences have meaningful content.
 * Returns true if there's at least one non-empty preference value.
 */
function hasRealPreferences(capsule: PersonalizationCapsule): boolean {
    const prefs = capsule.members?.[0]?.preferences;
    if (!prefs) return false;

    // Check all preference domains for non-empty arrays or actual values
    for (const domainPrefs of Object.values(prefs)) {
        if (typeof domainPrefs !== 'object' || domainPrefs === null) continue;
        for (const val of Object.values(domainPrefs)) {
            if (Array.isArray(val) && val.length > 0) return true;
            if (typeof val === 'string' && val.length > 0) return true;
            if (typeof val === 'number') return true;
            if (typeof val === 'boolean') return true;
        }
    }
    return false;
}

/**
 * Build prompt for generating personalization notes.
 * 
 * TWO MODES:
 * - With real user preferences → personalized match ("connects to your love of...")
 * - Without preferences → review-grounded insider take ("regulars love...", "the hidden gem is...")
 * 
 * This dual-mode prevents hallucinated preferences when the user has no profile data.
 */
export function buildForUserPrompt(
    candidates: Stage1aCandidate[],
    capsule: PersonalizationCapsule,
    queryText: string,
    domain?: string
): string {
    const candidateNames = candidates.map(c => c.name).join(', ');
    const userName = capsule.members?.[0]?.name || 'you';

    if (hasRealPreferences(capsule)) {
        return buildPersonalizedPrompt(candidateNames, capsule, queryText, domain || 'places', userName);
    } else {
        return buildInsiderTakePrompt(candidateNames, queryText, domain || 'places', userName);
    }
}

/**
 * When user HAS real preferences: reference them specifically.
 */
function buildPersonalizedPrompt(
    candidateNames: string,
    capsule: PersonalizationCapsule,
    queryText: string,
    domain: string,
    userName: string
): string {
    const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});
    const domainGuidance = getForUserGuidance(domain);

    return `Query: "${queryText}"
User: ${userName}
Preferences: ${prefs}

For each item, tell ${userName} why they'd personally love it (or honestly, why it won't click for them). Ground every note in something SPECIFIC — a dish, a scene, a sound, a moment — not abstract preference-matching.

Reference at least one SPECIFIC item from ${userName}'s preferences BY NAME. Not "your favorite genres" but the actual genre/artist/cuisine/director name. If they love Radiohead, say "Radiohead"; if they love Thai food, say "Thai"; if they hate horror, say "horror."

PRIORITY: Their most niche, specific interests trump broad categories. "Your love of bossa nova" beats "your music taste." "The noir influence" beats "your favorite genres."

${domainGuidance}

VOICE:
- You're a friend who's been there and is genuinely excited to share
- Warm and direct: "The cacio e pepe here is RIDICULOUS" not "This pasta dish is of high quality"
- COMMIT: say "you'll love this" or "skip this one" — never "might be" or "could work"
- 1-2 sentences, punchy but substantive
- Vary how you open each note — don't start the same way twice

Anti-patterns (NEVER do these):
- No hedging: "might be", "could be", "it depends on", "may appeal to"
- No "aligns with your preference" / "matches your profile" / "fits your criteria"
- No bro-speak: no "Dude", "Bro", "fam", or similar slang
- No UUIDs, member IDs, or scoring mechanics
- No "based on your" more than once across all items

Items: ${candidateNames}

Return ONLY JSON:
{
  "personalizations": {"ItemName": "1-2 sentence personal note for ${userName}"}
}`;
}

/**
 * When user has NO preferences: give review-grounded insider takes.
 * This replaces forced personalization with genuinely useful guidance
 * drawn from reviews, local knowledge, and popular opinion.
 */
function buildInsiderTakePrompt(
    candidateNames: string,
    queryText: string,
    domain: string,
    userName: string
): string {
    const domainHighlights = getInsiderGuidance(domain);

    return `Query: "${queryText}"

For each item, give ${userName} the kind of insider tip a well-connected local friend would share. Focus on what makes each one stand out and what to actually DO there — the stuff you only learn from going.

${domainHighlights}

WHAT TO INCLUDE (pick 1-2 per item):
- What regulars, critics, or reviewers consistently praise — the standout (a signature dish, the best seat, the moment everyone talks about)
- The hidden gem angle — what most people miss or don't know about
- Practical insider knowledge — when to go, what to avoid, what to order
- How popular/crowded it gets — is it a scene or a hidden spot?
- Honest caveats — what disappoints, what's overrated, what to skip

ACCURACY (critical):
- Only name specific items (dishes, songs, drinks) if you are CONFIDENT they are real
- When in doubt, describe the TYPE of thing instead: "the signature cocktail" not "the lavender gin fizz"
- It's better to say "the desserts here are incredible" than to invent a dessert name

VOICE:
- You're a local who's been there many times, sharing what you genuinely think
- Enthusiastic but honest — call out what's overrated as readily as what's great
- Specific and concrete — "the window seats have the best view" not "nice atmosphere"
- 1-2 sentences, punchy but substantive

BAD: "A popular spot that many people enjoy visiting." (generic, says nothing)
BAD: "This aligns with your interest in live music." (inventing preferences — you have NO user preference data!)
GOOD: "Go on a weeknight — the crowds thin out and you'll actually hear the performers. The house margarita is the move."
GOOD: "Fair warning: the line wraps around the block on weekends, but the brisket is legitimately the best in the city."

CRITICAL: You do NOT have preference data for this user. Do NOT invent or assume preferences. Do NOT say things like "right up your alley" or "perfect for your taste" — you don't know their taste. Instead, tell them what ANYONE would want to know.

Items: ${candidateNames}

Return ONLY JSON:
{
  "personalizations": {"ItemName": "1-2 sentence insider take for ${userName}"}
}`;
}

/**
 * Domain-specific guidance for insider-take mode (no user preferences).
 */
function getInsiderGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Think like a food critic or local regular. What dish is the star? What's the vibe on a Friday night vs Tuesday? Is it worth the wait or is it overhyped?`,
        movies: `Think like a film buff friend. What's the standout performance? Is it a crowd-pleaser or a divisive one? What kind of mood should you be in to watch it?`,
        music: `Think like a music journalist. What's the signature sound? Where does this fit in their discography? Is this an entry point or deep cut territory?`,
        events: `Think like a local who's been to this event before. What's the energy like? What should you not miss? Is it worth the ticket price? Any pro tips (parking, where to stand, what to eat)?`,
        videos: `Think like someone who watches a lot of this creator's content. What makes this one special? Is it accessible for newcomers or for fans?`,
        articles: `Think like a well-read friend. What's the key insight? Is it accessible or niche? How long should you set aside?`,
    };
    return guidance[domain] || guidance.places;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Summary result from the summary pass
 */
export interface SummaryResponse {
    summaries: Record<string, string>;
}

/**
 * Personalization result from the forUser pass
 */
export interface ForUserResponse {
    personalizations: Record<string, string>;
}

/**
 * Combined Stage 1c response (for backward compatibility with TwoStageGenerator)
 */
export interface Stage1cResponse {
    personalizations: Record<string, CandidatePersonalization>;
    answerBundle?: {
        headline: string;
        summary: string;
    };
}

/**
 * Personalization result for a single candidate
 */
export interface CandidatePersonalization {
    forUser: string;
    summary?: string;
}

// ============================================================================
// Parsers
// ============================================================================

/**
 * Parse summary response
 */
export function parseSummaryResponse(text: string): SummaryResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.summaries && typeof parsed.summaries === 'object') {
        return { summaries: parsed.summaries };
    }
    console.error('[Stage1c-Summary] Failed to parse response:', text.substring(0, 200));
    return { summaries: {} };
}

/**
 * Parse forUser response
 */
export function parseForUserResponse(text: string): ForUserResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.personalizations && typeof parsed.personalizations === 'object') {
        return { personalizations: parsed.personalizations };
    }
    console.error('[Stage1c-ForUser] Failed to parse response:', text.substring(0, 200));
    return { personalizations: {} };
}

/**
 * Parse Stage 1c response (legacy compatibility)
 */
export function parseStage1cResponse(text: string): Stage1cResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.personalizations) {
        return parsed;
    }
    console.error('[Stage1c] Failed to parse response:', text.substring(0, 200));
    return { personalizations: {} };
}

/**
 * Robust JSON extraction from LLM text
 */
function parseJsonFromText(text: string): any {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch { /* continue */ }

    // Try markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
        try {
            return JSON.parse(match[1].trim());
        } catch { /* continue */ }
    }

    // Try to find object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch { /* continue */ }
    }

    return null;
}

// ============================================================================
// Legacy Exports (kept for backward compatibility)
// ============================================================================

/**
 * Build Stage 1c prompt - legacy single-call version
 * @deprecated Use buildSummaryPrompt + buildForUserPrompt instead
 */
export function buildStage1cPrompt(
    candidates: Stage1aCandidate[],
    capsule: PersonalizationCapsule,
    queryText: string,
    domain?: string
): string {
    // Delegate to forUser prompt for backward compat
    return buildForUserPrompt(candidates, capsule, queryText, domain);
}
