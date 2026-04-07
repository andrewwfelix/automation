#!/usr/bin/env node
/**
 * BooksVersusMovies.com — Batch HTML Revision (no CSV)
 * 
 * Reads all .html files from ./input/, sends each to OpenRouter with revision prompt,
 * writes revised HTML to ./output/, and on failure moves original to ./output/failures/.
 *
 * Usage:
 *   node revise-batch.js          # process all files in input/
 *   node revise-batch.js --dry-run   # simulate, no API calls
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
    cfg[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
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
// CALL OPENROUTER FOR REVISION
// ------------------------------------------------------------------ //
async function reviseHTML(cfg, currentHtml, revisionPrompt, fileName) {
  const timeoutMs = parseInt(cfg.TIMEOUT_SECONDS || '120', 10) * 1000;
  const maxTokens = parseInt(cfg.MAX_TOKENS || '8000', 10);

  const userPrompt = `${revisionPrompt}\n\nHere is the HTML file to revise (${fileName}):\n\n${currentHtml}`;

  log(`   Sending request — model: ${cfg.MODEL}, max_tokens: ${maxTokens}`);
  const startTime = Date.now();

  let response;
  try {
    response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: cfg.MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userPrompt }],
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
    throw new Error(`API call failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const content = response.data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from API');

  log(`   Received revised HTML (${content.length} chars) in ${elapsed}s`);
  
  // Extract HTML from markdown code blocks if present
  let revisedHtml = content.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
  if (!revisedHtml.startsWith('<!DOCTYPE html>')) {
    const match = revisedHtml.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
    if (match) revisedHtml = match[0];
    else throw new Error('Response does not contain valid HTML');
  }
  return revisedHtml;
}

// ------------------------------------------------------------------ //
// MAIN
// ------------------------------------------------------------------ //
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  logSection(dryRun ? 'DRY RUN: BATCH REVISION' : 'BATCH REVISION (no CSV)');

  // Load config
  const cfg = loadConfig(path.join(scriptDir, 'movies.cfg'));
  log(`Config loaded from ${path.join(scriptDir, 'movies.cfg')}`);

  // Resolve directories
  const inputDir = path.join(scriptDir, 'input');
  const outputDir = path.join(scriptDir, 'output');
  const failuresDir = path.join(outputDir, 'failures');

  if (!fs.existsSync(inputDir)) {
    logError(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(failuresDir)) fs.mkdirSync(failuresDir, { recursive: true });

  log(`Input dir:  ${inputDir}`);
  log(`Output dir: ${outputDir}`);
  log(`Failures:   ${failuresDir}`);

  // Load revision prompt
  const promptPath = path.isAbsolute(cfg.REVISE_PROMPT_PATH)
    ? cfg.REVISE_PROMPT_PATH
    : path.join(scriptDir, cfg.REVISE_PROMPT_PATH);
  if (!fs.existsSync(promptPath)) {
    logError(`Revision prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  const revisionPrompt = fs.readFileSync(promptPath, 'utf8');
  log(`Revision prompt: ${promptPath}`);

  // Get all .html files from input (non-recursive)
  let files = fs.readdirSync(inputDir).filter(f => f.endsWith('.html'));
  if (files.length === 0) {
    log('No .html files found in input directory.');
    return;
  }
  log(`Found ${files.length} files to process.\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file);
    const failurePath = path.join(failuresDir, file);

    log(`Processing: ${file}`);

    if (dryRun) {
      log(`   DRY RUN: would revise ${file} -> ${outputPath}`);
      successCount++;
      continue;
    }

    const originalHtml = fs.readFileSync(inputPath, 'utf8');
    try {
      const revisedHtml = await reviseHTML(cfg, originalHtml, revisionPrompt, file);
      fs.writeFileSync(outputPath, revisedHtml, 'utf8');
      log(`   ✓ Revised written to ${outputPath}`);
      successCount++;
    } catch (err) {
      logError(`✗ Revision failed for ${file}: ${err.message}`);
      // Move original file to failures folder
      fs.copyFileSync(inputPath, failurePath);
      log(`   Original moved to ${failurePath}`);
      failureCount++;
    }
  }

  logSection(`DONE — Success: ${successCount}, Failures: ${failureCount}`);
  log(`Log file: ${LOG_FILE}`);
  if (failureCount > 0) {
    log(`Check ${failuresDir} for original files that failed.`);
  }
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});