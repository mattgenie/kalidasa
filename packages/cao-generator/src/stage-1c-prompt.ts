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
        events: `Focus on: what you'd actually experience at this event. For PERFORMERS/BANDS: describe their sound, genre, signature style, notable albums or tracks, and live performance reputation — draw from your training data. For FESTIVALS/RECURRING EVENTS: describe the format, what attendees typically do, the atmosphere. For VENUES mentioned in context: note what makes the venue distinctive (intimate, outdoor, historic, etc.).
NEVER just restate the venue name and date — that information is shown separately. Your job is to tell someone what the EXPERIENCE will be like.`,
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
Use your knowledge of the artist's music, genre, albums, and live reputation to make SPECIFIC connections to user preferences. Don't just say "it's adventurous" — say WHAT about the artist or event is adventurous (their genre-blending, their experimental live sets, their deep cuts, etc.).
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

    // ---- Non-news domains: indexed format ----
    // Include search_hint context when available (e.g. venue/date for events)
    const candidateList = candidates.map((c, i) => {
        let entry = `[${i + 1}] "${c.name}"`;
        if (c.search_hint) entry += `\n    Context: ${c.search_hint}`;
        return entry;
    }).join('\n\n');

    return `Query: "${queryText}"

For each item, write a brief summary that makes someone understand why it's worth their time. Be specific and grounded — name a thesis, a mechanism, a scene, a technique. Not how it made you feel.

${domainGuidance}

PERSONA: You're a well-read friend who just finished this and is telling someone about it over coffee. You're specific about what's in it, not performing excitement about it.

STYLE:
- 1-2 sentences max
- Ground every claim in something specific — a name, a fact, a scene, a mechanism
- Vary your energy. Not everything is essential. Some things are just solid, or interesting, or flawed-but-worth-it.
- It's OK to say "it's good" without saying it's the best thing ever written

ACCURACY RULES:
- NEVER hedge. Do not write "likely", "probably", "appears to", "seems to", "potentially".
- Context (venue, date) is provided for GROUNDING, not as the summary content. Do NOT just restate the venue and date — that info is shown separately. Describe the EXPERIENCE.
- You have extensive training data about artists, bands, festivals, venues, and genres. USE IT. Describe what the artist sounds like, what albums they're known for, what their live shows are like.
- For UNFAMILIAR performers: describe the venue's character (is it intimate? a dive bar? a major concert hall?), the likely genre based on the event name and context, and what the audience can expect from the format. You know Austin venues — use that knowledge.
- NEVER write "I don't have enough information" or "I need more context". You always have enough to write a useful sentence.
- NEVER return null or an empty string. Every item MUST get a real summary.

TONE ANTI-PATTERNS (NEVER use these):
- No: "gut-wrenching", "must-read", "absolutely essential", "terrifying", "mind-blowing"
- No: "grabbed you by the throat", "keeps you up at night", "you'll never look at X the same way"
- No: "a deep dive into", "a tour de force", "a masterclass in"
- No: generic intensity words without specific observations to back them up

GOOD: "Rich reconstructs the 1979-1989 window where climate action almost happened — who pushed, who blocked, and what we lost."
GOOD: "Uses game theory to explain why competitive systems produce outcomes nobody actually wants. The Moloch metaphor landed so hard it entered the rationalist lexicon."
BAD (events): "Lil Tony performing live at Empire Garage on February 28, 2026."
     (This just restates the logistics — tell me what the EXPERIENCE is like)
GOOD (events): "Empire Garage books under-the-radar acts across hip-hop and indie — expect a packed, sweaty room with a low stage where you're right up against the performer."
     (Describes the venue character and experience even when you don't know the specific artist)
BAD: "A gut-wrenching and absolutely essential exploration that will fundamentally change how you think."

Items:
${candidateList}

Return ONLY JSON with numeric keys matching item numbers:
{
  "summaries": {"1": "summary of item 1", "2": "summary of item 2", ...}
}

You MUST return a summary for EVERY item. NEVER return null, empty string, or a sentence saying you lack information.`;
}

// ============================================================================
// ForUser Prompt (conversational, second-person)
// ============================================================================

/**
 * Check if preferences have meaningful content.
 * Returns true if there's at least one non-empty preference value.
 * Handles both flat shapes ({dietary: "no red meat"}) and
 * nested domain shapes ({places: {dietaryRestrictions: [...]}}).
 */
function hasRealPreferences(capsule: PersonalizationCapsule): boolean {
    const prefs = capsule.members?.[0]?.preferences;
    if (!prefs) return false;

    for (const val of Object.values(prefs)) {
        // Flat top-level values (e.g. {dietary: "no red meat"})
        if (typeof val === 'string' && val.length > 0) return true;
        if (typeof val === 'number') return true;
        if (typeof val === 'boolean') return true;
        if (Array.isArray(val) && val.length > 0) return true;
        // Nested domain objects (e.g. {places: {dietaryRestrictions: [...]}})
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            for (const nested of Object.values(val)) {
                if (Array.isArray(nested) && nested.length > 0) return true;
                if (typeof nested === 'string' && nested.length > 0) return true;
                if (typeof nested === 'number') return true;
                if (typeof nested === 'boolean') return true;
            }
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
    conversationContext?: string,
    /** Q4: Enrichment data per candidate for factual grounding (Places) */
    enrichmentContext?: Record<string, string>,
): string {
    const userName = capsule.members?.[0]?.name || 'you';

    // ---- News domain: indexed format ----
    if (domain === 'news') {
        const itemList = candidates.map((c, i) => {
            const source = c.identifiers?.source || '';
            const parts = (c.search_hint || c.name).split('\n---\n');
            const title = parts[0] || c.name;
            const snippet = parts[1] || '';
            let entry = `[${i + 1}]"${title}"`;
            if (source) entry += ` (${source})`;
            if (snippet) entry += `\n    ${snippet.substring(0, 200)} `;
            return entry;
        }).join('\n\n');

        const domainGuidance = getForUserGuidance(domain, newsMode);

        return `Query: "${queryText}"
User: ${userName}

For each article, give ${userName} a brief reading tip: why this piece is worth their time, what angle the outlet brings, and any caveats(paywall, editorial lean, early reporting).

    ${domainGuidance}

VOICE:
- You are a well - informed friend who reads widely and shares what's actually useful
    - Be direct: "Worth reading for the data" or "Old news if you already follow this beat"
        - Every note MUST make a CONCRETE recommendation: read / bookmark / skim, and say WHY in specific terms
            - Name what is specifically interesting or redundant — not generalities
                - NEVER say "skip this" — reframe as context: "covers ground you've likely seen" NOT "skip this"
                    - If the article is from a live blog or live - updates page, add: "Live page — content may have changed since this summary was written."
                        - 1 - 2 sentences, substantive
                            - Vary your openings

ANTI - PATTERNS(never use these):
- "the perspective might be different"(different from what ? be specific)
    - "the other side of the argument"(which side ? name the position)
    - "if you're interested"(say what makes it interesting instead)
    - "the big tech" → say "Big Tech"(no article)
        - "Read it if you want to know"(tell them what they'd learn instead)

Items:
            ${itemList}

Return ONLY JSON with numeric keys:
{
    "personalizations": { "1": "note for item 1", "2": "note for item 2", ... }
}

You MUST return a note for EVERY item.An empty value is never acceptable.`;
    }

    // ---- Non-news domains: indexed format ----
    // Format candidates as indexed list with display labels for context
    const candidateNames = enrichmentContext
        ? candidates.map((c, i) => {
            const ctx = enrichmentContext[c.name];
            return ctx ? `[${i + 1}]"${c.name}"\n  ${ctx} ` : `[${i + 1}]"${c.name}"`;
        }).join('\n')
        : candidates.map((c, i) => `[${i + 1}]"${c.name}"`).join('\n');

    if (hasRealPreferences(capsule)) {
        return buildPersonalizedPrompt(candidateNames, capsule, queryText, domain || 'places', userName, newsMode, conversationContext);
    } else {
        return buildInsiderTakePrompt(candidateNames, queryText, domain || 'places', userName, newsMode, conversationContext);
    }
}

/**
 * When user HAS real preferences: tell them what THEY specifically
 * should know about each result given their preferences.
 * 
 * The SUMMARY already covers what the result IS and why it fits the query.
 * This prompt covers the PERSONAL layer: how it connects to their
 * dietary needs, vibe preferences, budget, and things to be aware of.
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
        ? `\nCONVERSATION CONTEXT:\n${conversationContext}\nIncorporate the refinement into your personalized notes.\n`
        : '';
    const groupBlock = isGroup
        ? `\nGROUP MODE: This search is for a group: ${memberNames.join(', ')}. Each member has different preferences (shown below). STILL describe the RESULT, not the people — lead with the concrete detail, then mention which members it helps or hurts. Never say "aligns with [Name]'s preferences." Flag real tensions honestly: "The menu is mostly meat-focused, which works for Alex but leaves Jordan with limited vegetarian options."\n`
        : '';

    return `Query: "${queryText}"
User: ${userName}
${refinementBlock}${groupBlock}

CONTEXT: A separate summary already describes what each result IS. Your job is DIFFERENT — you add the PERSONAL layer that ONLY matters because of who ${userName} is. If your note would be equally useful for any random person, you've failed.

STRUCTURE (follow this pattern for EVERY note):
1. Start with a CONCRETE DETAIL about the result (a specific dish, scene, track, technique, feature)
2. Connect that detail to a SPECIFIC PREFERENCE from the JSON below
3. Optionally add a practical heads-up

RULES:
1. Every note MUST follow the DETAIL → PREFERENCE structure. Lead with what's specific about the result, then explain why it matters for this user.
2. You may ONLY reference preferences that LITERALLY APPEAR in the Preferences JSON. Before writing each note, identify the EXACT key you're referencing. Never infer preferences.
3. Tensions should name the specific alternative: "The menu is heavy on steak, but the grilled swordfish and the mushroom risotto are both excellent no-red-meat options."
4. Do NOT repeat information from the summary. Your note should be 100% new information.
5. 1-2 sentences. Every word must earn its place. No filler.
6. Each note MUST use a completely different angle — if you mentioned "adventurous" for item 1, find a different preference for item 2.
7. FACTUAL ACCURACY: "no red meat" means ONLY beef, lamb, and pork are restricted. Chicken IS FINE. Fish and seafood ARE FINE. Roast chicken is a perfect "no red meat" choice — never flag it as a concern.
8. FACTUAL GROUNDING: If context is provided with an item (venue, date, address), you may ONLY reference logistical facts that appear IN THAT CONTEXT. NEVER invent or guess a venue name, location name, date, or address. If no venue context is provided, do NOT mention any venue by name. Subjective observations (e.g. "the energy is high") are fine — invented facts are not.

${domainGuidance}

PERSONA: You are a sharp, opinionated local who has personally tried every result on this list. You give advice the way Anthony Bourdain gave restaurant advice on TV: direct, concrete, with a specific point of view. You never hedge or flatter. If something is wrong for this user, say so bluntly. If something is perfect, call out exactly what detail makes it perfect.

CRITICAL SYNTAX RULE: Never write "your" followed by a preference label. Instead of "your adventurous side" → name the specific adventurous detail. Instead of "your love of noir" → describe the noir element. The note describes the RESULT, not the USER.

BANNED (hard failures): "right up your alley", "sweet spot", "aligns with", "resonates with", "caters to", "not exactly a hidden gem", "fitting your", "your adventurous side/palate"

Learn from these BAD → GOOD pairs. Each pair shows the SAME result; the GOOD version is what to write:

Places (prefs: {dietary: "no red meat", vibes: "adventurous", budget: "moderate"}):
  BAD: "This restaurant suits your adventurous palate."
  GOOD: "The tasting menu changes weekly and the chef picks everything — exactly the kind of culinary surprise you chase."
  BAD: "Good for someone who avoids red meat."
  GOOD: "The menu is mostly red-meat-centric, but their pan-seared halibut and the mushroom pappardelle are standouts."
  BAD: "Affordable for a moderate budget."
  GOOD: "Heads up: it gets loud after 9pm, so plan for earlier if you want to actually talk."

Movies (prefs: {genres: "psychological thriller, noir", directors: "Denis Villeneuve"}):
  BAD: "Aligns with your preference for psychological thrillers."
  GOOD: "The unreliable narrator structure peels back layers for two hours before the gut-punch reveal — pure psychological thriller."
  BAD: "You'll enjoy this if you like noir films."
  GOOD: "The single-location setting amplifies the claustrophobia as reality unravels — a technique straight out of classic noir."
  BAD: "Fits your taste in directors."
  GOOD: "Villeneuve directed this — expect the same deliberate pacing and architectural shots as Sicario and Blade Runner 2049."

Music (prefs: {genres: "jazz, ambient", vibes: "mellow, late-night"}):
  BAD: "Mellow and atmospheric."
  GOOD: "The near-silence between notes on 'Blue in Green' pushes this into ambient territory — ideal for 3AM focus sessions."
  BAD: "This doesn't match your mellow preference."
  GOOD: "The tempo picks up hard in the second half, so it's less mellow background and more active listening."
  BAD: "A good choice for late-night listening."
  GOOD: "Recorded live in a tiny club, the creaking chairs and whispered applause give it a genuine late-night intimacy."

Items:
${candidateNames}

Preferences: ${prefs}

Return ONLY JSON with numeric keys matching item numbers:
{
    "personalizations": { "1": "note for item 1", "2": "note for item 2", ... }
}

You MUST return a note for EVERY item. An empty value is never acceptable.`;
}

/**
 * When user has NO preferences: give practical insider knowledge.
 * 
 * A separate summary already covers what each result IS.
 * This prompt covers what someone should KNOW — practical tips,
 * caveats, insider context that the summary doesn't cover.
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
        ? `\nCONVERSATION CONTEXT:\n${conversationContext}\nFrame your insider tips around the refinement context.\n`
        : '';

    return `Query: "${queryText}"
${refinementBlock}

CONTEXT: A separate summary already describes what each result IS and how it fits the search. Your job is DIFFERENT — you provide the practical insider knowledge:
- What should someone KNOW before trying this? (crowds, waits, noise, budget, pacing)
- What's the insider move? (what to order, where to sit, when to go, what to skip)
- What do regulars or critics consistently say that a newcomer wouldn't know?

${domainHighlights}

RULES:
1. Do NOT restate what the result IS — the summary already covers that
2. Focus on practical, actionable insider knowledge
3. Only name specific items (dishes, tracks, scenes) if you are CONFIDENT they are real
4. When in doubt, describe the TYPE instead: "the signature cocktail" not "the lavender gin fizz"
5. Present caveats as helpful heads-ups, not reasons to avoid
6. 1-2 sentences, punchy but substantive

VOICE:
- You're a local who knows the scene and genuinely wants to help
- Specific and concrete: "the window seats have the best view" not "nice atmosphere"
- Honest: "the wait can be brutal on weekends" not false enthusiasm

EXAMPLES:
- "Go on a weeknight — the crowds thin out and you'll actually hear the performers. The house margarita is the move."
- "Fair warning: the line wraps around the block on weekends, but the brisket is legitimately the best in the city."
- "The prix fixe lunch is a steal compared to dinner — same kitchen, half the price, and you'll actually get a table."
- "It's loud and buzzy, not a quiet date night spot, but the corner booth near the back is its own little world."

Items:
${candidateNames}

Return ONLY JSON with numeric keys matching item numbers:
{
    "personalizations": { "1": "insider tip for item 1", "2": "insider tip for item 2", ... }
}

You MUST return a note for EVERY item. An empty value is never acceptable.`;
}

/**
 * Domain-specific guidance for insider-take mode (no user preferences).
 */
function getInsiderGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Think like a food critic or local regular.What dish is the star ? What's the vibe on a Friday night vs Tuesday? Is it worth the wait or is it overhyped?`,
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
