/**
 * Stage 1c Prompts: Summary + Personalization (Parallel)
 * 
 * Two independent LLM calls that run in parallel:
 * - Summary: What the result IS and how it fits the query (informative, third-person)
 * - ForUser: How it matches the user's personal preferences (conversational, second-person)
 */

import type { PersonalizationCapsule } from '@kalidasa/types';
import type { Stage1aCandidate } from './stage-1a-prompt.js';
import type { NewsMode, ArticleCluster } from './news-search.js';

// ============================================================================
// Domain Guidance
// ============================================================================

function getSummaryGuidance(domain: string, newsMode?: NewsMode): string {
    // Mode-adaptive guidance for news domain
    if (domain === 'news' && newsMode) {
        return getNewsSummaryGuidance(newsMode);
    }

    const guidance: Record<string, string> = {
        places: `Focus on: what you'd actually eat there, the vibe when you walk in, what regulars love about it.
Do NOT repeat the address — that's shown separately.`,
        movies: `Focus on: what the experience of watching it feels like, its mood, standout performances or directorial choices.`,
        music: `Focus on: what it sounds like, the feeling it evokes, where it sits in the artist's journey.`,
        events: `Focus on: what you'd actually experience there, the energy, what makes it worth showing up for.`,
        videos: `Focus on: what you'll learn or feel watching it, the creator's approach, what sticks with you after.`,
        books: `Ground in what the book actually argues or shows, not how it makes you feel. Name the key thesis. If it changed how people think about the topic, say how. Reference the author's expertise.`,
        articles: `What does the author observe or argue that you won't find elsewhere? What's the one thing you'd tell someone about this piece? Reference the publication and why this piece matters there.`,
        news: `What happened, why it matters, and what's the angle this outlet brings. Be factual. Name specific developments, not vibes.`,
    };
    return guidance[domain] || guidance.places;
}

function getNewsSummaryGuidance(mode: NewsMode): string {
    if (mode === 'survey') {
        return `Each article covers a DIFFERENT topic. For each:
- What happened in 1 sentence (lead with the key fact or development)
- Why it matters in 1 sentence (consequence, significance, or stakes)
Keep it crisp — the reader is scanning multiple topics.`;
    }

    if (mode === 'thematic') {
        return `Articles cover related subtopics within a theme. For each:
- The key development or argument (1 sentence)
- What angle this particular outlet brings (1 sentence)
When two articles cover overlapping ground, note what makes each one distinct.`;
    }

    // deep mode
    return `These articles cover the SAME topic from different angles. For each:
1. What's this outlet's core framing? Lead with their thesis/angle, not the shared facts.
2. What does this article include that the others don't? (unique data, sources, regional focus)
3. What's the author's vantage point? (their beat, expertise, editorial stance)

The reader already knows the basic story — add value by contrasting perspectives.
Explicitly cross-reference other articles in the set when relevant.`;
}

function getForUserGuidance(domain: string, newsMode?: NewsMode): string {
    // Mode-adaptive guidance for news
    if (domain === 'news' && newsMode) {
        const base = `Flag paywalls. Note the outlet's editorial lean without being dismissive.
If the reader follows this topic, flag what's genuinely NEW vs rehashed context.`;
        if (newsMode === 'deep') {
            return base + `\nWhen multiple outlets cover the same story, note whose framing
aligns or challenges the reader's likely perspective.`;
        }
        return base;
    }

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
        books: `Connect to: specific chapters or arguments that match their interests, prior books on the topic they may have read.
Flag honestly: reading difficulty, length, whether it assumes prior knowledge, if it's dated.`,
        articles: `Connect to: the publication's editorial stance, how this piece fits their interests, similar pieces they may have read.
Flag honestly: paywall, reading time, if it requires prior context, if the perspective might challenge their views.`,
        news: `Connect to: their interest in this topic, how this story relates to things they follow.
Flag honestly: if it's behind a paywall, if it's early reporting that may change, the outlet's editorial lean.`,
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
    domain?: string,
    newsMode?: NewsMode,
    newsClusters?: ArticleCluster[]
): string {
    const domainGuidance = getSummaryGuidance(domain || 'places', newsMode);

    // ---- News domain: indexed format with snippets ----
    if (domain === 'news') {
        const itemList = candidates.map((c, i) => {
            const source = c.identifiers?.source || '';
            // search_hint carries "title\n---\nsnippet"
            const parts = (c.search_hint || c.name).split('\n---\n');
            const title = parts[0] || c.name;
            const snippet = parts[1] || '';
            let entry = `[${i + 1}] "${title}"`;
            if (source) entry += `\n    Source: ${source}`;
            if (snippet) entry += `\n    Content: ${snippet.substring(0, 400)}`;
            return entry;
        }).join('\n\n');

        // Cluster context for cross-referencing
        let clusterContext = '';
        if (newsClusters && newsClusters.length > 0) {
            const clusterNotes = newsClusters.map(c => {
                const indices = c.articles.map(a => {
                    const idx = candidates.findIndex(cand => cand.name === a.title);
                    return idx >= 0 ? `[${idx + 1}]` : null;
                }).filter(Boolean);
                return indices.length >= 2
                    ? `Items ${indices.join(' and ')} cover the same story — contrast their perspectives.`
                    : null;
            }).filter(Boolean).join('\n');
            if (clusterNotes) {
                clusterContext = `\n\nTOPIC CLUSTERS:\n${clusterNotes}`;
            }
        }

        return `Query: "${queryText}"

${domainGuidance}${clusterContext}

ACCURACY RULES:
- You have the article content below. Use it. State what the article ACTUALLY says.
- NEVER hedge. Do not write "likely", "probably", "appears to", "seems to".
- Lead with the concrete fact, claim, or development — not a guess about what the article covers.
- Your summary MUST include at least one specific detail (a name, number, date, or claim)
  that is NOT in the headline. If your summary just restates the headline, you have failed.
- Do NOT write "[Source] argues that [headline restated]." Say what specific evidence,
  reasoning, or developments the article provides beyond the headline claim.
- If the snippet is too short to add detail beyond the headline, describe the angle or
  framing the outlet uses and say what context it provides.

BAD: "Le Monde argues that regulating social media is key to protecting young people's health."
     (This just restates the headline — zero added value)
GOOD: "Le Monde reports on France's new Digital Majority Act, which requires age verification
       for social platforms, citing the WHO's classification of excessive screen time as a
       public health risk."
     (Adds specific legislation, specific organization, specific classification)

Brevity: 1-2 sentences max per item.

Items:
${itemList}

Return ONLY JSON with numeric keys:
{
  "summaries": {"1": "summary of item 1", "2": "summary of item 2", ...}
}

You MUST return a summary for EVERY item. Do not skip any.`;
    }

    // ---- Non-news domains: original format ----
    const candidateNames = candidates.map(c => c.name).join(', ');

    return `Query: "${queryText}"

For each item, write a brief summary that makes someone understand why it's worth their time. Be specific and grounded — name a thesis, a mechanism, a scene, a technique. Not how it made you feel.

${domainGuidance}

PERSONA: You're a well-read friend who just finished this and is telling someone about it over coffee. You're specific about what's in it, not performing excitement about it.

STYLE:
- 1-2 sentences max
- Ground every claim in something specific — a name, a fact, a scene, a mechanism
- Vary your energy. Not everything is essential. Some things are just solid, or interesting, or flawed-but-worth-it.
- It's OK to say "it's good" without saying it's the best thing ever written

TONE ANTI-PATTERNS (NEVER use these):
- No: "gut-wrenching", "must-read", "absolutely essential", "terrifying", "mind-blowing"
- No: "grabbed you by the throat", "keeps you up at night", "you'll never look at X the same way"
- No: "a deep dive into", "a tour de force", "a masterclass in"
- No: generic intensity words without specific observations to back them up

GOOD: "Rich reconstructs the 1979-1989 window where climate action almost happened — who pushed, who blocked, and what we lost."
GOOD: "Uses game theory to explain why competitive systems produce outcomes nobody actually wants. The Moloch metaphor landed so hard it entered the rationalist lexicon."
BAD: "A gut-wrenching and absolutely essential exploration that will fundamentally change how you see the world."
BAD: "This terrifying deep dive grabbed me by the throat and kept me up at night."

ACCURACY (critical):
- Only name a specific detail if you are GENUINELY CONFIDENT it exists
- If unsure, describe the approach or argument instead of fabricating specifics
- Do NOT invent quotes, statistics, or plot points — say what you know

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
    domain?: string,
    newsMode?: NewsMode,
    conversationContext?: string
): string {
    const userName = capsule.members?.[0]?.name || 'you';

    // ---- News domain: indexed format ----
    if (domain === 'news') {
        const itemList = candidates.map((c, i) => {
            const source = c.identifiers?.source || '';
            const parts = (c.search_hint || c.name).split('\n---\n');
            const title = parts[0] || c.name;
            const snippet = parts[1] || '';
            let entry = `[${i + 1}] "${title}"`;
            if (source) entry += ` (${source})`;
            if (snippet) entry += `\n    ${snippet.substring(0, 200)}`;
            return entry;
        }).join('\n\n');

        const domainGuidance = getForUserGuidance(domain, newsMode);

        return `Query: "${queryText}"
User: ${userName}

For each article, give ${userName} a brief reading tip: why this piece is worth their time, what angle the outlet brings, and any caveats (paywall, editorial lean, early reporting).

${domainGuidance}

VOICE:
- You are a well-informed friend who reads widely and shares what's actually useful
- Be direct: "Worth reading for the data" or "Old news if you already follow this beat"
- Every note MUST make a CONCRETE recommendation: read/bookmark/skim, and say WHY in specific terms
- Name what is specifically interesting or redundant — not generalities
- NEVER say "skip this" — reframe as context: "covers ground you've likely seen" NOT "skip this"
- If the article is from a live blog or live-updates page, add: "Live page — content may have changed since this summary was written."
- 1-2 sentences, substantive
- Vary your openings

ANTI-PATTERNS (never use these):
- "the perspective might be different" (different from what? be specific)
- "the other side of the argument" (which side? name the position)
- "if you're interested" (say what makes it interesting instead)
- "the big tech" → say "Big Tech" (no article)
- "Read it if you want to know" (tell them what they'd learn instead)

Items:
${itemList}

Return ONLY JSON with numeric keys:
{
  "personalizations": {"1": "note for item 1", "2": "note for item 2", ...}
}

You MUST return a note for EVERY item. An empty value is never acceptable.`;
    }

    // ---- Non-news domains: original format ----
    const candidateNames = candidates.map(c => c.name).join(', ');

    if (hasRealPreferences(capsule)) {
        return buildPersonalizedPrompt(candidateNames, capsule, queryText, domain || 'places', userName, newsMode, conversationContext);
    } else {
        return buildInsiderTakePrompt(candidateNames, queryText, domain || 'places', userName, newsMode, conversationContext);
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
    userName: string,
    newsMode?: NewsMode,
    conversationContext?: string
): string {
    const isGroup = capsule.mode === 'group' && (capsule.members?.length || 0) > 1;
    const prefs = isGroup
        ? JSON.stringify(
            Object.fromEntries(
                (capsule.members || []).map(m => [m.name, m.preferences || {}])
            )
        )
        : JSON.stringify(capsule.members?.[0]?.preferences || {});
    const memberNames = (capsule.members || []).map(m => m.name);
    const domainGuidance = getForUserGuidance(domain, newsMode);
    const refinementBlock = conversationContext
        ? `\nCONVERSATION CONTEXT:\n${conversationContext}\nFrame your notes around how each result satisfies what the user is looking for. Do NOT independently reject results — they were already curated for this refinement.\n`
        : '';
    const groupBlock = isGroup
        ? `\nGROUP MODE: This search is for a group: ${memberNames.join(', ')}. Each member has different preferences (shown below). Your job is to find what makes each result work for the GROUP — frame each note around what brings the group together (shared vibes, variety on the menu, something for everyone). Never reject a result because one member's preferences don't match — find the angle that makes it work.\n`
        : '';

    return `Query: "${queryText}"
User: ${userName}
${refinementBlock}${groupBlock}

You hand-picked each of these results for ${userName}'s search. Everything here made your cut — now tell them why each one is worth trying.

RULES (in priority order):
1. The user's QUERY and the REFINEMENTS are the intent — preferences are secondary. A user searching for "romantic Italian" WANTS Italian; do not write unfavorable descriptions because their preference history is different. Only note if a preference directly contradicts (example: the restaurant specializes in spicy food and the user does not like spicy food) in a positive manner. Example: "This is a neighborhood favorite, and offers a wide range of options for the Szechuan cuisine Amy loves. Just keep in mind it's mostly spicy, which could be a challenge."
2. Always frame every result as worth considering. Present caveats (noise, price) as helpful "heads up" context — never as a reason to avoid or skip.
3. You may ONLY reference preferences that LITERALLY APPEAR in the Preferences JSON below. If it's not in the JSON, do not reference it. If the JSON is sparse, focus on the result's inherent qualities.
4. Ground every note in something specific — a dish, a scene, a sound, a moment — not abstract preference-matching. Look at reviews to help ensure features are real.
5. 1-2 sentences, punchy, with a DIFFERENT angle for each item.

${domainGuidance}

VOICE:
- You're a friend who hand-picked these and is genuinely excited to share them
- Warm and direct: "The cacio e pepe here is RIDICULOUS" not "This pasta dish is of high quality"
- Use varied angles across items — don't repeat the same theme or reference

AVOID:
- Hedging: "might be", "could be", "it depends on"
- Robotic matching: "aligns with", "matches your profile", "fits your criteria"
- Lazy clichés: "right up your alley", "perfect for your taste"
- Bro-speak: "Dude", "Bro", "fam"
- UUIDs, member IDs, or scoring mechanics
- Referencing preferences NOT in the Preferences JSON

EXAMPLES — WHEN A RESULT DOESN'T MATCH THEIR USUAL PREFERENCES:
- "Not your usual Thai haunt, but the candlelit vibe you're after is unbeatable — and the burgundy short ribs are worth the detour."
- "A different world from your jazz picks, but the third movement has the same improvisational energy — the cellist basically solos for six minutes."
- "Hollywood through and through, but the practical effects set it apart — the helicopter crash was filmed for real at 4AM."
- "French, not Italian, but the prix fixe is a steal and the sommelier will find you something incredible — trust the house red."
- "It's loud and buzzy, not the quiet escape you asked about, but the corner booth by the window is its own little world — ask for it."

EXAMPLES — WHEN A RESULT IS A GREAT FIT:
- "The hand-drawn animation is jaw-dropping, and the way it handles grief will stick with you for days."
- "Sound design alone makes this worth it — the score practically becomes a character."
- "The director shoots conversations like heist scenes — tight cuts, no wasted frames. You'll tear through it."

Items: ${candidateNames}

Preferences: ${prefs}

Return ONLY JSON:
{
  "personalizations": {"ItemName": "1-2 sentence note explaining what makes this worth trying for ${userName}"}
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
    userName: string,
    newsMode?: NewsMode,
    conversationContext?: string
): string {
    const domainHighlights = domain === 'news' && newsMode
        ? getForUserGuidance(domain, newsMode)
        : getInsiderGuidance(domain);
    const refinementBlock = conversationContext
        ? `\nCONVERSATION CONTEXT:\n${conversationContext}\nFrame your insider tips around how each result fits what the user is looking for. Do NOT independently reject results — they were already curated for this refinement.\n`
        : '';

    return `Query: "${queryText}"
${refinementBlock}

You hand-picked each of these results for ${userName}'s search. Everything here made your cut — now give the insider take on why each one is worth checking out.

${domainHighlights}

WHAT TO INCLUDE (pick 1-2 per item):
- What regulars, critics, or reviewers consistently praise — the standout (a signature dish, the best seat, the moment everyone talks about)
- The hidden gem angle — what most people miss or don't know about
- Practical insider knowledge — when to go, what to order, where to sit
- How popular/crowded it gets — is it a scene or a hidden spot?
- Honest context — what to expect, what makes it special, the vibe

ACCURACY (critical):
- Only name specific items (dishes, songs, drinks) if you are CONFIDENT they are real
- When in doubt, describe the TYPE of thing instead: "the signature cocktail" not "the lavender gin fizz"
- It's better to say "the desserts here are incredible" than to invent a dessert name

VOICE:
- You're a local who hand-picked these and genuinely wants to help
- Enthusiastic but honest — present caveats as helpful context, not reasons to avoid
- Specific and concrete — "the window seats have the best view" not "nice atmosphere"
- Always frame every result as worth considering
- 1-2 sentences, punchy but substantive

EXAMPLES:
- "Go on a weeknight — the crowds thin out and you'll actually hear the performers. The house margarita is the move."
- "Fair warning: the line wraps around the block on weekends, but the brisket is legitimately the best in the city."
- "The prix fixe lunch is a steal compared to dinner — same kitchen, half the price, and you'll actually get a table."
- "It's loud and buzzy, not a quiet date night spot, but the corner booth near the back is its own little world."

IMPORTANT: You have NO preference data for this user. Focus on what ANYONE would want to know — the insider info, the practical tips, the things that make each place special. Write as a knowledgeable local, not as a recommendation engine.

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
        books: `Think like a well-read friend. Where does this sit in the reading order — is it the intro text or the advanced version? What should you read before or after it? What's the author's other work?`,
        articles: `Think like someone who follows this conversation closely. What's the broader debate this piece is part of? Who's responding to whom? Is this the definitive take or one of many?`,
        news: `Think like a beat reporter. What's the backstory? What are other outlets NOT covering? How does this connect to the bigger story arc?`,
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
