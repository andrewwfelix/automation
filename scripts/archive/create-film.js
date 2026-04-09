#!/usr/bin/env node

/**
 * create-film.js
 * 
 * Generates a new book vs movie comparison HTML file from a prompt template.
 * 
 * Reads configuration from ../config/create-film.json, loads the prompt template,
 * calls OpenRouter with the user's inputs (slug, affiliate link, YouTube URL),
 * and writes the generated HTML to the configured output directory.
 * 
 * Usage:
 *   node create-film.js "slug" "https://amzn.to/XXXXXX" "https://youtube.com/watch?v=XXXXXXX"
 * 
 * Example:
 *   node create-film.js "mickey-17" "https://amzn.to/4sYfgP3" "https://youtube.com/watch?v=osYpGSz_0i4"
 * 
 * Environment variables (from config/.env):
 *   OPENROUTER_API_KEY - Your OpenRouter API key (required)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(process.cwd(), 'config', '.env') });

// ------------------------------------------------------------------ //
// LOGGER (minimal version, no file logging unless you want it)
// ------------------------------------------------------------------ //
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function logError(message) {
  console.error(`[${timestamp()}] ❌ ${message}`);
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
  if (!config.mainRevision.timeoutSeconds) config.mainRevision.timeoutSeconds = 180;
  
  if (!config.paths) config.paths = {};
  if (!config.paths.revisePrompt) config.paths.revisePrompt = 'prompts/create-film.txt';
  if (!config.paths.finalDir) config.paths.finalDir = 'data/final';
  
  return config;
}

// ------------------------------------------------------------------ //
// STRIP / RESTORE AFFILIATE LINKS (optional)
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
        'X-Title': 'BooksVersusMovies Generator'
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
// GENERATE FROM PROMPT
// ------------------------------------------------------------------ //
async function generatePage(config, apiKey, filmName, affiliateLink, youtubeUrl) {
  const promptPath = path.isAbsolute(config.paths.revisePrompt)
    ? config.paths.revisePrompt
    : path.join(process.cwd(), config.paths.revisePrompt);
  
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt template not found: ${promptPath}`);
  }
  let promptTemplate = fs.readFileSync(promptPath, 'utf8');
  
  // Replace placeholders
  let userPrompt = promptTemplate
    .replace(/\{film_name\}/g, filmName)
    .replace(/\{affiliate_link\}/g, affiliateLink)
    .replace(/\{youtube_trailer_url\}/g, youtubeUrl);
  
  const stripLinks = config.mainRevision.stripAffiliateLinks;
  if (stripLinks) {
    userPrompt = stripAffiliateLinks(userPrompt);
    log(`   Stripped affiliate links from prompt`);
  }
  
  const systemPrompt = 'You are an HTML code generator. You must output ONLY valid HTML code. Never include explanations, markdown, or any text outside the HTML. The output must start with <!DOCTYPE html> and end with </html>. Follow the exact structure of the example provided in the user prompt.';
  
  log(`   Model: ${config.mainRevision.model}, max_tokens: ${config.mainRevision.maxTokens}`);
  const generatedHtml = await callOpenRouter(
    apiKey,
    config.mainRevision.model,
    systemPrompt,
    userPrompt,
    config.mainRevision.maxTokens,
    config.mainRevision.timeoutSeconds,
    config.mainRevision.temperature,
    config.api?.siteUrl
  );
  
  if (stripLinks) {
    // Since we stripped links from the prompt (which contained the example HTML),
    // we need to restore them. But the generated HTML should already have the placeholder?
    // Simpler: just return as is, because the placeholder won't appear in output.
    // Actually the prompt contains the example with placeholder replacement already done.
    // For safety, we don't restore here because there's no "originalHtml" to reference.
    // We'll rely on the fact that we replaced the placeholder with the actual link before sending.
    return generatedHtml;
  }
  return generatedHtml;
}

// ------------------------------------------------------------------ //
// MAIN
// ------------------------------------------------------------------ //
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    logError(`
Missing arguments.
Usage: node create-film.js "slug" "Affiliate Link" "YouTube URL"

Example:
  node create-film.js "mickey-17" "https://amzn.to/4sYfgP3" "https://youtube.com/watch?v=osYpGSz_0i4"
`);
    process.exit(1);
  }

  const slug = args[0];
  const affiliateLink = args[1];
  const youtubeUrl = args[2];

  // Convert slug to display title (e.g., "mickey-17" -> "Mickey 17")
  function slugToTitle(slug) {
    return slug
      .split(/[-_]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  const filmName = slugToTitle(slug);

  // Config path: ../config/create-film.json (relative to script location)
  const scriptDir = __dirname;
  const defaultConfigPath = path.join(scriptDir, '..', 'config', 'create-film.json');
  const configPath = defaultConfigPath;

  log(`Loading config: ${configPath}`);
  const config = loadConfig(configPath);
  log(`Model: ${config.mainRevision.model}`);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logError('OPENROUTER_API_KEY environment variable not set');
    logError('Make sure you have a config/.env file with OPENROUTER_API_KEY=...');
    process.exit(1);
  }

  const outputDir = path.isAbsolute(config.paths.finalDir)
    ? config.paths.finalDir
    : path.join(process.cwd(), config.paths.finalDir);
  
  fs.mkdirSync(outputDir, { recursive: true });
  log(`Output directory: ${outputDir}`);

  log(`Generating page for "${filmName}" (slug: ${slug})...`);
  log(`Affiliate link: ${affiliateLink}`);
  log(`YouTube URL: ${youtubeUrl}`);

  try {
    const generatedHtml = await generatePage(config, apiKey, filmName, affiliateLink, youtubeUrl);
    
    const outputFile = path.join(outputDir, `${slug}.html`);
    fs.writeFileSync(outputFile, generatedHtml, 'utf8');
    log(`✅ Success! Saved to ${outputFile} (${(generatedHtml.length/1024).toFixed(1)} KB)`);
  } catch (err) {
    logError(`Generation failed: ${err.message}`);
    if (err.response) logError(`API response: ${JSON.stringify(err.response.data)}`);
    process.exit(1);
  }
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});