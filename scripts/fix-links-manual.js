#!/usr/bin/env node
/**
 * fix-links-manual.js – Replace all broken links with a specified spotlight link.
 *
 * Usage:
 *   node scripts/fix-links-manual.js --spotlight project-hail-mary.html
 *   node scripts/fix-links-manual.js --spotlight project-hail-mary.html --dry-run
 *   node scripts/fix-links-manual.js --spotlight project-hail-mary.html --file a-little-life.html
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Default paths
const moviesDir = 'C:\\Users\\andre\\projects\\movies';
const brokenCsvPath = path.join(process.cwd(), 'data', 'links', 'broken-links.csv');
const outputDir = path.join(process.cwd(), 'data', 'output');

function log(message) {
    console.log(`[${new Date().toISOString().slice(0, 19)}] ${message}`);
}

function readBrokenLinksCsv(csvPath) {
    if (!fs.existsSync(csvPath)) return null;
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) return [];
    const parseRow = (line) => {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') inQuotes = !inQuotes;
            else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else current += ch;
        }
        result.push(current.trim());
        return result.map(v => v.replace(/^"|"$/g, ''));
    };
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseRow(lines[i]);
        if (row.length >= 5) {
            data.push({ file: row[0], link1: row[1], link2: row[2], link3: row[3] });
        }
    }
    return data;
}

function applySpotlightFix(filePath, originalLinks, spotlightPath, dryRun) {
    const html = fs.readFileSync(filePath, 'utf8');
    let $ = cheerio.load(html);
    let changed = false;
    for (const original of originalLinks) {
        if (!original || original.trim() === '') continue;
        $(`a[href="${original.replace(/"/g, '\\"')}"]`).each((i, el) => {
            $(el).attr('href', spotlightPath);
            log(`   Fixed: ${original} -> ${spotlightPath}`);
            changed = true;
        });
    }
    if (dryRun) return null;
    if (changed) return $.html();
    return null;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const fileArgIdx = args.indexOf('--file');
    const specificFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;
    const spotlightArgIdx = args.indexOf('--spotlight');
    if (spotlightArgIdx === -1 || !args[spotlightArgIdx + 1]) {
        console.error('Usage: node fix-links-manual.js --spotlight <filename> [--dry-run] [--file <filename>]');
        process.exit(1);
    }
    let spotlightFile = args[spotlightArgIdx + 1];
    if (!spotlightFile.endsWith('.html')) spotlightFile += '.html';
    const spotlightPath = '/' + spotlightFile;

    log(`Manual fix with spotlight: ${spotlightPath}`);
    const brokenData = readBrokenLinksCsv(brokenCsvPath);
    if (!brokenData || brokenData.length === 0) {
        log('No broken links found. Exiting.');
        return;
    }
    log(`Loaded ${brokenData.length} files with broken links.`);

    let filteredData = brokenData;
    if (specificFile) {
        filteredData = brokenData.filter(row => row.file === specificFile);
        if (filteredData.length === 0) {
            log(`No broken links for file: ${specificFile}`);
            return;
        }
        log(`Filtered to: ${specificFile}`);
    }

    if (!dryRun && !fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    let writtenCount = 0;
    for (const row of filteredData) {
        const fileName = row.file;
        const originalLinks = [row.link1, row.link2, row.link3].filter(l => l && l.trim() !== '');
        if (originalLinks.length === 0) continue;
        const filePath = path.join(moviesDir, fileName);
        if (!fs.existsSync(filePath)) {
            log(`File not found: ${fileName}`);
            continue;
        }
        const correctedHtml = applySpotlightFix(filePath, originalLinks, spotlightPath, dryRun);
        if (dryRun) {
            log(`DRY RUN: would update ${fileName} (${originalLinks.length} links -> ${spotlightPath})`);
            writtenCount++;
        } else if (correctedHtml) {
            const outPath = path.join(outputDir, fileName);
            fs.writeFileSync(outPath, correctedHtml, 'utf8');
            log(`✓ Saved: ${outPath}`);
            writtenCount++;
        }
    }
    log(`Done. ${writtenCount} files processed.`);
}

main().catch(err => console.error(err));