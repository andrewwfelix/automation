// check-broken-links.js
// Run from: C:\Users\andre\projects\automation
// Usage: node scripts/check-broken-links.js

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const moviesDir = 'C:\\Users\\andre\\projects\\movies';
const outputDir = 'C:\\Users\\andre\\projects\\automation\\data\\links';
const outputCsv = path.join(outputDir, 'broken-links.csv');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Navigation links to ignore
const ignoreUrls = new Set([
    '/',
    '/index.html',
    '/index_alt.html',
    '/about.html',
    '/about',
]);

function getAllHtmlFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            getAllHtmlFiles(fullPath, fileList);
        } else if (file.endsWith('.html')) {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function extractInternalLinks(filePath, n, allHtmlFilenamesSet) {
    const html = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(html);
    const links = [];
    
    $('a').each((i, el) => {
        if (links.length >= n) return false;
        let href = $(el).attr('href');
        if (!href || href.trim() === '') return;
        href = href.trim();
        
        if (ignoreUrls.has(href)) return;
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) return;
        if (href.startsWith('#')) return;
        if (href.startsWith('javascript:')) return;
        
        let cleanHref = href;
        if (cleanHref.startsWith('/')) {
            cleanHref = cleanHref.substring(1);
        }
        cleanHref = cleanHref.split('?')[0].split('#')[0];
        if (!cleanHref.endsWith('.html')) {
            cleanHref = cleanHref + '.html';
        }
        const targetFile = path.basename(cleanHref);
        
        links.push({
            original: href,
            target: targetFile,
        });
    });
    
    return links;
}

function main() {
    console.log(`Scanning HTML files in: ${moviesDir}`);
    const htmlFiles = getAllHtmlFiles(moviesDir);
    if (htmlFiles.length === 0) {
        console.error('No HTML files found. Check path.');
        process.exit(1);
    }
    console.log(`Found ${htmlFiles.length} HTML files.`);
    
    const allHtmlFilenames = new Set(htmlFiles.map(f => path.basename(f)));
    
    const rows = [];
    rows.push('"file name","link1","link2","link3","status"');
    let brokenCount = 0;
    
    for (const file of htmlFiles) {
        const fileName = path.basename(file);
        const links = extractInternalLinks(file, 3, allHtmlFilenames);
        
        const link1 = links[0] ? links[0].original : '';
        const link2 = links[1] ? links[1].original : '';
        const link3 = links[2] ? links[2].original : '';
        
        let hasBroken = false;
        for (let i = 0; i < links.length; i++) {
            const target = links[i].target;
            if (!allHtmlFilenames.has(target)) {
                hasBroken = true;
                break;
            }
        }
        
        if (hasBroken) {
            brokenCount++;
            const escape = (s) => `"${s.replace(/"/g, '""')}"`;
            rows.push(`${escape(fileName)},${escape(link1)},${escape(link2)},${escape(link3)},"broken links"`);
        }
    }
    
    fs.writeFileSync(outputCsv, rows.join('\n'), 'utf8');
    console.log(`Found ${brokenCount} files with broken links.`);
    console.log(`Report saved to: ${outputCsv}`);
}

main();