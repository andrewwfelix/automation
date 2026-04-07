#!/usr/bin/env node
/**
 * check-structure.js
 * Scans all .html files in ./input/ and reports which need
 * SEO restructuring vs which are already on the current template.
 *
 * Usage:
 *   node check-structure.js
 *   node check-structure.js --input path/to/folder
 */

const fs   = require('fs');
const path = require('path');

const args     = process.argv.slice(2);
const inputArg = args.indexOf('--input');
const scriptDir = path.dirname(path.resolve(process.argv[1]));
const inputDir  = inputArg !== -1
  ? path.resolve(args[inputArg + 1])
  : path.join(scriptDir, 'input');

if (!fs.existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.html'));
if (files.length === 0) {
  console.log('No .html files found.');
  process.exit(0);
}

// These three together = current template
const REQUIRED = [
  { label: 'panel-book',   pattern: /class="panel-book"/  },
  { label: 'meta-strip',   pattern: /class="meta-strip"/  },
  { label: 'difference',   pattern: /class="difference"/  },
];

// These are the two things the light pass adds
const LIGHT_FIXES = [
  { label: 'spoiler-warning', pattern: /class="spoiler-warning"/ },
  { label: 'affiliate-btn',   pattern: /Buy the Book \(affiliate\)/ },
];

const needsRestructure = [];
const needsLightPass   = [];
const alreadyDone      = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(inputDir, file), 'utf8');

  const onTemplate = REQUIRED.every(r => r.pattern.test(content));
  const spoilerOk  = LIGHT_FIXES[0].pattern.test(content);
  const affiliateOk = LIGHT_FIXES[1].pattern.test(content);

  if (!onTemplate) {
    needsRestructure.push(file);
  } else if (!spoilerOk || !affiliateOk) {
    needsLightPass.push({ file, spoilerOk, affiliateOk });
  } else {
    alreadyDone.push(file);
  }
}

const W = 50;
console.log('\n' + '═'.repeat(W));
console.log(' STRUCTURE REPORT');
console.log('═'.repeat(W));

if (needsRestructure.length > 0) {
  console.log(`\n❌ NEEDS SEO RESTRUCTURE (${needsRestructure.length} files)`);
  console.log('   Run with: revise-prompt-seo-restructure.txt + claude-3-5-haiku');
  needsRestructure.forEach(f => console.log(`   • ${f}`));
}

if (needsLightPass.length > 0) {
  console.log(`\n⚠️  NEEDS LIGHT PASS ONLY (${needsLightPass.length} files)`);
  console.log('   Run with: revise-page-prompt.txt + claude-3-haiku');
  needsLightPass.forEach(({ file, spoilerOk, affiliateOk }) => {
    const missing = [
      !spoilerOk   ? 'spoiler-warning' : null,
      !affiliateOk ? 'affiliate-btn'   : null,
    ].filter(Boolean).join(', ');
    console.log(`   • ${file}  [missing: ${missing}]`);
  });
}

if (alreadyDone.length > 0) {
  console.log(`\n✓  ALREADY COMPLETE (${alreadyDone.length} files)`);
  console.log('   No action needed');
  alreadyDone.forEach(f => console.log(`   • ${f}`));
}

console.log('\n' + '─'.repeat(W));
console.log(` Total: ${files.length} files`);
console.log(`   Needs restructure : ${needsRestructure.length}`);
console.log(`   Needs light pass  : ${needsLightPass.length}`);
console.log(`   Already done      : ${alreadyDone.length}`);
console.log('─'.repeat(W) + '\n');
