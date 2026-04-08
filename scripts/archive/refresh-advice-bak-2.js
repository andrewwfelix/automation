#!/usr/bin/env node
/**
 * refresh-advice.js
 * 
 * Orchestrates advice generation with iterative improvement:
 * - For each model (DeepSeek, Grok, Claude), archive current advice.md
 * - Include the old advice in the prompt (so the model can build upon it)
 * - Save new advice to advice.md
 * - For Claude, also generate a separate next-steps.md file
 * 
 * Usage: node scripts/refresh-advice.js
 * 
 * Configuration:
 *   - config/advice-config.json (model list, order, contexts)
 *   - .env with OPENROUTER_API_KEY
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ------------------------------------------------------------------
// PATHS – use project root (one level above the script)
// ------------------------------------------------------------------
const PROJECT_ROOT = path.join(__dirname, '..');
const ADVICE_BASE = path.join(PROJECT_ROOT, 'docs', 'advice');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'docs', 'project');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'advice-config.json');

// Load .env from project root
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const LOG_FILE = path.join(LOG_DIR, 'refresh-advice.log');

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
// UTILITIES
// ------------------------------------------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Archive existing file: copy to <basename>-YYYY-MM-DD.<ext>
function archiveFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const parsed = path.parse(filePath);
  const timestamp = getTimestamp();
  const archivePath = path.join(parsed.dir, `${parsed.name}-${timestamp}${parsed.ext}`);
  fs.copyFileSync(filePath, archivePath);
  logToFile(`📦 Archived ${filePath} -> ${archivePath}`);
  return archivePath;
}

// Read file content if exists, else return null
function readFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

// ------------------------------------------------------------------
// LOAD ADVICE CONFIG
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
// PROMPT TEMPLATES (with old advice included)
// ------------------------------------------------------------------
function buildAdvicePrompt(modelName, displayName, contextNotes, oldAdvice) {
  let oldAdviceSection = '';
  if (oldAdvice) {
    oldAdviceSection = `\n## Previous version of this advice (for reference)\n\nHere is the previous advice document for ${displayName}. Use it as a starting point, improve it, correct any outdated information, and add new insights. Do NOT simply repeat it; iterate and enhance.\n\n\`\`\`\n${oldAdvice}\n\`\`\`\n`;
  } else {
    oldAdviceSection = `\n(This is the first time we are generating advice for ${displayName}. Create a comprehensive document from scratch.)\n`;
  }

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
| OpenRouter ID | (to be filled) |
| Context Window | (estimate) |
| Best For | (e.g., structured writing) |
| Cost per Page (est.) | (range) |
| Speed | (fast/medium) |

## Final One‑Sentence Advice

Sum up when and why to use this model.

Additional context: ${contextNotes}
${oldAdviceSection}

Output raw markdown. Do NOT wrap in backticks or code fences. Start immediately with "# ${displayName} – Practical Advice".`;
}

function buildConsolidationPrompt(deepseekAdvice, grokAdvice, oldConsolidated) {
  let oldConsolidatedSection = '';
  if (oldConsolidated) {
    oldConsolidatedSection = `\n## Previous consolidated advice (for reference)\n\nHere is the previous consolidated advice. Use it as a baseline, improve it, and incorporate the new individual advice from DeepSeek and Grok.\n\n\`\`\`\n${oldConsolidated}\n\`\`\`\n`;
  } else {
    oldConsolidatedSection = `\n(This is the first time we are generating consolidated advice. Create a fresh synthesis.)\n`;
  }

  return `You are Claude Sonnet 4.5, a final reviewer and consolidator.

Below are two advice documents written by DeepSeek and Grok about themselves, for the same project (automating book vs film comparisons).

Your task: Read both, then produce a **consolidated advice document** that:
- Highlights the best business and technical recommendations from both.
- Points out contradictions or trade‑offs (e.g., cost vs quality).
- Adds your own Claude‑specific advice where missing (especially around system messages, refusal handling, and structured output).
- Ends with a clear decision matrix: when to use DeepSeek, when to use Grok, when to use Claude.

**After the consolidated advice, you MUST include a separate section titled '## Next Steps (Actionable)'** with three subsections:
- **Immediate (this week)** – 3-5 concrete, high‑priority actions.
- **Short‑term (next month)** – 3-5 actions.
- **Long‑term / experiments** – 2-3 actions.

Use bullet points. Be specific, actionable, and directly derived from the advice above.

Output the full response as raw markdown. No code fences. Start with "# Consolidated LLM Advice for BooksVsMovies".

Here is DeepSeek's advice:
---
${deepseekAdvice}
---

Here is Grok's advice:
---
${grokAdvice}
---
${oldConsolidatedSection}`;
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
        'X-Title': 'BooksVsMovies Advice Orchestrator'
      }
    }
  );
  const content = response.data.choices[0].message.content;
  logToFile(`✅ Received response from ${modelId} (${content.length} chars)`);
  return content;
}

// ------------------------------------------------------------------
// GENERATE ADVICE FOR A SINGLE MODEL (with archiving and old advice inclusion)
// ------------------------------------------------------------------
async function generateModelAdvice(apiKey, modelConfig, modelFolderPath) {
  const adviceFile = path.join(modelFolderPath, 'advice.md');
  
  // 1. Archive existing advice if present
  archiveFile(adviceFile);
  
  // 2. Read old advice (if any) to include in prompt
  const oldAdvice = readFileIfExists(adviceFile);
  if (oldAdvice) {
    logToFile(`📖 Found previous advice for ${modelConfig.displayName}, will include as context.`);
  } else {
    logToFile(`🆕 No previous advice for ${modelConfig.displayName}, generating from scratch.`);
  }
  
  // 3. Build prompt with old advice
  const prompt = buildAdvicePrompt(
    modelConfig.name,
    modelConfig.displayName,
    modelConfig.context || '',
    oldAdvice
  );
  
  // 4. Call model
  const systemMsg = 'You are a helpful assistant that outputs only raw markdown. No code fences, no explanations outside the markdown.';
  const adviceContent = await callModel(apiKey, modelConfig.openRouterId, systemMsg, prompt, 5000, 0.3);
  
  // 5. Write new advice (overwrite)
  ensureDir(modelFolderPath);
  fs.writeFileSync(adviceFile, adviceContent, 'utf8');
  logToFile(`💾 Saved new advice to ${adviceFile}`);
}

// ------------------------------------------------------------------
// GENERATE CONSOLIDATED ADVICE (Claude) and extract Next Steps
// ------------------------------------------------------------------
async function generateConsolidatedAdvice(apiKey, claudeModelConfig, deepseekFile, grokFile, consolidatedFile, nextStepsFile) {
  // 1. Archive existing consolidated advice
  archiveFile(consolidatedFile);
  archiveFile(nextStepsFile); // also archive old next steps if exists
  
  // 2. Read old consolidated (if any)
  const oldConsolidated = readFileIfExists(consolidatedFile);
  
  // 3. Read the newly generated DeepSeek and Grok advice
  const deepseekAdvice = fs.readFileSync(deepseekFile, 'utf8');
  const grokAdvice = fs.readFileSync(grokFile, 'utf8');
  
  // 4. Build prompt with old consolidated (if any)
  const prompt = buildConsolidationPrompt(deepseekAdvice, grokAdvice, oldConsolidated);
  
  // 5. Call Claude
  const systemMsg = 'You are a final reviewer. Output only raw markdown, no code fences.';
  const response = await callModel(apiKey, claudeModelConfig.openRouterId, systemMsg, prompt, 10000, 0.2);
  
  // 6. Split response into consolidated advice and next steps
  let consolidatedContent = response;
  let nextStepsContent = '';
  
  const nextStepsMatch = response.match(/## Next Steps \(Actionable\)[\s\S]*$/i);
  if (nextStepsMatch) {
    nextStepsContent = nextStepsMatch[0];
    // Remove the next steps section from consolidated advice
    consolidatedContent = response.replace(/## Next Steps \(Actionable\)[\s\S]*$/i, '').trim();
    logToFile(`📌 Extracted Next Steps section (${nextStepsContent.length} chars)`);
  } else {
    logToFile('⚠️ Claude did not include a "## Next Steps (Actionable)" section. Next steps file will not be created.');
  }
  
  // 7. Save consolidated advice
  ensureDir(path.dirname(consolidatedFile));
  fs.writeFileSync(consolidatedFile, consolidatedContent, 'utf8');
  logToFile(`💾 Saved new consolidated advice to ${consolidatedFile}`);
  
  // 8. Save next steps file (if content exists)
  if (nextStepsContent) {
    ensureDir(path.dirname(nextStepsFile));
    fs.writeFileSync(nextStepsFile, nextStepsContent, 'utf8');
    logToFile(`📋 Saved next steps to ${nextStepsFile}`);
  } else {
    logToFile(`⚠️ No next steps content – ${nextStepsFile} not updated.`);
  }
}

// ------------------------------------------------------------------
// MAIN ORCHESTRATION
// ------------------------------------------------------------------
async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logToFile('❌ Missing OPENROUTER_API_KEY in .env');
    process.exit(1);
  }

  const config = loadAdviceConfig();
  const models = config.models;
  
  // Identify models by name
  const deepseekModel = models.find(m => m.name.toLowerCase() === 'deepseek');
  const grokModel = models.find(m => m.name.toLowerCase() === 'grok');
  const claudeModel = models.find(m => m.name.toLowerCase() === 'claude');
  
  if (!deepseekModel || !grokModel || !claudeModel) {
    logToFile('❌ Must have models named "deepseek", "grok", and "claude" in advice-config.json');
    process.exit(1);
  }
  
  // Paths
  const deepseekPath = path.join(ADVICE_BASE, 'deepseek');
  const grokPath = path.join(ADVICE_BASE, 'grok');
  const consolidatedFile = path.join(PROJECT_DIR, 'consolidated-advice.md');
  const nextStepsFile = path.join(PROJECT_DIR, 'next-steps.md');
  
  // Step 1: Generate DeepSeek advice (includes archiving and old advice)
  logToFile('--- Step 1: Generating DeepSeek advice ---');
  await generateModelAdvice(apiKey, deepseekModel, deepseekPath);
  
  // Step 2: Generate Grok advice
  logToFile('--- Step 2: Generating Grok advice ---');
  await generateModelAdvice(apiKey, grokModel, grokPath);
  
  // Step 3: Generate consolidated advice using Claude (includes archiving and next steps extraction)
  logToFile('--- Step 3: Generating consolidated advice (Claude) ---');
  const deepseekAdviceFile = path.join(deepseekPath, 'advice.md');
  const grokAdviceFile = path.join(grokPath, 'advice.md');
  await generateConsolidatedAdvice(apiKey, claudeModel, deepseekAdviceFile, grokAdviceFile, consolidatedFile, nextStepsFile);
  
  logToFile('✅ Orchestration complete. Files updated:');
  logToFile(`   - ${deepseekAdviceFile}`);
  logToFile(`   - ${grokAdviceFile}`);
  logToFile(`   - ${consolidatedFile}`);
  logToFile(`   - ${nextStepsFile}`);
  logToFile(`   - Archived previous versions with date suffix in same folders.`);
}

main().catch(err => {
  logToFile(`❌ Unhandled error: ${err.message}`);
  process.exit(1);
});