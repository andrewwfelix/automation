#!/usr/bin/env node
/**
 * BooksVersusMovies.com — Batch HTML Revision (no CSV)
 * 
 * Reads all .html files from ./input/, sends each to OpenRouter with revision prompt,
 * writes revised HTML to ./output/, and on failure moves original to ./output/failures/.
 *
 * NEW in this version:
 * - System message to enforce raw HTML output (stops model from asking questions)
 * - Support for minimal prompts (avoids model refusal)
 * - Better token accounting and logging
 * - Option to strip affiliate links temporarily (if model refuses)
 * - Configurable model and timeout
 *
 * Usage:
 *   node revise-batch.js                          # process all files in input/
 *   node revise-batch.js --file about-a-boy.html  # process only one file
 *   node revise-batch.js --dry-run                # simulate, no API calls
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ------------------------------------------------------------------ //
// LOGGER
// ------------------------------------------------------------------ //
const scriptDir = path.dirname(path.resolve(process.argv[1]));
const LOG_FILE = path.join(scriptDir, 'revise-batch.log');

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function logError(message) {
  const line = `[${timestamp()}] ❌ ${message}`;
  console.error(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function logSection(title) {
  const bar = '─'.repeat(60);
  log(`\n${bar}\n${title}\n${bar}`);
}

// ------------------------------------------------------------------ //
// LOAD CONFIG
// ------------------------------------------------------------------ //
function loadConfig(cfgPath) {
  if (!fs.existsSync(cfgPath)) {
    logError(`Config file not found: ${cfgPath}`);
    process.exit(1);
  }
  const cfg = {};
  const lines = fs.readFileSync(cfgPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    cfg[key] = value;
  }
  const required = ['OPENROUTER_API_KEY', 'REVISE_PROMPT_PATH', 'MODEL'];
  for (const key of required) {
    if (!cfg[key]) {
      logError(`Missing required config key: ${key}`);
      process.exit(1);
    }
  }
  return cfg;
}

// ------------------------------------------------------------------ //
// OPTIONAL: Strip affiliate links to avoid model refusal
// Some models (Claude) refuse to process HTML containing Amazon links.
// This function temporarily replaces them with placeholders.
// After revision, you can restore them with a separate script.
// ------------------------------------------------------------------ //
function stripAffiliateLinks(html) {
  // Replace amazon affiliate links with placeholder
  let stripped = html.replace(/https?:\/\/amzn\.to\/[^\s"']+/g, 'AMAZON_AFFILIATE_PLACEHOLDER');
  stripped = stripped.replace(/https?:\/\/www\.amazon\.com\/[^\s"']+/g, 'AMAZON_AFFILIATE_PLACEHOLDER');
  return stripped;
}

function restoreAffiliateLinks(originalHtml, revisedHtml) {
  // Extract all original affiliate links
  const linkRegex = /https?:\/\/amzn\.to\/[^\s"']+|https?:\/\/www\.amazon\.com\/[^\s"']+/g;
  const originalLinks = originalHtml.match(linkRegex) || [];
  // Replace placeholders in revised HTML (naive approach – assumes order preserved)
  let restored = revisedHtml;
  let idx = 0;
  restored = restored.replace(/AMAZON_AFFILIATE_PLACEHOLDER/g, () => originalLinks[idx++] || '');
  return restored;
}

// ------------------------------------------------------------------ //
// CALL OPENROUTER FOR REVISION
// ------------------------------------------------------------------ //
async function reviseHTML(cfg, currentHtml, revisionPrompt, fileName, stripLinks = false) {
  const timeoutMs = parseInt(cfg.TIMEOUT_SECONDS || '120', 10) * 1000;
  const maxTokens = parseInt(cfg.MAX_TOKENS || '22000', 10);

  // Optionally strip affiliate links to avoid model refusal
  let htmlToSend = currentHtml;
  if (stripLinks === true) {
    htmlToSend = stripAffiliateLinks(currentHtml);
    log(`   Stripped affiliate links before sending (to avoid model refusal)`);
  }

  const userPrompt = `${revisionPrompt}\n\nHere is the HTML file to revise (${fileName}):\n\n${htmlToSend}`;

  // Log prompt size so we can spot context limit issues
  const promptChars = userPrompt.length;
  const promptTokens = Math.round(promptChars / 4);
  log(`   Prompt size: ${promptChars} chars (~${promptTokens} tokens)`);
  log(`   Sending request — model: ${cfg.MODEL}, max_tokens: ${maxTokens}, timeout: ${timeoutMs / 1000}s`);

  const startTime = Date.now();

  let response;
  try {
    response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: cfg.MODEL,
        max_tokens: maxTokens,
        // CRITICAL: System message forces raw HTML output and prevents the model from asking questions
        messages: [
          {
            role: 'system',
            content: 'You are an HTML code generator. You must output ONLY valid HTML code. Never include explanations, markdown, or any text outside the HTML. The output must start with <!DOCTYPE html> and end with </html>. If you cannot follow this, output nothing.'
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.1  // Low temperature for consistent, deterministic output
      },
      {
        timeout: timeoutMs,
        headers: {
          'Authorization': `Bearer ${cfg.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': cfg.SITE_URL || 'https://booksversusmovies.com',
          'X-Title': 'BooksVersusMovies Batch Revision',
        },
      }
    );
  } catch (err) {
    // Log the full error body so we can diagnose 400s
    if (err.response) {
      const status = err.response.status;
      const body = JSON.stringify(err.response.data || {});
      throw new Error(`API HTTP ${status}: ${body}`);
    } else if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    } else {
      throw new Error(`Network error: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const usage = response.data.usage || {};
  const stopReason = response.data.choices?.[0]?.finish_reason || 'unknown';
  const content = response.data.choices?.[0]?.message?.content;

  log(`   HTTP ${response.status} — received in ${elapsed}s`);
  log(`   Tokens — prompt: ${usage.prompt_tokens || '?'}, completion: ${usage.completion_tokens || '?'}, total: ${usage.total_tokens || '?'}`);
  log(`   Finish reason: ${stopReason}`);

  if (!content) {
    throw new Error(`Empty response. Full body: ${JSON.stringify(response.data)}`);
  }

  if (stopReason === 'length') {
    log(`   ⚠️  WARNING: response was cut off at max_tokens (${maxTokens}). Increase MAX_TOKENS in movies.cfg.`);
  }

  log(`   Response content: ${content.length} chars`);

  // Strip markdown fences if model wrapped output
  let revisedHtml = content.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();

  // Try to extract HTML if there's preamble before <!DOCTYPE
  if (!revisedHtml.startsWith('<!DOCTYPE html>')) {
    const match = revisedHtml.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
    if (match) {
      revisedHtml = match[0];
      log(`   ℹ️  Stripped preamble before <!DOCTYPE html>`);
    } else {
      // Save raw response for inspection
      const debugPath = path.join(scriptDir, 'debug.txt');
      fs.writeFileSync(debugPath, content, 'utf8');
      log(`   Raw response saved to: ${debugPath}`);
      throw new Error('Response does not contain valid HTML');
    }
  }

  // If we stripped affiliate links, restore them now (approximate)
  if (stripLinks === true) {
    revisedHtml = restoreAffiliateLinks(currentHtml, revisedHtml);
    log(`   Restored affiliate links after revision (approximate)`);
  }

  return revisedHtml;
}

// ------------------------------------------------------------------ //
// PROCESS ONE FILE
// ------------------------------------------------------------------ //
async function processFile(cfg, revisionPrompt, inputDir, outputDir, failuresDir, fileName, dryRun) {
  const inputPath = path.join(inputDir, fileName);
  const outputPath = path.join(outputDir, fileName);
  const failurePath = path.join(failuresDir, fileName);

  log(`Processing: ${fileName}`);

  if (dryRun) {
    log(`   DRY RUN: would revise ${fileName} -> ${outputPath}`);
    return { success: true };
  }

  const originalHtml = fs.readFileSync(inputPath, 'utf8');
  
  // Decide whether to strip affiliate links based on model
  // Claude models often refuse; Gemini and GPT are fine
  const model = cfg.MODEL.toLowerCase();
  const stripLinks = model.includes('claude') ? true : false;

  try {
    const revisedHtml = await reviseHTML(cfg, originalHtml, revisionPrompt, fileName, stripLinks);
    fs.writeFileSync(outputPath, revisedHtml, 'utf8');
    const sizeKb = (revisedHtml.length / 1024).toFixed(1);
    log(`   ✓ Saved: ${outputPath} (${sizeKb} KB)`);
    return { success: true };
  } catch (err) {
    logError(`✗ Revision failed for ${fileName}: ${err.message}`);
    fs.copyFileSync(inputPath, failurePath);
    log(`   Original copied to: ${failurePath}`);
    return { success: false };
  }
}

// ------------------------------------------------------------------ //
// MAIN
// ------------------------------------------------------------------ //
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArgIdx = args.indexOf('--file');
  const specificFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  if (fileArgIdx !== -1 && !specificFile) {
    logError('--file requires a filename (e.g., --file about-a-boy.html)');
    process.exit(1);
  }

  logSection(dryRun ? 'DRY RUN: BATCH REVISION' : 'BATCH REVISION (no CSV)');

  const cfg = loadConfig(path.join(scriptDir, 'movies.cfg'));
  log(`Config: ${path.join(scriptDir, 'movies.cfg')}`);
  log(`Model:  ${cfg.MODEL}`);
  log(`Tokens: ${cfg.MAX_TOKENS || 22000} max`);

  const inputDir = path.join(scriptDir, 'input');
  const outputDir = path.join(scriptDir, 'output');
  const failuresDir = path.join(outputDir, 'failures');

  if (!fs.existsSync(inputDir)) {
    logError(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(failuresDir)) fs.mkdirSync(failuresDir, { recursive: true });

  log(`Input:    ${inputDir}`);
  log(`Output:   ${outputDir}`);
  log(`Failures: ${failuresDir}`);

  const promptPath = path.isAbsolute(cfg.REVISE_PROMPT_PATH)
    ? cfg.REVISE_PROMPT_PATH
    : path.join(scriptDir, cfg.REVISE_PROMPT_PATH);
  if (!fs.existsSync(promptPath)) {
    logError(`Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  const revisionPrompt = fs.readFileSync(promptPath, 'utf8');
  log(`Prompt:   ${promptPath} (${revisionPrompt.length} chars)`);

  // Determine files to process
  let files = [];
  if (specificFile) {
    const fullPath = path.join(inputDir, specificFile);
    if (!fs.existsSync(fullPath)) {
      logError(`File not found: ${fullPath}`);
      process.exit(1);
    }
    files = [specificFile];
    log(`Mode: single file — ${specificFile}`);
  } else {
    files = fs.readdirSync(inputDir).filter(f => f.endsWith('.html'));
    if (files.length === 0) {
      log('No .html files found in input/');
      return;
    }
    log(`Mode: batch — ${files.length} files`);
  }

  let successCount = 0;
  let failureCount = 0;

  for (const file of files) {
    const result = await processFile(
      cfg, revisionPrompt, inputDir, outputDir, failuresDir, file, dryRun
    );
    if (result.success) successCount++;
    else failureCount++;
  }

  logSection(`DONE — Success: ${successCount}  Failures: ${failureCount}`);
  log(`Log: ${LOG_FILE}`);
  if (failureCount > 0) log(`Failed files preserved in: ${failuresDir}`);
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});