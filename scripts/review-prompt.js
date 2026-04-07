#!/usr/bin/env node
/**
 * review-prompt.js
 * 
 * Takes a prompt file from the prompts/ folder, reviews it using
 * DeepSeek, Grok, and Claude (orchestrated), and outputs a revised version
 * with metadata (revision date, model used, changes).
 * 
 * Usage:
 *   node scripts/review-prompt.js <prompt-filename>
 * 
 * Example:
 *   node scripts/review-prompt.js revise-prompt-gold-standard.txt
 * 
 * Configuration:
 *   - config/advice-config.json (models: deepseek, grok, claude)
 *   - .env with OPENROUTER_API_KEY
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ------------------------------------------------------------------
// PATHS – use project root
// ------------------------------------------------------------------
const PROJECT_ROOT = path.join(__dirname, '..');
const PROMPTS_DIR = path.join(PROJECT_ROOT, 'prompts');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'advice-config.json');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
const LOG_FILE = path.join(LOG_DIR, 'review-prompt.log');

// ------------------------------------------------------------------
// LOGGING
// ------------------------------------------------------------------
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

// ------------------------------------------------------------------
// LOAD CONFIG
// ------------------------------------------------------------------
function loadAdviceConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    logToFile(`❌ Advice config not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.models.sort((a, b) => (a.order || 0) - (b.order || 0));
  return config;
}

// ------------------------------------------------------------------
// CALL OPENROUTER
// ------------------------------------------------------------------
async function callModel(apiKey, modelId, systemMsg, userPrompt, maxTokens = 4000, temperature = 0.3) {
  logToFile(`📡 Calling ${modelId}...`);
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
        'X-Title': 'BooksVsMovies Prompt Reviewer'
      }
    }
  );
  const content = response.data.choices[0].message.content;
  logToFile(`✅ Received response from ${modelId} (${content.length} chars)`);
  return content;
}

// ------------------------------------------------------------------
// PROMPT BUILDERS
// ------------------------------------------------------------------
function buildDeepSeekPrompt(originalPromptContent) {
  return `You are DeepSeek, a prompt engineering expert. Your task is to review and analyze the following prompt that is used to generate book vs film comparison pages.

Analyze the prompt for:
- Clarity and specificity
- Missing instructions (e.g., spoiler warning, cast table, FAQ, last‑updated date)
- Ambiguity that could cause model confusion or refusal
- Opportunities to add SEO or structural improvements
- Voice and tone consistency

Output a structured analysis with:
## Strengths
## Weaknesses / Gaps
## Specific Recommendations for Improvement

Be concrete. Provide line‑by‑line suggestions where appropriate.

Original prompt:
---
${originalPromptContent}
---

Output raw markdown. No code fences. Start directly with "## Strengths".`;
}

function buildGrokPrompt(originalPromptContent, deepseekAnalysis) {
  return `You are Grok, a prompt engineer. You have received a detailed analysis from DeepSeek. Now, produce an **intermediate revised version** of the prompt.

Incorporate DeepSeek's recommendations. Preserve the original structure and intent, but add missing sections (spoiler warning, cast table, FAQ, last‑updated date, SEO instructions) and improve clarity.

Output ONLY the revised prompt as raw text (no markdown, no code fences). Do not include any commentary outside the prompt itself.

DeepSeek's analysis:
${deepseekAnalysis}

Original prompt:
${originalPromptContent}

Output the revised prompt only.`;
}

function buildClaudePrompt(originalPromptContent, deepseekAnalysis, grokRevisedPrompt) {
  const revisionDate = new Date().toISOString().slice(0, 10);
  return `You are Claude, a final prompt engineering expert. Your task is to produce the **final revised prompt** that will be saved as a new file.

You have:
1. The original prompt
2. DeepSeek's analysis
3. Grok's intermediate revision

Now, create the final prompt. It must:
- Preserve the original purpose and critical instructions (e.g., output only HTML, start with <!DOCTYPE html>)
- Incorporate the best suggestions from DeepSeek and Grok
- Include a comment block at the top with:
  * Revision date: ${revisionDate}
  * Model used for final revision: Claude Sonnet 4.5
  * Summary of changes (list 3‑5 bullet points)
- Ensure the prompt is self‑contained, clear, and actionable.

Output ONLY the final prompt as raw text (no markdown fences). The output should start with the comment block, then the prompt content.

Original prompt:
${originalPromptContent}

DeepSeek analysis:
${deepseekAnalysis}

Grok's intermediate revision:
${grokRevisedPrompt}`;
}

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: node scripts/review-prompt.js <prompt-filename>');
    process.exit(1);
  }
  const promptFileName = args[0];
  const inputPath = path.join(PROMPTS_DIR, promptFileName);
  if (!fs.existsSync(inputPath)) {
    logToFile(`❌ Prompt file not found: ${inputPath}`);
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logToFile('❌ Missing OPENROUTER_API_KEY in .env');
    process.exit(1);
  }

  const config = loadAdviceConfig();
  const deepseekModel = config.models.find(m => m.name.toLowerCase() === 'deepseek');
  const grokModel = config.models.find(m => m.name.toLowerCase() === 'grok');
  const claudeModel = config.models.find(m => m.name.toLowerCase() === 'claude');

  if (!deepseekModel || !grokModel || !claudeModel) {
    logToFile('❌ Config must include deepseek, grok, and claude models');
    process.exit(1);
  }

  const originalPrompt = fs.readFileSync(inputPath, 'utf8');
  logToFile(`📄 Loaded prompt: ${promptFileName} (${originalPrompt.length} chars)`);

  // Step 1: DeepSeek analysis
  logToFile('--- Step 1: DeepSeek analysis ---');
  const deepseekAnalysis = await callModel(
    apiKey,
    deepseekModel.openRouterId,
    'You are a prompt analysis expert. Output only raw markdown.',
    buildDeepSeekPrompt(originalPrompt),
    4000,
    0.3
  );

  // Step 2: Grok intermediate revision
  logToFile('--- Step 2: Grok intermediate revision ---');
  const grokRevised = await callModel(
    apiKey,
    grokModel.openRouterId,
    'You are a prompt engineer. Output only the revised prompt as raw text.',
    buildGrokPrompt(originalPrompt, deepseekAnalysis),
    8000,
    0.3
  );

  // Step 3: Claude final revision with metadata
  logToFile('--- Step 3: Claude final revision ---');
  const finalPrompt = await callModel(
    apiKey,
    claudeModel.openRouterId,
    'You are a final prompt editor. Output only the final prompt as raw text.',
    buildClaudePrompt(originalPrompt, deepseekAnalysis, grokRevised),
    10000,
    0.2
  );

  // Save output file
  const parsed = path.parse(promptFileName);
  const outputFileName = `${parsed.name}_revised${parsed.ext}`;
  const outputPath = path.join(PROMPTS_DIR, outputFileName);
  fs.writeFileSync(outputPath, finalPrompt, 'utf8');
  logToFile(`💾 Saved revised prompt to ${outputPath}`);

  logToFile('✅ Review complete.');
}

main().catch(err => {
  logToFile(`❌ Unhandled error: ${err.message}`);
  process.exit(1);
});