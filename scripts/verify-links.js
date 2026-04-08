#!/usr/bin/env node
/**
 * verify-links.js – Compare original and corrected HTML files, report only link changes.
 *
 * Reads original files from config.paths.moviesDir, corrected files from config.paths.outputDir.
 * Outputs CSV with columns: file, original_link, fixed_link (only where links differ).
 * Also warns if any non‑link content has changed.
 *
 * Usage:
 *   node scripts/verify-links.js
 *   node scripts/verify-links.js --output custom-report.csv
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Default paths (can be overridden by command line)
const DEFAULT_MOVIES_DIR = 'C:\\Users\\andre\\projects\\movies';
const DEFAULT_OUTPUT_DIR = 'C:\\Users\\andre\\projects\\automation\\data\\output';
const DEFAULT_REPORT_CSV = 'C:\\Users\\andre\\projects\\automation\\data\\links\\link-verification.csv';

// Parse command line args
const args = process.argv.slice(2);
let outputCsv = DEFAULT_REPORT_CSV;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i+1]) {
        outputCsv = args[i+1];
        i++;
    }
}

// Ensure output directory exists
const outputDirPath = path.dirname(outputCsv);
if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true });
}

// Get list of HTML files in output directory
function getHtmlFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.html'));
}

// Compare two HTML strings and return link differences
function compareLinks(originalHtml, correctedHtml, fileName) {
    const $orig = cheerio.load(originalHtml);
    const $fixed = cheerio.load(correctedHtml);
    const differences = [];

    // Collect all hrefs from original
    const origLinks = [];
    $orig('a').each((i, el) => {
        const href = $orig(el).attr('href');
        if (href) origLinks.push(href);
    });

    // Collect all hrefs from corrected
    const fixedLinks = [];
    $fixed('a').each((i, el) => {
        const href = $fixed(el).attr('href');
        if (href) fixedLinks.push(href);
    });

    // Compare link by link (assuming same order)
    const maxLen = Math.max(origLinks.length, fixedLinks.length);
    for (let i = 0; i < maxLen; i++) {
        const orig = origLinks[i] || '';
        const fixed = fixedLinks[i] || '';
        if (orig !== fixed) {
            differences.push({
                file: fileName,
                original_link: orig,
                fixed_link: fixed
            });
        }
    }

    return differences;
}

// Check for any non‑link content changes (simple text compare)
function hasNonLinkChanges(originalHtml, correctedHtml) {
    const $orig = cheerio.load(originalHtml);
    const $fixed = cheerio.load(correctedHtml);
    // Remove all <a> tags and compare the rest
    $orig('a').remove();
    $fixed('a').remove();
    const origText = $orig.html();
    const fixedText = $fixed.html();
    return origText !== fixedText;
}

async function main() {
    console.log(`Verifying links between:`);
    console.log(`  Original: ${DEFAULT_MOVIES_DIR}`);
    console.log(`  Corrected: ${DEFAULT_OUTPUT_DIR}`);
    console.log(`  Report: ${outputCsv}\n`);

    const outputFiles = getHtmlFiles(DEFAULT_OUTPUT_DIR);
    if (outputFiles.length === 0) {
        console.error('No HTML files found in output directory. Run fix-links.js first.');
        process.exit(1);
    }

    const allDifferences = [];
    let filesWithNonLinkChanges = 0;

    for (const file of outputFiles) {
        const origPath = path.join(DEFAULT_MOVIES_DIR, file);
        const fixedPath = path.join(DEFAULT_OUTPUT_DIR, file);

        if (!fs.existsSync(origPath)) {
            console.warn(`Original file missing: ${file} – skipping`);
            continue;
        }

        const originalHtml = fs.readFileSync(origPath, 'utf8');
        const correctedHtml = fs.readFileSync(fixedPath, 'utf8');

        // Check for unintended non‑link changes
        if (hasNonLinkChanges(originalHtml, correctedHtml)) {
            console.warn(`⚠️  Non‑link content changed in ${file} – review manually`);
            filesWithNonLinkChanges++;
        }

        const diffs = compareLinks(originalHtml, correctedHtml, file);
        allDifferences.push(...diffs);
    }

    // Write CSV report
    const header = '"file","original_link","fixed_link"';
    const rows = allDifferences.map(d => 
        `"${d.file}","${d.original_link.replace(/"/g, '""')}","${d.fixed_link.replace(/"/g, '""')}"`
    );
    const csvContent = [header, ...rows].join('\n');
    fs.writeFileSync(outputCsv, csvContent, 'utf8');

    console.log(`\n✅ Verification complete.`);
    console.log(`   Total link differences: ${allDifferences.length}`);
    console.log(`   Files with non‑link changes: ${filesWithNonLinkChanges}`);
    console.log(`   Report saved to: ${outputCsv}`);

    if (allDifferences.length === 0) {
        console.log(`\n🎉 No link differences found – the fix applied correctly.`);
    } else {
        console.log(`\n📝 Found ${allDifferences.length} link changes. Review CSV above.`);
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});