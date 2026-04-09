#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // loads automation/.env

// Load config from command line argument
const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node generate-css.js <config-file>');
  process.exit(1);
}

async function main() {
  const config = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', configPath), 'utf8'));

  // Resolve paths relative to project root (automation/)
  const projectRoot = path.resolve(__dirname, '..');
  const resolve = (p) => path.resolve(projectRoot, p);

  const promptTemplatePath = resolve(config.paths.promptTemplate);
  const logsDir = resolve(config.paths.logsDir);
  const outputCssPath = resolve(config.paths.outputCss || 'style.css');

  await fs.mkdir(logsDir, { recursive: true });

  // Load prompt template (which already includes the HTML at the end)
  const promptTemplate = await fs.readFile(promptTemplatePath, 'utf8');
  // No Handlebars needed for CSS – the prompt is static and already contains the HTML.
  const finalPrompt = promptTemplate;

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
        'HTTP-Referer': config.api?.siteUrl || 'https://metaldetectingguide.com',
        'X-Title': 'MetalDetectingGuide CSS Generator'
      },
      timeout: (config.api?.timeoutSeconds || 180) * 1000
    });
    return response.data.choices[0].message.content;
  }

  // 1. Grok first draft
  console.log('🟢 Generating Grok CSS draft...');
  const grokDraft = await callOpenRouter(
    config.agents.grok.model,
    finalPrompt,
    'You are Grok, an AI that writes clean, well-structured CSS. Output only valid CSS code, no extra text.',
    config.agents.grok.temperature,
    config.agents.grok.maxTokens
  );
  await fs.writeFile(path.join(logsDir, `css-grok-draft.css`), grokDraft, 'utf8');

  // 2. DeepSeek second draft
  console.log('🔵 Generating DeepSeek CSS draft...');
  const deepseekDraft = await callOpenRouter(
    config.agents.deepseek.model,
    finalPrompt,
    'You are DeepSeek, an AI that adds depth, alternative approaches, and detailed comments. Output only valid CSS code.',
    config.agents.deepseek.temperature,
    config.agents.deepseek.maxTokens
  );
  await fs.writeFile(path.join(logsDir, `css-deepseek-draft.css`), deepseekDraft, 'utf8');

  // 3. Claude final review – synthesize the best CSS
  console.log('🟣 Claude final review...');
  const reviewPrompt = `
You are Claude Opus, a world-class front-end CSS expert.

Below are two drafts of a CSS stylesheet (Grok and DeepSeek) for a metal detector review website. Your task:
- Compare both drafts.
- Produce a FINAL CSS stylesheet that is better than either.
- Fix any errors, improve readability, ensure responsive design, and add comments where helpful.
- Combine the best parts from each draft.
- Ensure all classes and IDs from the HTML are properly styled.
- Maintain dark/light mode support, mobile-first approach, and modern aesthetics.
- Output ONLY the final CSS code, no extra text.

--- GROK DRAFT ---
${grokDraft}

--- DEEPSEEK DRAFT ---
${deepseekDraft}
`;

  const finalCSS = await callOpenRouter(
    config.agents.claude.model,
    reviewPrompt,
    'You are Claude Opus, an expert CSS coder. Output only valid CSS code.',
    config.agents.claude.temperature,
    config.agents.claude.maxTokens
  );

  // Extract CSS from markdown code block if necessary
  let cleanedCSS = finalCSS;
  const codeBlockMatch = finalCSS.match(/```css\n([\s\S]*?)\n```/);
  if (codeBlockMatch) cleanedCSS = codeBlockMatch[1];
  else {
    const genericBlock = finalCSS.match(/```\n([\s\S]*?)\n```/);
    if (genericBlock) cleanedCSS = genericBlock[1];
  }

  await fs.writeFile(outputCssPath, cleanedCSS, 'utf8');
  console.log(`✅ Final CSS written to ${outputCssPath}`);

  // Also save Claude's raw output to logs
  await fs.writeFile(path.join(logsDir, `css-claude-final.css`), finalCSS, 'utf8');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});