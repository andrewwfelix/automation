\# DeepSeek – Practical Advice



\## 1. Business Advice (Revenue, SEO, Growth)



\*\*SEO leverage\*\*  

\- DeepSeek’s low cost allows generating \*\*meta descriptions for 175 pages for under $0.05\*\* – test multiple variants per page to find highest CTR.  

\- Use it to rewrite internal link anchor text for better keyword targeting (e.g., “best romance adaptations” instead of “click here”).  

\- Generate FAQ schema questions that match actual search queries (it’s good at inferring what people ask).



\*\*Backlink opportunities\*\*  

\- Ask DeepSeek to create “ultimate guides” or “comparison tables” that other sites want to link to – e.g., “All 175 book vs film comparisons, ranked by faithfulness”.  

\- Use it to draft outreach emails to bloggers who link to similar content (personalized at scale).



\*\*Audience growth\*\*  

\- Generate social snippets (Twitter, Reddit titles) for each comparison – cheap enough to A/B test.  

\- Create “which should you read/watch first” quizzes based on its analysis of the differences.  

\- Produce topic clusters (e.g., “best crime thrillers adapted to film”) by having DeepSeek group your existing pages.



\*\*Monetization\*\*  

\- It does not refuse affiliate links, so you can ask it to naturally weave Amazon links into “Should you read first” paragraphs (e.g., “Grab the book here”).  

\- Use it to write compelling call‑to‑action buttons for your affiliate offers.



\*\*Competitive edge\*\*  

\- Batch‑generate “gold standard” upgrades for 175 pages at \~$0.20 total – competitors using manual editing or expensive models cannot match that scale.



\## 2. Technical Advice (Prompts, API, Code)



\*\*Prompting best practices\*\*  

\- Use imperative, short prompts.  

\- Explicitly request “Output only valid JSON” or “Output only plain text”.  

\- Optional system message: “You are a structured data generator. Output only JSON.”



\*\*Temperature\*\*: 0.3 (balanced).



\*\*Affiliate links\*\*: No refusal – send HTML with `amzn.to` directly.



\*\*Token efficiency\*\*: Granular JSON uses \~1/5 tokens of full HTML.



\*\*Integration pattern\*\*: JSON → cheerio injection.



\*\*Known issues\*\*: May add trailing commas in JSON or wrap in ` ```json `. Strip fences with regex.



\## 3. Model Specs (quick reference)



| Property | Value |

|----------|-------|

| Full name | `deepseek/deepseek-chat` |

| Context | 128k tokens |

| Cost | $0.14 / $0.28 per 1M |

| Speed | 2–4s per request |

| Best for | SEO content generation, bulk meta descriptions, JSON output |


Note: Splitting HTML Content for LLM Processing – A Granular Architecture
The Problem
Asking an LLM to process, understand, and regenerate a complete HTML file (10k+ tokens) is brittle and error‑prone:

Refusals – Models often reject tasks that involve affiliate links, complex structure, or ambiguous instructions.

Hallucinations – LLMs may drop tags, change classes, or insert malformed HTML.

Token waste – Full HTML output is expensive and often truncated.

Conversational drift – Long, conditional prompts trigger clarifying questions instead of direct output.

The Solution: Split Content from Structure
Let the LLM only generate content (as JSON or simple markdown). A deterministic script merges that content into a reliable HTML template or existing page.

This separates concerns:

LLM – Understands the book/film, compares them, writes specific, opinionated prose.

Script – Handles HTML structure, CSS classes, affiliate links, schema, and SEO tags.

High‑Level Architecture
text
Original HTML (optional, for context)
        │
        ▼
[Extract] – Read existing content to inform LLM (but not required)
        │
        ▼
[LLM Prompts] – One small prompt per section → returns structured data
   ├─► Meta description (string)
   ├─► Cast table (array of objects)
   ├─► Key differences (array of {heading, paragraphs})
   ├─► FAQ (array of {question, answer})
   ├─► Verdict (string)
   └─► Reading order (array of {title, year, description})
        │
        ▼
[Merge Script] – Use a DOM parser (cheerio) to inject each section into a template or existing HTML
        │
        ▼
Final HTML – Fully styled, valid, with all affiliate links and structure preserved.
Why This Works
Concern	How Splitting Solves It
LLM refuses to output HTML	LLM never sees HTML tags – only pure data.
Affiliate links cause rejection	Links remain in the template; LLM never processes them.
Token limits truncate output	Each LLM response is tiny (200‑2000 tokens).
HTML structure gets corrupted	Script uses a DOM parser; LLM cannot break tags.
Expensive full‑page regeneration	Cost drops by 5‑10x (e.g., ~$0.016 per file vs $0.16).
Conditional instructions cause questions	Prompts are simple, imperative, and short.
Inconsistent CSS classes	Script applies classes deterministically.
Implementation Steps
1. Create a Reliable HTML Template (or Use Existing Page)
If starting from scratch, build a template with placeholder comments or IDs:

html
<!DOCTYPE html>
<html>
<head>
  <meta name="description" content="{{META_DESCRIPTION}}">
  <!-- other meta, schema, CSS -->
</head>
<body>
  <div class="body-text">
    <div class="spoiler-warning">{{SPOILER_WARNING}}</div>
    <h2>Story in Brief</h2>
    <p>{{STORY_BRIEF}}</p>
    <h2>Cast & Characters</h2>
    <div id="cast-container"></div>
    <h2>Key Differences</h2>
    <div id="differences-container"></div>
    ...
  </div>
</body>
</html>
Better yet, use your existing page as the template – the script will replace only the targeted sections, leaving everything else untouched.

2. Write Section‑Specific LLM Prompts (JSON Output)
Example: Cast table prompt

text
You are a book vs film critic. Based on the original HTML below, generate a JSON array for the cast table.

Include 3-5 principal characters. Each object must have:
- character (string)
- actor (string, or "N/A" if none)
- book_desc (one sentence on book portrayal)
- film_desc (one sentence on film portrayal)

Output ONLY valid JSON. No explanations.

Original HTML:
[PASTE ORIGINAL HTML HERE]
Example output:

json
[
  {
    "character": "Chris McCandless",
    "actor": "Emile Hirsch",
    "book_desc": "Krakauer builds a complex, intellectual portrait based on journals and interviews.",
    "film_desc": "Hirsch plays him as more impulsive and romantically naive, with added fictional scenes."
  }
]
3. Write a Node.js Script Using Cheerio
javascript
const cheerio = require('cheerio');
const fs = require('fs');

function updateCastTable(html, castData) {
  const $ = cheerio.load(html);
  
  // Build new table HTML
  let tableHtml = `<table class="char-table"><thead><tr><th>Character</th><th>In the Book</th><th>In the Film</th></tr></thead><tbody>`;
  for (const c of castData) {
    tableHtml += `<tr>
      <td><span class="char-name">${c.character}</span><br><span class="char-actor">${c.actor}</span></td>
      <td>${c.book_desc}</td>
      <td>${c.film_desc}</td>
    </tr>`;
  }
  tableHtml += `</tbody></table>`;
  
  // Replace existing .char-table or insert after "Story in Brief"
  if ($('.char-table').length) {
    $('.char-table').replaceWith(tableHtml);
  } else {
    $('.body-text h2:contains("Story in Brief")').after(tableHtml);
  }
  
  return $.html();
}
4. Run Prompts in Parallel (or Sequentially)
javascript
async function updateAllSections(originalHtml) {
  const [metaDesc, castData, diffs, faq, verdict] = await Promise.all([
    callLLM('meta-prompt.txt', originalHtml),
    callLLM('cast-prompt.txt', originalHtml),
    callLLM('differences-prompt.txt', originalHtml),
    callLLM('faq-prompt.txt', originalHtml),
    callLLM('verdict-prompt.txt', originalHtml)
  ]);
  
  let html = originalHtml;
  html = updateMetaDescription(html, metaDesc);
  html = updateCastTable(html, JSON.parse(castData));
  html = updateDifferences(html, JSON.parse(diffs));
  // ...
  return html;
}
Handling Existing Pages vs. Templates
If you have a live HTML page (like into-the-wild.html), use it as the base. The script will replace only the targeted sections (e.g., .char-table, .difference, .faq-list). All other content (hero, comparison panel, footer) stays exactly as is.

If you need to create pages from scratch, use a minimal template and inject all content.

What About the “Related Cards” Section?
As you noted, that section is best handled by a separate, cheap script that validates slugs and rewrites the grid – no LLM needed. It can run after the content generation.

Downsides and Mitigations
Downside	Mitigation
More moving parts	Simple, well‑tested Node script; each section is independent.
LLM may still refuse JSON prompts	Use a system message: “You are a JSON generator. Output only valid JSON.”
Context needed for good answers	Include the original HTML (or a summary) in each prompt.
Latency from multiple calls	Run them in parallel – total time equals longest single call (~5 sec).
Conclusion
Splitting the file so the LLM never touches HTML is the reliable, cost‑effective, and scalable way to generate or update book‑vs‑film comparison pages. The LLM focuses on what it does best – writing specific, opinionated prose – while deterministic scripts handle structure, SEO, and affiliate links.

Next steps: Implement a proof‑of‑concept for one page using the cast table update. Once verified, expand to all sections.

Would you like me to provide the complete Node script with all sections implemented?
