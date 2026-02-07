#!/usr/bin/env npx tsx
/**
 * Stage 1c Evaluation Script
 * 
 * Runs summary + forUser prompts against test fixtures and scores
 * the outputs using an LLM judge across 5 dimensions.
 * 
 * Usage: npx tsx packages/cao-generator/src/eval-stage1c.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSummaryPrompt, buildForUserPrompt, parseSummaryResponse, parseForUserResponse } from './stage-1c-prompt.js';
import { fixtures, type EvalFixture } from './test-fixtures.js';

// Load .env from monorepo root
try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2];
        }
    }
} catch { /* .env not found, rely on shell env */ }

// ============================================================================
// Config
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const generatorModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
});
const judgeModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
});

// ============================================================================
// Generation
// ============================================================================

interface GeneratedOutput {
    candidateName: string;
    summary: string;
    forUser: string;
}

async function generate(fixture: EvalFixture): Promise<GeneratedOutput[]> {
    const summaryPrompt = buildSummaryPrompt(fixture.candidates, fixture.queryText, fixture.domain);
    const forUserPrompt = buildForUserPrompt(fixture.candidates, fixture.capsule, fixture.queryText, fixture.domain);

    const [summaryResult, forUserResult] = await Promise.all([
        generatorModel.generateContent(summaryPrompt),
        generatorModel.generateContent(forUserPrompt),
    ]);

    const summaries = parseSummaryResponse(summaryResult.response.text());
    const personalizations = parseForUserResponse(forUserResult.response.text());

    return fixture.candidates.map(c => ({
        candidateName: c.name,
        summary: summaries.summaries[c.name] || '[MISSING]',
        forUser: personalizations.personalizations[c.name] || '[MISSING]',
    }));
}

// ============================================================================
// Judging
// ============================================================================

interface ScoreDimension {
    score: number;       // 1-5
    explanation: string;
}

interface JudgeResult {
    candidateName: string;
    tone: ScoreDimension;
    errors: ScoreDimension;
    length: ScoreDimension;
    insightfulness: ScoreDimension;
    distinctness: ScoreDimension;
    average: number;
}

async function judge(
    output: GeneratedOutput,
    fixture: EvalFixture
): Promise<JudgeResult> {
    const prompt = `You are evaluating the quality of AI-generated recommendation text. Be a TOUGH grader.

QUERY: "${fixture.queryText}"
DOMAIN: ${fixture.domain}
ITEM: "${output.candidateName}"

SUMMARY (informative, third-person — describes what the result is and how it fits the search):
"${output.summary}"

FOR_USER (conversational, second-person — explains how it matches the user's personal preferences):
"${output.forUser}"

USER PREFERENCES: ${JSON.stringify(fixture.capsule.members?.[0]?.preferences || {})}

Score each dimension 1-5 with a brief explanation:

1. TONE (1-5): Does it sound like a real person who genuinely cares, not a helpful assistant?
   5 = Reads like a close friend texting you a recommendation — genuine excitement, real personality, no hedging
   4 = Friendly and helpful, but still sounds like an advisor more than a friend. Watch for: "could be", "might be", "it depends on", or cautious phrasing that softens everything
   3 = Professional and polite but impersonal, reads like a helpful chatbot
   2 = Formulaic, uses template phrases, sounds like ad copy
   1 = Robotic, reads like a database entry or product spec

2. ERRORS (1-5): Free of UUIDs, "User 1", internal references, scoring mechanics?
   5 = Clean, no issues
   1 = Contains internal references, mechanical language, or factual impossibilities

3. LENGTH (1-5): Is each text 1-2 sentences, substantive but concise?
   5 = Perfect length, every word earns its place
   1 = Way too long (essays) or too short (stubs like "A nice place")

4. INSIGHTFULNESS (1-5): Does it surface SPECIFIC, NON-OBVIOUS details? For the FOR_USER text, does it connect to NICHE, SPECIFIC interests rather than broad categories?
   5 = Mentions a specific dish/scene/detail AND connects to a NICHE user preference (e.g., "your love of bossa nova" not "your interest in music"; "the wood-fired lamb" not "Italian food")
   4 = Has some specific details but connections to preferences are broad-category ("fits your sci-fi preference" instead of referencing a specific director or theme they love)
   3 = Adds some information beyond the name but nothing surprising or particularly specific
   2 = Mostly generic, could swap the item name and the text would still work
   1 = Completely generic, "A great option for your search"

5. DISTINCTNESS (1-5): Do summary and forUser serve clearly different purposes?
   5 = Summary describes the result objectively; ForUser connects to personal preferences
   1 = Both say essentially the same thing

Return ONLY JSON:
{
  "tone": {"score": N, "explanation": "..."},
  "errors": {"score": N, "explanation": "..."},
  "length": {"score": N, "explanation": "..."},
  "insightfulness": {"score": N, "explanation": "..."},
  "distinctness": {"score": N, "explanation": "..."}
}`;

    try {
        const result = await judgeModel.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);
        const avg = (
            parsed.tone.score +
            parsed.errors.score +
            parsed.length.score +
            parsed.insightfulness.score +
            parsed.distinctness.score
        ) / 5;

        return {
            candidateName: output.candidateName,
            tone: parsed.tone,
            errors: parsed.errors,
            length: parsed.length,
            insightfulness: parsed.insightfulness,
            distinctness: parsed.distinctness,
            average: Math.round(avg * 100) / 100,
        };
    } catch (error) {
        console.error(`  ⚠️  Judge failed for ${output.candidateName}:`, error);
        return {
            candidateName: output.candidateName,
            tone: { score: 0, explanation: 'Judge failed' },
            errors: { score: 0, explanation: 'Judge failed' },
            length: { score: 0, explanation: 'Judge failed' },
            insightfulness: { score: 0, explanation: 'Judge failed' },
            distinctness: { score: 0, explanation: 'Judge failed' },
            average: 0,
        };
    }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║          Stage 1c Quality Evaluation              ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    const allScores: number[] = [];
    const dimensionTotals = { tone: 0, errors: 0, length: 0, insightfulness: 0, distinctness: 0 };
    let totalItems = 0;

    for (const fixture of fixtures) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📋 ${fixture.name}`);
        console.log(`   Query: "${fixture.queryText}"`);
        console.log(`   Domain: ${fixture.domain} | ${fixture.candidates.length} candidates`);
        console.log('═'.repeat(60));

        // Generate
        console.log('  ⚙️  Generating summary + forUser...');
        const outputs = await generate(fixture);

        // Print generated outputs
        for (const out of outputs) {
            console.log(`\n  📍 ${out.candidateName}`);
            console.log(`     Summary:  ${out.summary}`);
            console.log(`     ForUser:  ${out.forUser}`);
        }

        // Judge each output (parallel within fixture to speed up)
        console.log('\n  🔍 Judging quality...');
        const judgeResults = await Promise.all(
            outputs.map(out => judge(out, fixture))
        );

        // Print scores
        for (const jr of judgeResults) {
            console.log(`\n  📊 ${jr.candidateName} — avg: ${jr.average}`);
            console.log(`     Tone: ${jr.tone.score}/5 — ${jr.tone.explanation}`);
            console.log(`     Errors: ${jr.errors.score}/5 — ${jr.errors.explanation}`);
            console.log(`     Length: ${jr.length.score}/5 — ${jr.length.explanation}`);
            console.log(`     Insight: ${jr.insightfulness.score}/5 — ${jr.insightfulness.explanation}`);
            console.log(`     Distinct: ${jr.distinctness.score}/5 — ${jr.distinctness.explanation}`);

            allScores.push(jr.average);
            dimensionTotals.tone += jr.tone.score;
            dimensionTotals.errors += jr.errors.score;
            dimensionTotals.length += jr.length.score;
            dimensionTotals.insightfulness += jr.insightfulness.score;
            dimensionTotals.distinctness += jr.distinctness.score;
            totalItems++;
        }
    }

    // Aggregate report
    const overallAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    console.log(`\n\n${'═'.repeat(60)}`);
    console.log('📈 AGGREGATE SCORES');
    console.log('═'.repeat(60));
    console.log(`  Overall Average: ${(overallAvg).toFixed(2)} / 5.0  ${overallAvg >= 4.0 ? '✅ PASS' : '❌ BELOW TARGET (4.0)'}`);
    console.log(`  Tone:           ${(dimensionTotals.tone / totalItems).toFixed(2)}`);
    console.log(`  Errors:         ${(dimensionTotals.errors / totalItems).toFixed(2)}`);
    console.log(`  Length:         ${(dimensionTotals.length / totalItems).toFixed(2)}`);
    console.log(`  Insightfulness: ${(dimensionTotals.insightfulness / totalItems).toFixed(2)}`);
    console.log(`  Distinctness:   ${(dimensionTotals.distinctness / totalItems).toFixed(2)}`);
    console.log(`  Items scored:   ${totalItems}`);
    console.log('═'.repeat(60));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
