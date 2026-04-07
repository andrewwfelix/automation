#!/usr/bin/env node
/**
 * BooksVersusMovies.com — Page Generator
 * Reads config from movies.cfg, prompt from prompt.txt,
 * picks the next unbuilt row(s) from a CSV, generates complete
 * HTML comparison pages via OpenRouter, and writes SUCCESS or
 * ERROR:<message> back to the status column in the CSV.
 *
 * Usage:
 *   node generate-page.js                  # generate next unbuilt page (or all if ALL_ROWS=true)
 *   node generate-page.js --row 3          # generate specific row number (1-indexed, excludes header)
 *   node generate-page.js --all            # process all unbuilt rows regardless of ALL_ROWS setting
 *   node generate-page.js --dry-run        # show row info without calling API
 *
 * Config (movies.cfg):
 *   ALL_ROWS=true    process all unbuilt rows in one run
 *   ALL_ROWS=false   process only the next single unbuilt row (default)
 *
 * Requirements:
 *   npm install axios
 *   (no xlsx needed — reads CSV natively)
 *
 * Log file: generate-page.log (same directory as this script)
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

// ------------------------------------------------------------------ //
// LOGGER
// ------------------------------------------------------------------ //
const scriptDir = path.dirname(path.resolve(process.argv[1]));
const LOG_FILE  = path.join(scriptDir, 'generate-page.log');

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function appendLog(line) {
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  appendLog(line);
}

function logError(message) {
  const line = `[${timestamp()}] ❌ ${message}`;
  console.error(line);
  appendLog(line);
}

function logSection(title) {
  const bar  = '─'.repeat(60);
  const line = `\n[${timestamp()}] ${bar}\n[${timestamp()}] ${title}\n[${timestamp()}] ${bar}`;
  console.log(line);
  appendLog(line);
}

// ------------------------------------------------------------------ //
// LOAD CONFIG
// ------------------------------------------------------------------ //
function loadConfig(cfgPath) {
  if (!fs.existsSync(cfgPath)) {
    logError(`Config file not found: ${cfgPath}`);
    logError('Create a movies.cfg file next to this script.');
    process.exit(1);
  }

  const cfg   = {};
  const lines = fs.readFileSync(cfgPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    cfg[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }

  const required = ['OPENROUTER_API_KEY', 'SPREADSHEET_PATH', 'OUTPUT_DIR', 'PROMPT_FILE', 'MODEL'];
  for (const key of required) {
    if (!cfg[key]) {
      logError(`Missing required config key: ${key}`);
      process.exit(1);
    }
  }
  return cfg;
}

// ------------------------------------------------------------------ //
// LOAD PROMPT
// ------------------------------------------------------------------ //
function loadPrompt(promptPath) {
  if (!fs.existsSync(promptPath)) {
    logError(`Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  return fs.readFileSync(promptPath, 'utf8');
}

// ------------------------------------------------------------------ //
// CSV PARSER — handles quoted fields containing commas/newlines
// ------------------------------------------------------------------ //
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    logError(`CSV file not found: ${filePath}`);
    process.exit(1);
  }

  const raw  = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  let   cur  = '';
  let   inQ  = false;

  // Split into fields respecting quoted strings
  const parseRow = (line) => {
    const fields = [];
    let   field  = '';
    let   quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch   = line[i];
      const next = line[i + 1];

      if (ch === '"' && quoted && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { fields.push(field); field = ''; continue; }
      field += ch;
    }
    fields.push(field);
    return fields;
  };

  // Handle multi-line quoted fields
  const lines = [];
  for (const ch of raw) {
    if (ch === '"') inQ = !inQ;
    if ((ch === '\n' || ch === '\r') && !inQ) {
      if (cur.trim()) lines.push(cur.replace(/\r/g, ''));
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) lines.push(cur.replace(/\r/g, ''));

  const headers = parseRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const obj    = {};
    headers.forEach((h, idx) => { obj[h.trim()] = (values[idx] || '').trim(); });
    rows.push(obj);
  }

  return { headers, rows };
}

// ------------------------------------------------------------------ //
// WRITE STATUS BACK TO CSV
// Writes SUCCESS or ERROR:<message> into the "status" column for the
// matching row (matched by slug), adding the column if it doesn't exist.
// ------------------------------------------------------------------ //
function writeStatus(csvPath, slug, statusValue, model) {
  try {
    const { headers, rows } = parseCSV(csvPath);

    // Ensure columns exist
    if (!headers.includes('process_date'))  headers.push('process_date');
    if (!headers.includes('process_model')) headers.push('process_model');
    if (!headers.includes('status'))        headers.push('status');

    // Update the matching row
    for (const row of rows) {
      if (row.slug === slug) {
        row.status        = statusValue;
        row.process_date  = new Date().toISOString().replace('T', ' ').slice(0, 19);
        row.process_model = model || '';
        break;
      }
    }

    // Rebuild CSV
    const escapeField = (val) => {
      const s = String(val || '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const lines = [
      headers.map(escapeField).join(','),
      ...rows.map(row => headers.map(h => escapeField(row[h] || '')).join(',')),
    ];

    fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');
    log(`   CSV status updated: ${slug} → ${statusValue}`);
  } catch (err) {
    logError(`Failed to write status to CSV: ${err.message}`);
    // Non-fatal — don't exit, the HTML was already saved successfully
  }
}

// ------------------------------------------------------------------ //
// FIND NEXT UNBUILT ROW
// Skips rows that: already have SUCCESS status, already have an html
// file, or are missing required data.
// ------------------------------------------------------------------ //
function findNextRow(rows, outputDir, specificRow = null) {
  if (specificRow !== null) {
    const row = rows[specificRow - 1];
    if (!row) {
      logError(`Row ${specificRow} not found (CSV has ${rows.length} data rows)`);
      process.exit(1);
    }
    return { row, index: specificRow };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.slug) continue;

    const outputPath   = path.join(outputDir, `${row.slug}.html`);
    const alreadyBuilt = fs.existsSync(outputPath);
    const alreadyOk    = (row.status || '').toUpperCase() === 'SUCCESS';
    const hasBadData   = !row.affiliate_link || !row.trailer_url ||
                         String(row.film_year) === 'TBD' || row.director === 'TBD';

    if (alreadyBuilt || alreadyOk) {
      log(`   Skipping row ${i + 1} (${row.title}) — already built`);
      continue;
    }
    if (hasBadData) {
      log(`   ⚠️  Skipping row ${i + 1} (${row.title}) — missing affiliate_link, trailer_url, or TBD year`);
      continue;
    }

    return { row, index: i + 1 };
  }

  return null;
}

// ------------------------------------------------------------------ //
// HELPERS
// ------------------------------------------------------------------ //
function extractYouTubeId(url) {
  if (!url) return '';
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : '';
}

function verdictClass(verdict) {
  if (verdict === 'Book Wins')  return 'verdict-book';
  if (verdict === 'Movie Wins') return 'verdict-film';
  return 'verdict-tie';
}

function detectMediaLabel(row) {
  const keywords = ['HBO', 'Netflix', 'Hulu', 'BBC', 'AMC', 'Starz', 'Prime', 'Apple TV', 'Crave', 'FX'];
  return keywords.some(k => (row.director || '').includes(k)) ? 'Series' : 'Movie';
}

// ------------------------------------------------------------------ //
// VALIDATE YOUTUBE THUMBNAIL
// ------------------------------------------------------------------ //
async function validateYoutubeThumbnail(youtubeId, title) {
  if (!youtubeId) {
    logError(`No YouTube ID found for "${title}" — check trailer_url in CSV`);
    return false;
  }

  const thumbUrl = `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;
  log(`   Checking thumbnail: ${thumbUrl}`);

  try {
    const response      = await axios.head(thumbUrl, { timeout: 10000 });
    const contentLength = parseInt(response.headers['content-length'] || '0', 10);
    const contentType   = response.headers['content-type'] || '';

    if (!contentType.startsWith('image/')) {
      logError(`Thumbnail did not return an image (content-type: ${contentType})`);
      logError(`Video may be private, deleted, or ID is wrong: ${youtubeId}`);
      return false;
    }
    if (contentLength > 0 && contentLength < 5000) {
      logError(`Thumbnail is a placeholder (${contentLength} bytes) — video has no maxresdefault`);
      logError(`Verify: ${thumbUrl}`);
      return false;
    }

    log(`   Thumbnail OK — ${contentLength > 0 ? (contentLength / 1024).toFixed(0) + ' KB' : 'size unknown'}`);
    return true;
  } catch (err) {
    logError(`Could not reach thumbnail: ${err.message}`);
    logError(`URL: ${thumbUrl}`);
    return false;
  }
}

// ------------------------------------------------------------------ //
// BUILD PROMPT
// ------------------------------------------------------------------ //
function buildPrompt(template, row) {
  const replacements = {
    TITLE:          row.title          || '',
    AUTHOR:         row.Author         || row.author || '',
    GENRE:          row.genre          || '',
    BOOK_YEAR:      String(row.book_year  || ''),
    FILM_YEAR:      String(row.film_year  || ''),
    DIRECTOR:       row.director       || '',
    VERDICT:        row.verdict        || '',
    AFFILIATE_LINK: row.affiliate_link || '',
    TRAILER_URL:    row.trailer_url    || '',
    YOUTUBE_ID:     extractYouTubeId(row.trailer_url),
    IMAGE:          row.image          || '',
    SLUG:           row.slug           || '',
    MEDIA_LABEL:    detectMediaLabel(row),
    VERDICT_CLASS:       verdictClass(row.verdict),
    VIDEO_AFFILIATE_LINK: row.video_affiliate_link || '',
  };

  let prompt = template;
  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.split(`{{${key}}}`).join(value);
  }
  return prompt;
}

// ------------------------------------------------------------------ //
// CALL OPENROUTER
// ------------------------------------------------------------------ //
async function callOpenRouter(cfg, prompt) {
  const startTime = Date.now();
  const timeoutMs = parseInt(cfg.TIMEOUT_SECONDS || '120', 10) * 1000;
  const maxTokens = parseInt(cfg.MAX_TOKENS || '4000', 10);

  log(`   Sending request — model: ${cfg.MODEL}, max_tokens: ${maxTokens}, prompt_length: ${prompt.length} chars`);
  log(`   Timeout: ${timeoutMs / 1000}s`);

  let response;
  try {
    response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model:      cfg.MODEL,
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      },
      {
        timeout: timeoutMs,
        headers: {
          'Authorization': `Bearer ${cfg.OPENROUTER_API_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  cfg.SITE_URL || 'https://booksversusmovies.com',
          'X-Title':       'BooksVersusMovies Page Generator',
        },
      }
    );
  } catch (err) {
    if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
      throw new Error(`API timed out after ${timeoutMs / 1000}s — model "${cfg.MODEL}" may be invalid or overloaded`);
    } else if (err.response) {
      throw new Error(`API HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      throw new Error(`Network error: ${err.message}`);
    }
  }

  const elapsed      = ((Date.now() - startTime) / 1000).toFixed(1);
  const usage        = response.data.usage || {};
  const stopReason   = response.data.choices?.[0]?.finish_reason || 'unknown';

  log(`   HTTP ${response.status} — received in ${elapsed}s`);
  log(`   Tokens — prompt: ${usage.prompt_tokens || '?'}, completion: ${usage.completion_tokens || '?'}, total: ${usage.total_tokens || '?'}`);
  log(`   Finish reason: ${stopReason}`);

  if (response.data.error) {
    throw new Error(`OpenRouter error: ${JSON.stringify(response.data.error)}`);
  }
  if (stopReason === 'length') {
    log(`   ⚠️  Response cut off at max_tokens (${maxTokens}) — consider increasing MAX_TOKENS in movies.cfg`);
  }
  if (stopReason === 'content_filter') {
    throw new Error('Response blocked by content filter');
  }

  const content = response.data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Empty content in response. Full body: ${JSON.stringify(response.data)}`);
  }

  log(`   Response length: ${content.length} chars`);
  return content.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
}

// ------------------------------------------------------------------ //
// PROCESS ONE ROW — returns true on success, false on error
// ------------------------------------------------------------------ //
async function processRow(cfg, promptTemplate, resolvedCSV, resolvedOutput, row, index, dryRun) {
  const outputPath = path.join(resolvedOutput, `${row.slug}.html`);

  log(`\nRow ${index} — "${row.title}"`);
  log(`   Slug:    ${row.slug}`);
  log(`   Genre:   ${row.genre}`);
  log(`   Verdict: ${row.verdict}`);
  log(`   Year:    ${row.film_year}`);
  log(`   Output:  ${outputPath}`);

  if (dryRun) {
    log('DRY RUN — skipping API call. Prompt preview (first 500 chars):');
    log(buildPrompt(promptTemplate, row).substring(0, 500) + '\n...');
    return true;
  }

  // Pre-flight: thumbnail check
  log('Pre-flight checks...');
  const ytId    = extractYouTubeId(row.trailer_url);
  const thumbOk = await validateYoutubeThumbnail(ytId, row.title);
  if (!thumbOk) {
    const errMsg = `Thumbnail missing for YouTube ID "${ytId}"`;
    logError(errMsg);
    writeStatus(resolvedCSV, row.slug, `ERROR:${errMsg}`, cfg.MODEL);
    return false;
  }

  // Call API
  log('Calling OpenRouter API...');
  const startTotal = Date.now();
  let html;
  try {
    html = await callOpenRouter(cfg, buildPrompt(promptTemplate, row));
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    writeStatus(resolvedCSV, row.slug, `ERROR:${err.message.replace(/\n/g, ' ')}`, cfg.MODEL);
    return false;
  }

  // Validate HTML
  if (!html.includes('<!DOCTYPE html>') || !html.includes('</html>')) {
    const errMsg = 'Response is not valid HTML';
    logError(errMsg);
    const debugPath = path.join(scriptDir, 'debug.txt');
    fs.writeFileSync(debugPath, html, 'utf8');
    logError(`Raw response saved to: ${debugPath}`);
    writeStatus(resolvedCSV, row.slug, `ERROR:${errMsg}`, cfg.MODEL);
    return false;
  }

  // Save HTML
  fs.writeFileSync(outputPath, html, 'utf8');
  const totalSec = ((Date.now() - startTotal) / 1000).toFixed(1);
  const sizeKb   = (html.length / 1024).toFixed(1);

  log(`SUCCESS — ${outputPath} (${sizeKb} KB, ${totalSec}s)`);
  writeStatus(resolvedCSV, row.slug, 'SUCCESS', cfg.MODEL);
  return true;
}

// ------------------------------------------------------------------ //
// MAIN
// ------------------------------------------------------------------ //
async function main() {
  const args        = process.argv.slice(2);
  const dryRun      = args.includes('--dry-run');
  const forceAll    = args.includes('--all');
  const rowArgIdx   = args.indexOf('--row');
  const specificRow = rowArgIdx !== -1 ? parseInt(args[rowArgIdx + 1], 10) : null;

  const cfgPath = path.join(scriptDir, 'movies.cfg');
  logSection(dryRun ? 'DRY RUN' : 'GENERATE PAGE');

  // Load config
  const cfg     = loadConfig(cfgPath);
  const allRows = forceAll || (cfg.ALL_ROWS || '').toLowerCase() === 'true';
  log(`Config: ${cfgPath}`);
  log(`Mode: ${allRows ? 'ALL unbuilt rows' : 'single next row'}`);

  // Resolve prompt path
  const promptPath = path.isAbsolute(cfg.PROMPT_FILE)
    ? cfg.PROMPT_FILE
    : path.join(scriptDir, cfg.PROMPT_FILE);
  const promptTemplate = loadPrompt(promptPath);
  log(`Prompt: ${promptPath}`);

  // Resolve CSV and output paths
  const resolvedCSV = path.isAbsolute(cfg.SPREADSHEET_PATH)
    ? cfg.SPREADSHEET_PATH
    : path.join(process.cwd(), cfg.SPREADSHEET_PATH);

  const resolvedOutput = path.isAbsolute(cfg.OUTPUT_DIR)
    ? cfg.OUTPUT_DIR
    : path.join(process.cwd(), cfg.OUTPUT_DIR);

  if (!fs.existsSync(resolvedOutput)) {
    fs.mkdirSync(resolvedOutput, { recursive: true });
    log(`Created output dir: ${resolvedOutput}`);
  }

  // Load CSV
  const { rows } = parseCSV(resolvedCSV);
  log(`CSV loaded: ${rows.length} rows from ${resolvedCSV}`);
  log(`Model: ${cfg.MODEL}`);
  log(`Output: ${resolvedOutput}`);

  // ── SINGLE ROW MODE ──────────────────────────────────────────────
  if (!allRows) {
    const result = findNextRow(rows, resolvedOutput, specificRow);
    if (!result) {
      log('All rows are already built or skipped — nothing to do.');
      return;
    }
    await processRow(cfg, promptTemplate, resolvedCSV, resolvedOutput, result.row, result.index, dryRun);
    return;
  }

  // ── ALL ROWS MODE ────────────────────────────────────────────────
  let built = 0, errors = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    // Re-parse CSV each iteration so status changes from previous rows are picked up
    const { rows: freshRows } = parseCSV(resolvedCSV);
    const result = findNextRow(freshRows, resolvedOutput, null);

    if (!result) break; // nothing left to process

    const ok = await processRow(cfg, promptTemplate, resolvedCSV, resolvedOutput, result.row, result.index, dryRun);
    if (ok) built++; else errors++;
  }

  logSection(`RUN COMPLETE`);
  log(`Built: ${built}  |  Errors: ${errors}  |  Skipped: ${skipped}`);
  log(`Log: ${LOG_FILE}`);
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
