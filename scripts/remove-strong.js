// automation/scripts/remove-strong.js
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

let modifiedCount = 0;

astroFiles.forEach(file => {
  const filePath = path.join(targetDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Remove opening <strong> tags (with or without attributes) and closing </strong> tags
  const newContent = content.replace(/<strong\b[^>]*>/gi, '').replace(/<\/strong>/gi, '');

  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ Removed <strong> tags from ${file}`);
    modifiedCount++;
  }
});

if (modifiedCount === 0) {
  console.log('ℹ️ No <strong> tags found in any .astro file.');
} else {
  console.log(`\n✅ Done. Removed <strong> tags from ${modifiedCount} file(s).`);
}