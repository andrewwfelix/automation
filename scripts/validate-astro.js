// automation/validate-astro.js
const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '../data/output');

// Read all files in the directory
let files;
try {
  files = fs.readdirSync(targetDir);
} catch (err) {
  console.error(`❌ Cannot read directory: ${targetDir}`);
  process.exit(1);
}

// Filter for .astro files
const astroFiles = files.filter(file => file.endsWith('.astro'));

if (astroFiles.length === 0) {
  console.warn(`⚠️ No .astro files found in ${targetDir}`);
  process.exit(0);
}

let hasErrors = false;

astroFiles.forEach(file => {
  const filePath = path.join(targetDir, file);
  const raw = fs.readFileSync(filePath, 'utf8');
  
  // Strip frontmatter (between first two --- lines)
  let content = raw;
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    content = raw.slice(frontmatterMatch[0].length);
  }

  // Temporarily replace Astro expressions {...} to avoid false positives
  const expressions = [];
  content = content.replace(/\{[^{}]*\}/g, (match) => {
    expressions.push(match);
    return `__EXPR_${expressions.length-1}__`;
  });

  let fileError = false;

  // 1. Self-closing script tags (forbidden)
  if (/<script[^>]*\/\s*>/.test(content)) {
    console.error(`❌ ${file}: Self-closing <script /> tag found.`);
    fileError = true;
  }

  // 2. set:html on script tags (forbidden)
  if (/<script[^>]*set:html[^>]*>/.test(content)) {
    console.error(`❌ ${file}: set:html used on <script> tag.`);
    fileError = true;
  }

  // 3. Mismatched script tags
  const openCount = (content.match(/<script[^>]*>/g) || []).length;
  const closeCount = (content.match(/<\/script>/g) || []).length;
  if (openCount !== closeCount) {
    console.error(`❌ ${file}: Mismatched script tags (${openCount} open, ${closeCount} close).`);
    fileError = true;
  }

  // 4. H1 count
  const h1Count = (content.match(/<h1\b/g) || []).length;
  if (h1Count !== 1) {
    console.warn(`⚠️ ${file}: Expected 1 <h1>, found ${h1Count}.`);
  }

  // 5. JSON-LD presence
  if (!/<script\s+type="application\/ld\+json">/.test(content)) {
    console.warn(`⚠️ ${file}: No JSON-LD script found.`);
  }

  if (fileError) hasErrors = true;
});

if (hasErrors) {
  console.error('\n❌ Validation failed. Fix errors above.');
  process.exit(1);
} else {
  console.log('✅ All .astro files in data/output passed validation.');
  process.exit(0);
}