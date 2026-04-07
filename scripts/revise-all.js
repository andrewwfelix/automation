#!/usr/bin/env node
/**
 * BooksVersusMovies.com — Single‑Stage Batch Revision (no slug cleanup)
 * 
 * Reads all .html files from ./data/input/, sends each to OpenRouter with revision prompt,
 * writes revised HTML directly to ./data/final/.
 * 
 * Config file location: ./config/revise-all.json (default)
 * 
 * Usage:
 *   node scripts/revise-all.js                              # default config
 *   node scripts/revise-all.js --config custom-config.json
 *   node scripts/revise-all.js --dry-run
 *   node scripts/revise-all.js --file atonement.html
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(process.cwd(), 'config', '.env') });

// ------------------------------------------------------------------ //
// LOGGER
// ------------------------------------------------------------------ //
const LOG_FILE = path.join(process.cwd(), 'logs', 'revise-all.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

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
// LOAD CONFIG (JSON)
// ------------------------------------------------------------------ //
function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    logError(`Config file not found: ${configPath}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  if (!config.mainRevision || !config.mainRevision.model) {
    logError(`config.mainRevision.model required`);
    process.exit(1);
  }
  
  if (!config.mainRevision.maxTokens) config.mainRevision.maxTokens = 22000;
  if (!config.mainRevision.temperature) config.mainRevision.temperature = 0.1;
  if (!config.mainRevision.stripAffiliateLinks) config.mainRevision.stripAffiliateLinks = false;
  
  if (!config.paths) config.paths = {};
  if (!config.paths.inputDir) config.paths.inputDir = 'data/input';
  if (!config.paths.finalDir) config.paths.finalDir = 'data/final';
  
  return config;
}

// ------------------------------------------------------------------ //
// STRIP / RESTORE AFFILIATE LINKS
// ------------------------------------------------------------------ //
function stripAffiliateLinks(html) {
  let stripped = html.replace(/https?:\/\/amzn\.to\/[^\s"']+/g, 'AMAZON_AFFILIATE_PLACEHOLDER');
  stripped = stripped.replace(/https?:\/\/www\.amazon\.com\/[^\s"']+/g, 'AMAZON_AFFILIATE_PLACEHOLDER');
  return stripped;
}

function restoreAffiliateLinks(originalHtml, revisedHtml) {
  const linkRegex = /https?:\/\/amzn\.to\/[^\s"']+|https?:\/\/www\.amazon\.com\/[^\s"']+/g;
  const originalLinks = originalHtml.match(linkRegex) || [];
  let restored = revisedHtml;
  let idx = 0;
  restored = restored.replace(/AMAZON_AFFILIATE_PLACEHOLDER/g, () => originalLinks[idx++] || '');
  return restored;
}

// ------------------------------------------------------------------ //
// CALL OPENROUTER
// ------------------------------------------------------------------ //
async function callOpenRouter(apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutSeconds, temperature, siteUrl) {
  const timeoutMs = timeoutSeconds * 1000;
  
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: temperature
    },
    {
      timeout: timeoutMs,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': siteUrl || 'https://booksversusmovies.com',
        'X-Title': 'BooksVersusMovies Revision'
      }
    }
  );
  
  const content = response.data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Empty response: ${JSON.stringify(response.data)}`);
  }
  
  let cleaned = content.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
  if (!cleaned.startsWith('<!DOCTYPE html>')) {
    const match = cleaned.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
    if (match) cleaned = match[0];
    else throw new Error('Response does not contain valid HTML');
  }
  return cleaned;
}

// ------------------------------------------------------------------ //
// MAIN REVISION (SINGLE STAGE)
// ------------------------------------------------------------------ //
async function reviseFile(config, apiKey, inputHtml, fileName) {
  const promptPath = path.isAbsolute(config.paths.revisePrompt)
    ? config.paths.revisePrompt
    : path.join(process.cwd(), config.paths.revisePrompt);
  
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Revision prompt not found: ${promptPath}`);
  }
  const revisionPrompt = fs.readFileSync(promptPath, 'utf8');
  
  let htmlToSend = inputHtml;
  const stripLinks = config.mainRevision.stripAffiliateLinks;
  if (stripLinks) {
    htmlToSend = stripAffiliateLinks(inputHtml);
    log(`   Stripped affiliate links for ${fileName}`);
  }
  
  const userPrompt = `${revisionPrompt}\n\nHere is the HTML file to revise (${fileName}):\n\n${htmlToSend}`;
  const systemPrompt = 'You are an HTML code generator. You must output ONLY valid HTML code. Never include explanations, markdown, or any text outside the HTML. The output must start with <!DOCTYPE html> and end with </html>.';
  
  log(`   Model: ${config.mainRevision.model}, max_tokens: ${config.mainRevision.maxTokens}`);
  const revisedHtml = await callOpenRouter(
    apiKey,
    config.mainRevision.model,
    systemPrompt,
    userPrompt,
    config.mainRevision.maxTokens,
    config.mainRevision.timeoutSeconds || 180,
    config.mainRevision.temperature,
    config.api?.siteUrl
  );
  
  if (stripLinks) {
    return restoreAffiliateLinks(inputHtml, revisedHtml);
  }
  return revisedHtml;
}

// ------------------------------------------------------------------ //
// PROCESS ONE FILE
// ------------------------------------------------------------------ //
async function processFile(config, apiKey, inputFilePath, finalFilePath, dryRun) {
  const fileName = path.basename(inputFilePath);
  log(`Processing: ${fileName}`);
  
  if (dryRun) {
    log(`   DRY RUN: would revise ${fileName} -> ${finalFilePath}`);
    return { success: true };
  }
  
  const originalHtml = fs.readFileSync(inputFilePath, 'utf8');
  
  try {
    const revisedHtml = await reviseFile(config, apiKey, originalHtml, fileName);
    fs.writeFileSync(finalFilePath, revisedHtml, 'utf8');
    log(`   ✓ Saved: ${finalFilePath} (${(revisedHtml.length/1024).toFixed(1)} KB)`);
    return { success: true };
  } catch (err) {
    logError(`✗ Failed for ${fileName}: ${err.message}`);
    const failuresDir = path.join(path.dirname(finalFilePath), 'failures');
    if (!fs.existsSync(failuresDir)) fs.mkdirSync(failuresDir, { recursive: true });
    const failurePath = path.join(failuresDir, fileName);
    fs.copyFileSync(inputFilePath, failurePath);
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
  const configArgIdx = args.indexOf('--config');
  const defaultConfigPath = path.join(process.cwd(), 'config', 'revise-all.json');
  const configPath = configArgIdx !== -1 ? args[configArgIdx + 1] : defaultConfigPath;
  const fileArgIdx = args.indexOf('--file');
  const specificFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;
  
  if (configArgIdx !== -1 && !args[configArgIdx + 1]) {
    logError('--config requires a file path');
    process.exit(1);
  }
  if (fileArgIdx !== -1 && !specificFile) {
    logError('--file requires a filename');
    process.exit(1);
  }
  
  logSection(dryRun ? 'DRY RUN: SINGLE-STAGE REVISION' : 'SINGLE-STAGE REVISION (no slug cleanup)');
  
  const config = loadConfig(configPath);
  log(`Config: ${configPath}`);
  log(`Model: ${config.mainRevision.model}`);
  
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logError('OPENROUTER_API_KEY environment variable not set');
    process.exit(1);
  }
  
  const inputDir = path.isAbsolute(config.paths.inputDir)
    ? config.paths.inputDir
    : path.join(process.cwd(), config.paths.inputDir);
  const finalDir = path.isAbsolute(config.paths.finalDir)
    ? config.paths.finalDir
    : path.join(process.cwd(), config.paths.finalDir);
  
  if (!fs.existsSync(inputDir)) {
    logError(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  fs.mkdirSync(finalDir, { recursive: true });
  
  log(`Input: ${inputDir}`);
  log(`Final: ${finalDir}`);
  
  let files = [];
  if (specificFile) {
    const fullPath = path.join(inputDir, specificFile);
    if (!fs.existsSync(fullPath)) {
      logError(`File not found: ${fullPath}`);
      process.exit(1);
    }
    files = [{ name: specificFile, fullPath }];
  } else {
    const allFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.html'));
    files = allFiles.map(f => ({ name: f, fullPath: path.join(inputDir, f) }));
  }
  
  if (files.length === 0) {
    log('No .html files found in input directory.');
    return;
  }
  
  log(`Files to process: ${files.length}`);
  
  let successCount = 0, failureCount = 0;
  for (const file of files) {
    const finalPath = path.join(finalDir, file.name);
    const result = await processFile(config, apiKey, file.fullPath, finalPath, dryRun);
    if (result.success) successCount++;
    else failureCount++;
  }
  
  logSection(`DONE — Success: ${successCount}  Failures: ${failureCount}`);
  log(`Log: ${LOG_FILE}`);
  if (failureCount > 0) log(`Failed originals preserved in: ${finalDir}/failures`);
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});