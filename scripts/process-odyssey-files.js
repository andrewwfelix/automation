// process-odyssey-files.js
// Loads OPENROUTER_API_KEY from config/.env
// Supports OpenAI or OpenRouter (set ai.provider in config)

const fs = require('fs');
const path = require('path');

// ========== DETERMINE AUTOMATION ROOT ==========
const automationRoot = path.resolve(__dirname, '..');

// ========== LOAD .env FROM config/ FOLDER ==========
const envPath = path.join(automationRoot, 'config', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (key && value) {
        process.env[key] = value;
      }
    }
  }
  console.log(`Loaded .env from ${envPath}`);
}

// ========== PATHS ==========
const CONFIG_PATH = path.join(automationRoot, 'config', 'process-odyssey-files.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config file not found: ${CONFIG_PATH}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const INPUT_DIR = path.join(automationRoot, config.paths.inputDir || 'data/input');
const OUTPUT_DIR = path.join(automationRoot, config.paths.outputDir || 'data/output');
const PROMPT_FILE = path.join(automationRoot, config.paths.promptFile || 'prompts/fix-odyssey-seo.txt');

// AI settings
const USE_AI = config.ai?.enabled || false;
const AI_PROVIDER = config.ai?.provider || 'openai';
const AI_MODEL = config.ai?.model || (AI_PROVIDER === 'openrouter' ? 'openai/gpt-4-turbo' : 'gpt-4-turbo');
const AI_TEMP = config.ai?.temperature || 0.2;

// API keys from .env (already in process.env)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// ========== HELPERS ==========
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

function getInputFiles() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.log(`Input directory not found: ${INPUT_DIR}`);
    return [];
  }
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.astro'));
  const skip = config.skipFiles || [];
  return files.filter(f => !skip.includes(f));
}

async function callAI(promptContent, fileContent, filename) {
  const systemPrompt = `You are an expert in Astro and SEO. Apply the fixes exactly as described in the prompt below. Output ONLY the corrected .astro file content, no explanations.`;
  const userPrompt = `${promptContent}\n\nHere is the file to fix (filename: ${filename}):\n\n${fileContent}`;

  let apiKey, apiUrl, model;

  if (AI_PROVIDER === 'openrouter') {
    apiKey = OPENROUTER_API_KEY;
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    model = AI_MODEL;
    if (!apiKey) throw new Error('OpenRouter API key not found in config/.env (OPENROUTER_API_KEY)');
  } else {
    apiKey = OPENAI_API_KEY;
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    model = AI_MODEL;
    if (!apiKey) throw new Error('OpenAI API key not found in config/.env (OPENAI_API_KEY)');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: AI_TEMP,
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function runAutoProcessing(files, promptContent) {
  console.log(`\n=== Auto-processing ${files.length} files with ${AI_PROVIDER} (${AI_MODEL}) ===`);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`[${i+1}/${files.length}] Processing ${file}...`);
    const inputPath = path.join(INPUT_DIR, file);
    const fileContent = fs.readFileSync(inputPath, 'utf8');
    try {
      const corrected = await callAI(promptContent, fileContent, file);
      const outputPath = path.join(OUTPUT_DIR, file);
      fs.writeFileSync(outputPath, corrected);
      console.log(`   Saved to ${outputPath}`);
    } catch (err) {
      console.error(`   ERROR on ${file}: ${err.message}`);
    }
  }
  console.log('\nAuto-processing complete.');
}

function printManualInstructions(files) {
  console.log('\n========== MANUAL PROCESSING INSTRUCTIONS ==========');
  console.log(`1. Input files are in: ${INPUT_DIR}`);
  console.log(`2. Prompt file: ${PROMPT_FILE}`);
  console.log(`3. For each .astro file, feed it to an AI with the prompt.`);
  console.log(`4. Save output to ${OUTPUT_DIR} using the same filename.\n`);
  console.log('Files to process:');
  files.forEach(f => console.log(`   - ${f}`));
  console.log('====================================================\n');
}

// ========== MAIN ==========
async function main() {
  console.log('=== Odyssey SEO Fix Script ===\n');

  if (!fs.existsSync(PROMPT_FILE)) {
    console.error(`ERROR: Prompt file not found at ${PROMPT_FILE}`);
    process.exit(1);
  }
  const promptContent = fs.readFileSync(PROMPT_FILE, 'utf8');
  console.log(`Loaded prompt from ${PROMPT_FILE}`);

  ensureDir(OUTPUT_DIR);

  const files = getInputFiles();
  if (files.length === 0) {
    console.log(`No .astro files found in ${INPUT_DIR}.`);
    return;
  }
  console.log(`Found ${files.length} file(s).`);

  if (USE_AI) {
    let hasKey = false;
    if (AI_PROVIDER === 'openrouter' && OPENROUTER_API_KEY) hasKey = true;
    if (AI_PROVIDER === 'openai' && OPENAI_API_KEY) hasKey = true;

    if (hasKey) {
      await runAutoProcessing(files, promptContent);
    } else {
      console.warn(`WARNING: AI enabled but ${AI_PROVIDER} API key not found in config/.env. Falling back to manual mode.`);
      printManualInstructions(files);
    }
  } else {
    printManualInstructions(files);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});