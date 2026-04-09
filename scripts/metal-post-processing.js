#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Configuration
const config = {
  inputDir: path.resolve(__dirname, '../data/final'),
  mappingFile: path.resolve(__dirname, '../config/affiliate-map.csv'),
  imageBaseUrl: 'https://metaldetectingguide.com/images/',
  amazonAffiliateTag: '?tag=metaldetecting-20', // replace with your tag
  backupOriginal: true,
};

// Simple CSV parser (handles quoted fields, commas inside quotes)
function parseCSV(content) {
  const rows = [];
  const regex = /(?:,|^)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g;
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return rows;
  
  const headers = [];
  let match;
  let colIndex = 0;
  let lineIndex = 0;
  
  // Parse headers
  const headerLine = lines[0];
  while ((match = regex.exec(headerLine)) !== null) {
    let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
    headers.push(val || '');
  }
  rows.push(headers);
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const row = [];
    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
      row.push(val || '');
    }
    if (row.length > 0) rows.push(row);
  }
  
  // Convert to array of objects using headers
  const objects = [];
  const fieldNames = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    for (let j = 0; j < fieldNames.length; j++) {
      obj[fieldNames[j]] = rows[i][j] || '';
    }
    objects.push(obj);
  }
  return objects;
}

async function main() {
  // 1. Read and parse CSV mapping file
  let affiliateMap = new Map(); // placeholder -> url
  let imageMap = new Map();     // image_placeholder -> image_url

  try {
    const csvContent = await fs.readFile(config.mappingFile, 'utf8');
    const records = parseCSV(csvContent);
    for (const record of records) {
      if (record.placeholder && record.url) {
        affiliateMap.set(record.placeholder.trim(), record.url.trim());
      }
      if (record.image_placeholder && record.image_url) {
        imageMap.set(record.image_placeholder.trim(), record.image_url.trim());
      }
    }
    console.log(`Loaded ${affiliateMap.size} affiliate mappings and ${imageMap.size} image mappings.`);
  } catch (err) {
    console.warn(`Warning: Could not read mapping file (${config.mappingFile}):`, err.message);
    console.warn('Proceeding without replacements.');
  }

  // 2. Get all HTML files
  const files = await fs.readdir(config.inputDir);
  const htmlFiles = files.filter(f => f.endsWith('.html') && !f.endsWith('.bak'));

  if (htmlFiles.length === 0) {
    console.log('No HTML files found in', config.inputDir);
    return;
  }

  // 3. Process each file
  for (const file of htmlFiles) {
    const filePath = path.join(config.inputDir, file);
    console.log(`Processing ${file}...`);

    let content = await fs.readFile(filePath, 'utf8');

    if (config.backupOriginal) {
      const backupPath = filePath + '.bak';
      await fs.writeFile(backupPath, content, 'utf8');
      console.log(`  Backup saved to ${backupPath}`);
    }

    // Replace affiliate placeholders
    const affiliateRegex = /\[AFFILIATE:\s*([^\]]+)\]/gi;
    let modified = false;

    content = content.replace(affiliateRegex, (match, productName) => {
      const trimmed = productName.trim();
      let url = affiliateMap.get(trimmed);
      if (!url) {
        console.warn(`  Warning: No affiliate URL for "${trimmed}" in ${file}`);
        return match;
      }
      if (url.includes('amazon.') && config.amazonAffiliateTag && !url.includes('tag=')) {
        url += (url.includes('?') ? '&' : '?') + config.amazonAffiliateTag.slice(1);
      }
      modified = true;
      return url;
    });

    // Replace image placeholders
    const imageRegex = /\[IMAGE:\s*([^\]]+)\]/gi;
    content = content.replace(imageRegex, (match, filename) => {
      const trimmed = filename.trim();
      let imgUrl = imageMap.get(trimmed);
      if (!imgUrl) {
        imgUrl = config.imageBaseUrl + trimmed;
        console.warn(`  Warning: No image URL for "${trimmed}", using default: ${imgUrl}`);
      }
      modified = true;
      return imgUrl;
    });

    if (modified) {
      await fs.writeFile(filePath, content, 'utf8');
      console.log(`  Updated placeholders in ${file}`);
    } else {
      console.log(`  No placeholders found in ${file}`);
    }
  }

  console.log('Post-processing complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});