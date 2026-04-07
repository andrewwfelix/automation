#!/usr/bin/env node
/**
 * BooksVersusMovies.com — Page Revision Script
 * Reads existing HTML files from ./input/, applies revisions via OpenRouter,
 * and writes revised HTML to ./output/. Updates status in CSV.
 *
 * Usage:
 *   node revise-page.js                 # process all rows with existing input file
 *   node revise-page.js --dry-run       # show what would be processed
 *   node revise-page.js --slug about-a-boy  # process only specific slug(s) (comma-separated)
 *
 * Config (movies.cfg) uses:
 *   OPENROUTER_API_KEY, MODEL, SPREADSHEET_PATH, REVISE_PROMPT_PATH
 *   REVISE_SLUGS (optional)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ------------------------------------------------------------------ //
// LOGGER (same as generate-page.js)
// ------------------------------------------------------------------ //
const scriptDir = path.dirname(path.resolve(process.argv[1]));
const LOG_FILE = path.join(scriptDir, 'revise-page.log');

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
  const required = ['OPENROUTER_API_KEY', 'SPREADSHEET_PATH', 'REVISE_PROMPT_PATH', 'MODEL'];
  for (const key of required) {
    if (!cfg[key]) {
      logError(`Missing required config key: ${key}`);
      process.exit(1);
    }
  }
  return cfg;
}

// ------------------------------------------------------------------ //
// CSV PARSER (same as generate-page.js)
// ------------------------------------------------------------------ //
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    logError(`CSV file not found: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  let inQ = false;
  const lines = [];
  let cur = '';
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

  const parseRow = (line) => {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i+1];
      if (ch === '"' && quoted && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { fields.push(field); field = ''; continue; }
      field += ch;
    }
    fields.push(field);
    return fields;
  };

  const headers = parseRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h.trim()] = (values[idx] || '').trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

// ------------------------------------------------------------------ //
// WRITE STATUS BACK TO CSV
// ------------------------------------------------------------------ //
function writeStatus(csvPath, slug, statusValue, model) {
  try {
    const { headers, rows } = parseCSV(csvPath);
    if (!headers.includes('process_date')) headers.push('process_date');
    if (!headers.includes('process_model')) headers.push('process_model');
    if (!headers.includes('status')) headers.push('status');

    for (const row of rows) {
      if (row.slug === slug) {
        row.status = statusValue;
        row.process_date = new Date().toISOString().replace('T', ' ').slice(0, 19);
        row.process_model = model || '';
        break;
      }
    }

    const escapeField = (val) => {
      const s = String(val || '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.map(escapeField).join(','),
      ...rows.map(row => headers.map(h => escapeField(row[h] || '')).join(',')),
    ];
    fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');
    log(`   CSV status updated: ${slug} → ${statusValue}`);
  } catch (err) {
    logError(`Failed to write status to CSV: ${err.message}`);
  }
}

// ------------------------------------------------------------------ //
// CALL OPENROUTER FOR REVISION
// ------------------------------------------------------------------ //
async function reviseHTML(cfg, currentHtml, revisionPrompt, slug) {
  const timeoutMs = parseInt(cfg.TIMEOUT_SECONDS || '120', 10) * 1000;
  const maxTokens = parseInt(cfg.MAX_TOKENS || '8000', 10);

  const userPrompt = `${revisionPrompt}\n\nHere is the HTML file to revise (slug: ${slug}):\n\n${currentHtml}`;

  log(`   Sending revision request — model: ${cfg.MODEL}, max_tokens: ${maxTokens}`);
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
          'X-Title': 'BooksVersusMovies Revision Script',
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
  // Extract HTML from possible markdown code blocks
  let revisedHtml = content.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
  if (!revisedHtml.startsWith('<!DOCTYPE html>')) {
    // Try to find the first <!DOCTYPE or <html
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
  let specificSlugs = null;
  const slugArgIdx = args.indexOf('--slug');
  if (slugArgIdx !== -1) {
    specificSlugs = args[slugArgIdx+1].split(',').map(s => s.trim());
  }

  logSection(dryRun ? 'DRY RUN: REVISION' : 'REVISION SCRIPT');

  const cfg = loadConfig(path.join(scriptDir, 'movies.cfg'));
  log(`Config loaded from ${path.join(scriptDir, 'movies.cfg')}`);

  // Resolve paths
  const csvPath = path.isAbsolute(cfg.SPREADSHEET_PATH) ? cfg.SPREADSHEET_PATH : path.join(process.cwd(), cfg.SPREADSHEET_PATH);
  const inputDir = path.join(scriptDir, 'input');
  const outputDir = path.join(scriptDir, 'output');
  if (!fs.existsSync(inputDir)) {
    logError(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  log(`Input dir: ${inputDir}`);
  log(`Output dir: ${outputDir}`);

  // Load revision prompt
  const promptPath = path.isAbsolute(cfg.REVISE_PROMPT_PATH) ? cfg.REVISE_PROMPT_PATH : path.join(scriptDir, cfg.REVISE_PROMPT_PATH);
  if (!fs.existsSync(promptPath)) {
    logError(`Revision prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  const revisionPrompt = fs.readFileSync(promptPath, 'utf8');
  log(`Revision prompt: ${promptPath}`);

  // Load CSV and determine slugs to process
  const { rows } = parseCSV(csvPath);
  let slugsToProcess = specificSlugs;
  if (!slugsToProcess) {
    const cfgSlugs = cfg.REVISE_SLUGS ? cfg.REVISE_SLUGS.split(',').map(s => s.trim()) : [];
    if (cfgSlugs.length) slugsToProcess = cfgSlugs;
    else {
      // Process all rows that have an existing HTML file in input/
      slugsToProcess = rows.map(r => r.slug).filter(slug => {
        const inputPath = path.join(inputDir, `${slug}.html`);
        return fs.existsSync(inputPath);
      });
    }
  }
  log(`Target slugs: ${slugsToProcess.length ? slugsToProcess.join(', ') : '(none)'}`);

  let processed = 0, errors = 0;
  for (const slug of slugsToProcess) {
    const inputPath = path.join(inputDir, `${slug}.html`);
    const outputPath = path.join(outputDir, `${slug}.html`);
    if (!fs.existsSync(inputPath)) {
      logError(`Input file missing for ${slug} — skipping`);
      writeStatus(csvPath, slug, `ERROR:Missing input file`, cfg.MODEL);
      errors++;
      continue;
    }

    log(`\nProcessing ${slug}...`);
    const originalHtml = fs.readFileSync(inputPath, 'utf8');
    if (dryRun) {
      log(`DRY RUN: would revise ${slug} and write to ${outputPath}`);
      processed++;
      continue;
    }

    try {
      const revisedHtml = await reviseHTML(cfg, originalHtml, revisionPrompt, slug);
      fs.writeFileSync(outputPath, revisedHtml, 'utf8');
      log(`   Revised HTML written to ${outputPath}`);
      writeStatus(csvPath, slug, 'REVISED', cfg.MODEL);
      processed++;
    } catch (err) {
      logError(`Revision failed for ${slug}: ${err.message}`);
      writeStatus(csvPath, slug, `ERROR:${err.message.replace(/\n/g, ' ')}`, cfg.MODEL);
      errors++;
    }
  }

  logSection(`DONE — Processed: ${processed}, Errors: ${errors}`);
  log(`Log file: ${LOG_FILE}`);
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});