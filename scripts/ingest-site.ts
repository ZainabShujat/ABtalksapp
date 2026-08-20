import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, 'knowledge', 'generated');
const SITE_BASE_URL = process.env.SITE_BASE_URL || 'http://localhost:3000';

const ALLOWLIST_ROUTES = [
  { path: '/', slug: 'homepage' },
  { path: '/challenges', slug: 'challenges-page' },
  { path: '/claude-signup', slug: 'claude-signup-page' },
  { path: '/ai-workshop', slug: 'ai-workshop-page' },
  { path: '/ai-workshop/events', slug: 'ai-workshop-events' },
  { path: '/ai-cohort-register', slug: 'ai-cohort-register' },
  { path: '/ai-cohort-india', slug: 'ai-cohort-india' },
  { path: '/program', slug: 'program-landing-page' },
  { path: '/mission', slug: 'mission-page' },
  { path: '/contact', slug: 'contact-page' },
];

function domToMarkdown($: cheerio.CheerioAPI, $el: any): string {
  const lines: string[] = [];

  // Replace links with markdown format before text extraction
  $el.find('a').each((_: any, a: any) => {
    const $a = $(a);
    const href = $a.attr('href');
    const text = $a.text().replace(/\s+/g, ' ').trim();
    if (href && text) {
      $a.replaceWith(`[${text}](${href})`);
    }
  });

  $el.find('h1, h2, h3, h4, p, ul, ol, dl, blockquote').each((_: any, el: any) => {
    const $child = $(el);
    const tagName = el.tagName.toLowerCase();

    // Prevent duplicates if nested
    if ($child.parents('ul, ol, dl, blockquote').length > 0 && ['p', 'ul', 'ol', 'dl'].includes(tagName)) {
      return;
    }

    let text = $child.text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    if (tagName === 'h1') lines.push(`# ${text}`);
    else if (tagName === 'h2') lines.push(`## ${text}`);
    else if (tagName === 'h3') lines.push(`### ${text}`);
    else if (tagName === 'h4') lines.push(`#### ${text}`);
    else if (tagName === 'p') lines.push(text);
    else if (tagName === 'ul' || tagName === 'ol') {
      $child.find('li').each((_: any, li: any) => {
        lines.push(`- ${$(li).text().replace(/\s+/g, ' ').trim()}`);
      });
    } else if (tagName === 'dl') {
      $child.find('dt, dd').each((_: any, item: any) => {
        const $item = $(item);
        if (item.tagName.toLowerCase() === 'dt') lines.push(`**${$item.text().replace(/\s+/g, ' ').trim()}**`);
        else lines.push(`- ${$item.text().replace(/\s+/g, ' ').trim()}`);
      });
    } else if (tagName === 'blockquote') {
      lines.push(`> ${text}`);
    }
    
    lines.push(''); // Spacing
  });

  return lines.join('\n');
}

async function ingestRoute(route: string, slug: string): Promise<{ success: boolean; chunks: number; error?: string }> {
  const url = `${SITE_BASE_URL}${route}`;
  let html: string;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, chunks: 0, error: `HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { success: false, chunks: 0, error: (err as Error).message };
  }

  const $ = cheerio.load(html);

  // Strip irrelevant UI
  $('nav, footer, script, style, noscript, iframe, svg, [role="navigation"], header').remove();
  
  // Isolate main content
  let $main = $('main');
  if ($main.length === 0) {
    $main = $('body');
  }

  const title = $('title').text().trim() || route;
  
  // Extract clean text
  const markdownBody = domToMarkdown($, $main);

  const finalMarkdown = `---
title: ${title}
route: ${route}
url: ${url}
source_type: site
ingested_at: ${new Date().toISOString()}
---

# ${title}

${markdownBody}
`;

  const outPath = path.join(GENERATED_DIR, `${slug}.md`);
  writeFileSync(outPath, finalMarkdown, 'utf8');

  return { success: true, chunks: markdownBody.split('\n\n').filter(p => p.trim().length > 0).length };
}

async function main() {
  mkdirSync(GENERATED_DIR, { recursive: true });
  console.log(`[ingest-site] Starting ingestion against ${SITE_BASE_URL}...`);

  let successCount = 0;
  let failCount = 0;

  for (const { path: route, slug } of ALLOWLIST_ROUTES) {
    const result = await ingestRoute(route, slug);
    if (result.success) {
      successCount++;
      console.log(`✅ [SUCCESS] ${route} -> generated/${slug}.md (${result.chunks} content blocks)`);
    } else {
      failCount++;
      console.error(`❌ [FAILED]  ${route} -> ${result.error}`);
    }
  }

  console.log(`\n[ingest-site] Ingestion complete. ${successCount} successful, ${failCount} failed.`);
  
  if (failCount > 0) {
    console.warn(`[ingest-site] Warning: ${failCount} routes failed. Proceeding with embedding generation anyway for the successful routes.`);
  }
}

main().catch((err) => {
  console.error('[ingest-site] Fatal error:', err);
  process.exitCode = 1;
});
