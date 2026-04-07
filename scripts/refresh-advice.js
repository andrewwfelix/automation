#!/usr/bin/env node
/**
 * refresh-advice-orchestrated.js
 * 
 * Orchestrates advice generation:
 * 1. Call DeepSeek → generate its advice.md
 * 2. Call Grok → generate its advice.md
 * 3. Call Claude → review both, produce consolidated-advice.md
 * 
 * Usage:
 *   node scripts/refresh-advice-orchestrated.js
 * 
 * Configuration:
 *   - config/advice-config.json (see example below)
 *   - .env file with OPENROUTER_API_KEY
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ------------------------------------------------------------------
// PATHS
// ------------------------------------------------------------------
const scriptDir = path.dirname(path.resolve(process.argv[1]));
const CONFIG_PATH = path.join(scriptDir, 'config', 'advice-config.json');
const ADVICE_BASE = path.join(scriptDir, 'docs', 'advice');
const PROJECT_DIR = path.join(scriptDir, 'docs', 'project');

// ------------------------------------------------------------------
// UTILITIES
// ------------------------------------------------------------------
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ------------------------------------------------------------------
// LOAD CONFIG
// ------------------------------------------------------------------
function loadAdviceConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ Advice config not found: ${CONFIG_PATH}`);
    console.log('Create a file with structure like:');
    console.log(JSON.stringify({
      models: [
        { name: "deepseek", displayName: "DeepSeek V3", openRouterId: "deepseek/deepseek-chat", order: 1, context: "Used for cheap JSON generation." },
        { name: "grok", displayName: "Grok (xAI)", openRouterId: "x-ai/grok-2-1212", order: 2, context: "Experimental, not yet in production." },
        { name: "claude", displayName: "Claude Opus 4.6", openRouterId: "anthropic/claude-3-opus-20240229", order: 3, context: "Final reviewer and consolidator." }
      ]
    }, null, 2));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Sort by order
  config.models.sort((a, b) => (a.order || 0) - (b.order || 0));
  return config;
}

// ------------------------------------------------------------------
// PROMPT TEMPLATES
// ------------------------------------------------------------------
function buildAdvicePrompt(modelName, displayName, contextNotes) {
  return `You are ${displayName}. Write a practical advice document for a developer using you to automate book vs film comparison pages.

Follow this exact markdown structure:

# ${displayName} – Practical Advice

## 1. Business Advice (Revenue, SEO, Growth)

Write specific, actionable advice about:
- SEO leverage (meta descriptions, internal links, schema)
- Backlink opportunities
- Audience growth (social snippets, quizzes, roundups)
- Monetization (affiliate copy, CTAs)
- Competitive edge (how this model helps)

Be concrete, use examples relevant to book vs film comparisons.

## 2. Technical Advice (Prompts, Workflow, Output)

Cover:
- Prompting best practices (system message, temperature, format)
- Known refusals & workarounds (affiliate links, HTML structure, conditional prompts)
- Token efficiency & cost per page (estimate)
- Integration patterns (API, stripping, merging)
- Known issues to watch

## 3. Model Specs (Quick Reference)

Create a markdown table with:
| Property | Value |
|----------|-------|
| Recommended Model | ${displayName} |
| OpenRouter ID | ${this.openRouterId} |
| Context Window | (estimate) |
| Best For | (e.g., structured writing) |
| Cost per Page (est.) | (range) |
| Speed | (fast/medium) |

## Final One‑Sentence Advice

Sum up when and why to use this model.

Additional context: ${contextNotes}

Output raw markdown. Do NOT wrap in backticks or code fences. Start immediately with "# ${displayName} – Practical Advice".`;
}

function buildConsolidationPrompt(deepseekAdvice, grokAdvice) {
  return `You are Claude Opus 4.6, a final reviewer and consolidator.

Below are two advice documents written by DeepSeek and Grok about themselves, for the same project (automating book vs film comparisons).

Your task: Read both, then produce a **consolidated advice document** that:
- Highlights the best business and technical recommendations from both.
- Points out contradictions or trade‑offs (e.g., cost vs quality).
- Adds your own Claude‑specific advice where missing (especially around system messages, refusal handling, and structured output).
- Ends with a clear decision matrix: when to use DeepSeek, when to use Grok, when to use Claude.

Output the final document as markdown with the title:
# Consolidated LLM Advice for BooksVsMovies

Use headings: ## Business Recommendations (cross‑model), ## Technical Recommendations, ## Decision Matrix, ## Final Verdict.

Be specific, actionable, and concise.

Here is DeepSeek's advice:
---
${deepseekAdvice}
---

Here is Grok's advice:
---
${grokAdvice}
---

Output raw markdown. No code fences. Start immediately with "# Consolidated LLM Advice".`;
}

// ------------------------------------------------------------------
// CALL OPENROUTER
// ------------------------------------------------------------------
async function callModel(apiKey, modelId, systemMsg, userPrompt, maxTokens = 4000, temperature = 0.3) {
  log(`Calling ${modelId}...`);
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: modelId,
      max_tokens: maxTokens,
      temperature: temperature,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userPrompt }
      ]
    },
    {
      timeout: 120000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://booksversusmovies.com',
        'X-Title': 'BooksVsMovies Advice Orchestrator'
      }
    }
  );
  const content = response.data.choices[0].message.content;
  log(`Received response from ${modelId} (${content.length} chars)`);
  return content;
}

// ------------------------------------------------------------------
// SAVE ADVICE
// ------------------------------------------------------------------
function saveAdvice(modelName, content) {
  const modelDir = path.join(ADVICE_BASE, modelName);
  ensureDir(modelDir);
  const filePath = path.join(modelDir, 'advice.md');
  // Strip accidental fences
  let cleaned = content.replace(/^```markdown\n?/i, '').replace(/\n?```$/i, '');
  fs.writeFileSync(filePath, cleaned, 'utf8');
  log(`💾 Saved advice to ${filePath}`);
}

function saveConsolidated(content) {
  ensureDir(PROJECT_DIR);
  const filePath = path.join(PROJECT_DIR, 'consolidated-advice.md');
  let cleaned = content.replace(/^```markdown\n?/i, '').replace(/\n?```$/i, '');
  fs.writeFileSync(filePath, cleaned, 'utf8');
  log(`💾 Saved consolidated advice to ${filePath}`);
}

// ------------------------------------------------------------------
// MAIN ORCHESTRATION
// ------------------------------------------------------------------
async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ Missing OPENROUTER_API_KEY in .env');
    process.exit(1);
  }

  const config = loadAdviceConfig();
  const models = config.models;
  if (models.length < 3) {
    console.error('❌ Need at least 3 models in advice-config.json (deepseek, grok, claude)');
    process.exit(1);
  }

  // Identify which is which by name (case‑insensitive)
  const deepseekModel = models.find(m => m.name.toLowerCase() === 'deepseek');
  const grokModel = models.find(m => m.name.toLowerCase() === 'grok');
  const claudeModel = models.find(m => m.name.toLowerCase() === 'claude');

  if (!deepseekModel || !grokModel || !claudeModel) {
    console.error('❌ Must have models named "deepseek", "grok", and "claude" in advice-config.json');
    process.exit(1);
  }

  // Step 1: Generate DeepSeek advice
  log('--- Step 1: Generating DeepSeek advice ---');
  const deepseekPrompt = buildAdvicePrompt(deepseekModel.name, deepseekModel.displayName, deepseekModel.context);
  const deepseekAdvice = await callModel(apiKey, deepseekModel.openRouterId, 'You are a helpful assistant that outputs only raw markdown.', deepseekPrompt, 4000, 0.3);
  saveAdvice(deepseekModel.name, deepseekAdvice);

  // Step 2: Generate Grok advice
  log('--- Step 2: Generating Grok advice ---');
  const grokPrompt = buildAdvicePrompt(grokModel.name, grokModel.displayName, grokModel.context);
  const grokAdvice = await callModel(apiKey, grokModel.openRouterId, 'You are a helpful assistant that outputs only raw markdown.', grokPrompt, 4000, 0.3);
  saveAdvice(grokModel.name, grokAdvice);

  // Step 3: Read both generated files (to be safe, use the saved content, but we already have variables)
  // Use the variables directly (they are the raw responses)
  log('--- Step 3: Calling Claude for consolidation ---');
  const consolidationPrompt = buildConsolidationPrompt(deepseekAdvice, grokAdvice);
  const consolidated = await callModel(apiKey, claudeModel.openRouterId, 'You are a final reviewer. Output only raw markdown, no code fences.', consolidationPrompt, 8000, 0.2);
  saveConsolidated(consolidated);

  log('✅ Orchestration complete. Files updated:');
  log(`   - docs/advice/deepseek/advice.md`);
  log(`   - docs/advice/grok/advice.md`);
  log(`   - docs/project/consolidated-advice.md`);
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});