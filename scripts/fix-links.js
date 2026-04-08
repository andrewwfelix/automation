#!/usr/bin/env node
/**
 * fix-links.js – Fix broken internal links using AI (with full file list context)
 *
 * Reads CSV from config.paths.brokenLinksCsv, reads all existing .html files,
 * sends both to AI, applies corrections.
 * Outputs corrected HTML to config.paths.outputDir (never modifies originals).
 *
 * Config: ./config/fix-links.json
 * Environment: OPENROUTER_API_KEY in .env
 *
 * Usage:
 *   node scripts/fix-links.js
 *   node scripts/fix-links.js --dry-run
 *   node scripts/fix-links.js --file a-little-life.html
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

// ------------------------------------------------------------------ //
// LOGGER
// ------------------------------------------------------------------ //
const LOG_FILE = path.join(process.cwd(), 'logs', 'fix-links.log');
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
// LOAD CONFIG
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

    if (!config.mainRevision.maxTokens) config.mainRevision.maxTokens = 4000;
    if (!config.mainRevision.temperature) config.mainRevision.temperature = 0.1;
    if (!config.mainRevision.timeoutSeconds) config.mainRevision.timeoutSeconds = 60;

    if (!config.paths) config.paths = {};
    if (!config.paths.brokenLinksCsv) config.paths.brokenLinksCsv = 'broken-links.csv';
    if (!config.paths.moviesDir) config.paths.moviesDir = 'C:\\Users\\andre\\projects\\movies';
    if (!config.paths.outputDir) config.paths.outputDir = 'data/output';
    if (!config.paths.promptFile) config.paths.promptFile = 'prompts/fix-broken-links.txt';

    return config;
}

// ------------------------------------------------------------------ //
// READ CSV (handles quoted fields)
// ------------------------------------------------------------------ //
function readBrokenLinksCsv(csvPath) {
    if (!fs.existsSync(csvPath)) {
        logError(`CSV file not found: ${csvPath}`);
        return null;
    }
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const parseRow = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result.map(v => v.replace(/^"|"$/g, ''));
    };

    const headers = parseRow(lines[0]);
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseRow(lines[i]);
        if (row.length >= 5) {
            data.push({
                file: row[0],
                link1: row[1],
                link2: row[2],
                link3: row[3],
                status: row[4]
            });
        }
    }
    return data;
}

// ------------------------------------------------------------------ //
// CALL OPENROUTER
// ------------------------------------------------------------------ //
async function callOpenRouter(apiKey, model, prompt, maxTokens, timeoutSeconds, temperature, siteUrl) {
    const timeoutMs = timeoutSeconds * 1000;
    const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            model: model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperature
        },
        {
            timeout: timeoutMs,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': siteUrl || 'https://booksversusmovies.com',
                'X-Title': 'BooksVersusMovies Link Fixer'
            }
        }
    );
    const content = response.data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Empty response: ${JSON.stringify(response.data)}`);
    return content;
}

// ------------------------------------------------------------------ //
// PARSE AI RESPONSE
// ------------------------------------------------------------------ //
function parseCorrections(aiResponse) {
    let cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
    return parsed;
}

// ------------------------------------------------------------------ //
// APPLY CORRECTIONS (with fallback to original link if AI returns empty)
// ------------------------------------------------------------------ //
function applyCorrectionsToHtml(originalHtml, correctionsForFile) {
    let $ = cheerio.load(originalHtml);
    let changed = false;
    for (const fix of correctionsForFile) {
        // If AI returned empty string, fallback to original link (no change)
        const targetUrl = fix.corrected_url && fix.corrected_url !== '' ? fix.corrected_url : fix.original_url;
        if (targetUrl !== fix.original_url) {
            const selector = `a[href="${fix.original_url.replace(/"/g, '\\"')}"]`;
            $(selector).each((i, el) => {
                $(el).attr('href', targetUrl);
                log(`   Fixed: ${fix.original_url} -> ${targetUrl}`);
                changed = true;
            });
        }
    }
    return changed ? $.html() : originalHtml;
}

// ------------------------------------------------------------------ //
// PROCESS ONE FILE
// ------------------------------------------------------------------ //
async function processFile(config, correctionsForFile, dryRun) {
    const fileName = correctionsForFile.file;
    const inputPath = path.join(config.paths.moviesDir, fileName);
    if (!fs.existsSync(inputPath)) {
        logError(`Source file not found: ${inputPath}`);
        return { success: false, reason: 'missing source' };
    }

    const outputPath = path.join(config.paths.outputDir, fileName);
    if (!dryRun) {
        fs.mkdirSync(config.paths.outputDir, { recursive: true });
    }

    const originalHtml = fs.readFileSync(inputPath, 'utf8');
    const correctedHtml = applyCorrectionsToHtml(originalHtml, correctionsForFile.corrections);

    if (dryRun) {
        log(`   DRY RUN: would write ${fileName} to ${outputPath}`);
        return { success: true };
    }

    fs.writeFileSync(outputPath, correctedHtml, 'utf8');
    log(`   ✓ Saved: ${outputPath} (${(correctedHtml.length/1024).toFixed(1)} KB)`);
    return { success: true };
}

// ------------------------------------------------------------------ //
// MAIN
// ------------------------------------------------------------------ //
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const configArgIdx = args.indexOf('--config');
    const defaultConfigPath = path.join(process.cwd(), 'config', 'fix-links.json');
    const configPath = configArgIdx !== -1 ? args[configArgIdx + 1] : defaultConfigPath;
    const fileArgIdx = args.indexOf('--file');
    const specificFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

    logSection(dryRun ? 'DRY RUN: FIX BROKEN LINKS (with full file list)' : 'FIX BROKEN LINKS (with full file list)');

    const config = loadConfig(configPath);
    log(`Config: ${configPath}`);
    log(`Model: ${config.mainRevision.model}`);

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        logError('OPENROUTER_API_KEY environment variable not set (add to .env file)');
        process.exit(1);
    }

    // 1. Load broken links CSV
    const csvPath = path.isAbsolute(config.paths.brokenLinksCsv)
        ? config.paths.brokenLinksCsv
        : path.join(process.cwd(), config.paths.brokenLinksCsv);

    const brokenData = readBrokenLinksCsv(csvPath);
    if (brokenData === null || brokenData.length === 0) {
        log(`No broken links data found in ${csvPath}. Exiting.`);
        return;
    }
    log(`Loaded ${brokenData.length} rows from ${csvPath}`);

    // 2. Filter by specific file if requested
    let filteredData = brokenData;
    if (specificFile) {
        filteredData = brokenData.filter(row => row.file === specificFile);
        if (filteredData.length === 0) {
            logError(`No broken links found for file: ${specificFile}`);
            process.exit(1);
        }
        log(`Filtered to file: ${specificFile}`);
    }

    // 3. Get list of existing HTML files in movies directory
    const existingFiles = fs.readdirSync(config.paths.moviesDir).filter(f => f.endsWith('.html'));
    const fileListString = existingFiles.map(f => '/' + f).join('\n');
    log(`Found ${existingFiles.length} existing HTML files in movies directory.`);

    // 4. Build CSV string for AI
    const csvHeader = '"file name","link1","link2","link3","status"';
    const csvRows = filteredData.map(row =>
        `"${row.file}","${row.link1}","${row.link2}","${row.link3}","${row.status}"`
    );
    const csvString = [csvHeader, ...csvRows].join('\n');

    // 5. Load prompt template
    const promptTemplatePath = path.isAbsolute(config.paths.promptFile)
        ? config.paths.promptFile
        : path.join(process.cwd(), config.paths.promptFile);

    if (!fs.existsSync(promptTemplatePath)) {
        logError(`Prompt file not found: ${promptTemplatePath}`);
        process.exit(1);
    }
    let promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');

    // Append file list and CSV data
    const fullPrompt = `${promptTemplate}\n\n${fileListString}\n\n=== CSV data ===\n${csvString}`;

    log('Calling OpenRouter to generate corrections...');
    let aiResponse;
    try {
        aiResponse = await callOpenRouter(
            apiKey,
            config.mainRevision.model,
            fullPrompt,
            config.mainRevision.maxTokens,
            config.mainRevision.timeoutSeconds,
            config.mainRevision.temperature,
            config.api?.siteUrl
        );
        log(`Raw AI response length: ${aiResponse.length} characters`);
        log(`Raw AI response preview: ${aiResponse.substring(0, 500)}...`);
    } catch (err) {
        logError(`OpenRouter API call failed: ${err.message}`);
        if (err.response) logError(`Status: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
        process.exit(1);
    }

    let corrections;
    try {
        corrections = parseCorrections(aiResponse);
    } catch (err) {
        logError(`Failed to parse AI response: ${err.message}`);
        log(`Raw response:\n${aiResponse}`);
        process.exit(1);
    }

    log(`Received ${corrections.length} file-level correction objects.`);

    // Convert file-level corrections into a map of {file: [{original_url, corrected_url}]}
    // If corrected_url is empty, fallback to original_url (so file will be written but unchanged)
    const correctionsByFile = new Map();
    for (const item of corrections) {
        const file = item.file;
        const originals = item.original_links;
        const corrected = item.corrected_links;
        if (!originals || !corrected || !Array.isArray(originals) || !Array.isArray(corrected)) {
            logError(`Skipping invalid correction object for file ${file}: missing original_links or corrected_links arrays`);
            continue;
        }
        const fixes = [];
        for (let i = 0; i < originals.length; i++) {
            const original = originals[i];
            let correctedUrl = corrected[i];
            if (!original || original.trim() === '') continue;
            // If AI returned empty or undefined, fallback to original (no change)
            if (!correctedUrl || correctedUrl.trim() === '') {
                correctedUrl = original;
            }
            if (original !== correctedUrl) {
                fixes.push({ original_url: original, corrected_url: correctedUrl });
            }
        }
        // Always write the file if it was in the AI's output (even if no changes, but we only write if fixes length > 0? Actually we want to write only if something changed. The user wants to write all? The instruction: "force the ai to choose one link from our input list if it can't make a determining of the fix" – that means fallback to original, but we still only write if change occurs? I'll assume write only if at least one fix (original != corrected). That's current behavior.)
        if (fixes.length > 0) {
            correctionsByFile.set(file, fixes);
        }
    }

    if (correctionsByFile.size === 0) {
        log('No actionable corrections (no changes needed).');
        return;
    }

    log(`Will apply corrections to ${correctionsByFile.size} files.`);

    // Save corrections JSON to data/links/ instead of data/output
    const linksDir = path.join(process.cwd(), 'data', 'links');
    if (!fs.existsSync(linksDir)) fs.mkdirSync(linksDir, { recursive: true });
    const correctionsJsonPath = path.join(linksDir, 'corrections-applied.json');
    if (!dryRun) {
        fs.writeFileSync(correctionsJsonPath, JSON.stringify(corrections, null, 2), 'utf8');
        log(`Corrections JSON saved to ${correctionsJsonPath}`);
    } else {
        log(`DRY RUN: would save corrections JSON to ${correctionsJsonPath}`);
    }

    // Apply corrections
    let successCount = 0, failureCount = 0;
    for (const [fileName, fileCorrections] of correctionsByFile) {
        log(`Processing: ${fileName} (${fileCorrections.length} corrections)`);
        const result = await processFile(config, { file: fileName, corrections: fileCorrections }, dryRun);
        if (result.success) successCount++;
        else failureCount++;
    }

    logSection(`DONE — Success: ${successCount}  Failures: ${failureCount}`);
    log(`Log: ${LOG_FILE}`);
    if (!dryRun) log(`Corrected HTML files written to: ${config.paths.outputDir}`);
}

main().catch(err => {
    logError(`Unhandled error: ${err.message}`);
    process.exit(1);
});