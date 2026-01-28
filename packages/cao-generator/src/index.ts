/**
 * CAO Generator Package
 * 
 * Uses Gemini with native grounding to generate Compound Answer Objects.
 */

export { CAOGenerator } from './generator.js';
export { TwoStageGenerator, type TwoStageResult } from './two-stage-generator.js';
export { StreamingCAOGenerator, type StreamingCandidate } from './streaming-generator.js';
export { buildPrompt } from './prompt-builder.js';
export { parseCAO } from './parser.js';
export { classifyTemporality, needsGrounding, type TemporalityResult, type TemporalityType } from './temporality.js';



