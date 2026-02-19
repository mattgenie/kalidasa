/**
 * CAO Generator Package
 * 
 * Uses Gemini with native grounding to generate Compound Answer Objects.
 */


export { TwoStageGenerator, type TwoStageResult } from './two-stage-generator.js';
export { StreamingCAOGenerator, type StreamingCandidate } from './streaming-generator.js';
export { classifyTemporality, needsGrounding, type TemporalityResult, type TemporalityType } from './temporality.js';

// Stage 1a exports
export { type Stage1aCandidate } from './stage-1a-prompt.js';

// News search pipeline (used by both batch and streaming handlers)
export { NewsSearchEngine, type NewsSearchResult, type NewsMode, type ArticleCluster } from './news-search.js';

// Events search pipeline (used by both batch and streaming handlers)
export { EventsSearchEngine, type RawEvent, type EventsSearchResult } from './events-search.js';

// Stage 1c exports (shared prompts for both batch and streaming paths)
export {
    buildSummaryPrompt, parseSummaryResponse, type SummaryResponse,
    buildForUserPrompt, parseForUserResponse, type ForUserResponse,
} from './stage-1c-prompt.js';
