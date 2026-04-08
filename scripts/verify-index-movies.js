#!/usr/bin/env node
/**
 * verify-index-movies.js – Check that all movie links in index.html point to existing .html files.
 *
 * Assumes index.html is in the movies directory (C:\Users\andre\projects\movies\index.html) by default.
 *
 * Usage:
 *   node scripts/verify-index-movies.js
 *   node scripts/verify-index-movies.js --index index_alt.html
 *   node scripts/verify-index-movies.js --output missing-movies.csv
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Default paths
const MOVIES_DIR = 'C:\\Users\\andre\\projects\\movies';
const DEFAULT_INDEX = 'index.html';  // inside movies directory
const DEFAULT_OUTPUT_CSV = path.join(process.cwd(), 'data', 'links', 'missing-index-movies.csv');

// Parse command line args
const args = process.argv.slice(2);
let indexFile = DEFAULT_INDEX;
let outputCsv = DEFAULT_OUTPUT_CSV;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--index' && args[i+1]) {
        indexFile = args[i+1];
        i++;
    } else if (args[i] === '--output' && args[i+1]) {
        outputCsv = args[i+1];
        i++;
    }
}

// Index is inside movies directory
const indexFullPath = path.join(MOVIES_DIR, indexFile);
if (!fs.existsSync(indexFullPath)) {
    console.error(`Index file not found: ${indexFullPath}`);
    process.exit(1);
}

console.log(`Reading index: ${indexFullPath}`);
console.log(`Movies directory: ${MOVIES_DIR}`);
console.log(`Output report: ${outputCsv}\n`);

// Get list of all .html files in movies directory
const existingFiles = new Set();
if (fs.existsSync(MOVIES_DIR)) {
    fs.readdirSync(MOVIES_DIR).forEach(f => {
        if (f.endsWith('.html')) existingFiles.add(f);
    });
}
console.log(`Found ${existingFiles.size} existing .html files.`);

// Parse index.html
const html = fs.readFileSync(indexFullPath, 'utf8');
const $ = cheerio.load(html);

// Extract all hrefs that look like movie pages (e.g., "project-hail-mary.html" or "/project-hail-mary.html")
const movieLinks = new Set();
$('a').each((i, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    href = href.trim();
    // Remove leading slash if present
    if (href.startsWith('/')) href = href.slice(1);
    // Only consider .html links that are not obvious navigation
    if (href.endsWith('.html') && !href.startsWith('index') && !href.startsWith('about')) {
        movieLinks.add(href);
    }
});

console.log(`Found ${movieLinks.size} unique movie links in index.\n`);

// Check which are missing
const missing = [];
for (const link of movieLinks) {
    if (!existingFiles.has(link)) {
        missing.push(link);
    }
}

// Write CSV report
const header = '"missing_file"';
const rows = missing.map(f => `"${f.replace(/"/g, '""')}"`);
const csvContent = [header, ...rows].join('\n');

// Ensure output directory exists
const outDir = path.dirname(outputCsv);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputCsv, csvContent, 'utf8');

// Print summary
if (missing.length === 0) {
    console.log('✅ All movies linked from index.html have corresponding files in movies directory.');
} else {
    console.log(`❌ ${missing.length} missing movie file(s):`);
    missing.forEach(f => console.log(`   - ${f}`));
    console.log(`\nReport saved to: ${outputCsv}`);
}