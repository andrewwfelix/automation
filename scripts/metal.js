#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const Handlebars = require('handlebars');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // loads automation/.env

// Load config from command line argument
const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node generate-multi-agent.js <config-file>');
  process.exit(1);
}

async function main() {
  const config = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', configPath), 'utf8'));

  // Resolve paths relative to project root (automation/)
  const projectRoot = path.resolve(__dirname, '..');
  const resolve = (p) => path.resolve(projectRoot, p);

  const promptTemplatePath = resolve(config.paths.promptTemplate);
  const stagedDir = resolve(config.paths.stagedDir);
  const finalDir = resolve(config.paths.finalDir);
  const logsDir = resolve(config.paths.logsDir);

  await fs.mkdir(stagedDir, { recursive: true });
  await fs.mkdir(finalDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  // Load and compile prompt template
  const templateContent = await fs.readFile(promptTemplatePath, 'utf8');
  const compiledTemplate = Handlebars.compile(templateContent);
  const pageVars = { ...config.page };
  const finalPrompt = compiledTemplate(pageVars);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY in .env');

  // Helper: call OpenRouter
  async function callOpenRouter(model, prompt, systemRole, temperature, maxTokens) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: systemRole },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: temperature
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.api.siteUrl,
        'X-Title': 'MetalDetectingGuide Generator'
      },
      timeout: config.api.timeoutSeconds * 1000
    });
    return response.data.choices[0].message.content;
  }

  // 1. Grok first draft
  console.log('🟢 Generating Grok draft...');
  const grokDraft = await callOpenRouter(
    config.agents.grok.model,
    finalPrompt,
    'You are Grok, an AI that writes clear, well-structured first drafts. Output only valid HTML fragment.',
    config.agents.grok.temperature,
    config.agents.grok.maxTokens
  );
  await fs.writeFile(path.join(stagedDir, `${config.page.slug}-grok.html`), grokDraft, 'utf8');

  // 2. DeepSeek second draft (independent)
  console.log('🔵 Generating DeepSeek draft...');
  const deepseekDraft = await callOpenRouter(
    config.agents.deepseek.model,
    finalPrompt,
    'You are DeepSeek, an AI that adds depth, detail, and alternative phrasing. Output only valid HTML fragment.',
    config.agents.deepseek.temperature,
    config.agents.deepseek.maxTokens
  );
  await fs.writeFile(path.join(stagedDir, `${config.page.slug}-deepseek.html`), deepseekDraft, 'utf8');

  // 3. Claude final review – synthesize and polish
  console.log('🟣 Claude final review...');
  const reviewPrompt = `
You are Claude Opus, a world-class editor and HTML expert.

Below are two drafts of a metal detector buying guide (Grok and DeepSeek). Your task:
- Compare both drafts.
- Produce a FINAL HTML fragment that is better than either.
- Fix any factual errors (e.g., product specs), improve readability, ensure proper HTML structure.
- Keep the same product count (${config.page.numProducts}) and include all required sections (buying guide, comparison table).
- Preserve all affiliate link placeholders exactly as [AFFILIATE: product-name] – do not convert them to real links.
- Preserve image placeholders exactly as [IMAGE: filename.jpg].
- Output ONLY the final HTML, no extra text.

--- GROK DRAFT ---
${grokDraft}

--- DEEPSEEK DRAFT ---
${deepseekDraft}
`;

  const finalHTML = await callOpenRouter(
    config.agents.claude.model,
    reviewPrompt,
    'You are Claude Opus, an expert editor and HTML coder. Output only valid HTML.',
    config.agents.claude.temperature,
    config.agents.claude.maxTokens
  );

  const finalPath = path.join(finalDir, `${config.page.slug}.html`);
  await fs.writeFile(finalPath, finalHTML, 'utf8');
  console.log(`✅ Final page written to ${finalPath}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});