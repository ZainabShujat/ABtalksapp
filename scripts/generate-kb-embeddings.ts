import fs from 'fs';
import path from 'path';
import { pipeline } from '@xenova/transformers';

const KB_DIR = path.join(process.cwd(), 'knowledge', 'processed');
const OUTPUT_FILE = path.join(process.cwd(), 'src', 'data', 'kb-embeddings.json');

type Chunk = {
  text: string;
  source: string;
};

type EmbeddedChunk = Chunk & {
  embedding: number[];
};

// Extremely basic markdown chunker. Splits by H2/H3/H4 headers.
function chunkMarkdown(text: string, filename: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = text.split('\n');

  let currentChunkText = '';
  let currentHeader = '';

  for (const line of lines) {
    if (line.match(/^#{2,4}\s/)) {
      if (currentChunkText.trim().length > 20) {
        chunks.push({
          text: (currentHeader ? `${currentHeader}\n` : '') + currentChunkText.trim(),
          source: filename,
        });
      }
      currentHeader = line.trim();
      currentChunkText = '';
    } else {
      currentChunkText += line + '\n';
    }
  }

  if (currentChunkText.trim().length > 20) {
    chunks.push({
      text: (currentHeader ? `${currentHeader}\n` : '') + currentChunkText.trim(),
      source: filename,
    });
  }

  // Further split very large chunks into paragraphs
  const maxChunkLength = 1000;
  const refinedChunks: Chunk[] = [];

  for (const c of chunks) {
    if (c.text.length > maxChunkLength) {
      const paragraphs = c.text.split('\n\n');
      let currentSubChunk = '';
      for (const p of paragraphs) {
        if ((currentSubChunk.length + p.length) > maxChunkLength && currentSubChunk.trim()) {
          refinedChunks.push({ text: currentSubChunk.trim(), source: c.source });
          currentSubChunk = '';
        }
        currentSubChunk += p + '\n\n';
      }
      if (currentSubChunk.trim()) {
        refinedChunks.push({ text: currentSubChunk.trim(), source: c.source });
      }
    } else {
      refinedChunks.push(c);
    }
  }

  return refinedChunks;
}

async function main() {
  console.log('Loading embedding model...');
  // Initialize the pipeline
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} markdown files in ${KB_DIR}`);

  const allChunks: Chunk[] = [];

  for (const file of files) {
    const filePath = path.join(KB_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const chunks = chunkMarkdown(text, file);
    allChunks.push(...chunks);
    console.log(`Processed ${file}: ${chunks.length} chunks`);
  }

  console.log(`Generating embeddings for ${allChunks.length} total chunks...`);
  const embeddedChunks: EmbeddedChunk[] = [];

  let count = 0;
  for (const chunk of allChunks) {
    count++;
    if (count % 20 === 0) {
      console.log(`Embedded ${count}/${allChunks.length} chunks...`);
    }

    // Generate embedding
    const output = await extractor(chunk.text, { pooling: 'mean', normalize: true });
    // output.data is a Float32Array
    const embedding = Array.from(output.data);

    embeddedChunks.push({
      ...chunk,
      embedding
    });
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(embeddedChunks, null, 2));
  console.log(`Successfully saved ${embeddedChunks.length} embedded chunks to ${OUTPUT_FILE}`);
}

main().catch(console.error);

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { chunkMarkdown } from './chunk-markdown';

const GENERATED_DIR = path.join(process.cwd(), 'knowledge', 'generated');
const PROCESSED_DIR = path.join(process.cwd(), 'knowledge', 'processed');
const OUTPUT_FILE = path.join(process.cwd(), 'src', 'data', 'kb-embeddings.json');

export type KnowledgeTier = 'generated' | 'processed';

type EmbeddedChunk = {
  heading: string;
  text: string;
  source: string;
  /**
   * 'generated' = machine-produced from live app source (scripts/extract-public-content.ts),
   * 'processed' = hand-maintained supplementary facts. Retrieval in route.ts
   * uses this to break near-ties in favor of 'generated' — see
   * docs/plans/063-chatbot-dynamic-knowledge-ingestion.md §4 and the 062
   * follow-up: this used to be a documented convention only, with nothing
   * enforcing it at query time.
   */
  tier: KnowledgeTier;
  programId?: string;
  accessLevel?: 'public' | 'gated';
  contentType?: string;
  dayNumber?: number;
  moduleNumber?: number;
  domain?: string;
  embedding: number[];
};

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readMarkdownDir(dir: string): { file: string; rawText: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => ({
      file,
      rawText: fs.readFileSync(path.join(dir, file), 'utf-8'),
    }));
}

function loadJsonFile(filename: string): any {
  const full = path.join(process.cwd(), 'prisma', 'content', filename);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf-8'));
}

function ingestComprehensiveCurriculum(): Omit<EmbeddedChunk, 'embedding'>[] {
  const chunks: Omit<EmbeddedChunk, 'embedding'>[] = [];

  const daysData = loadJsonFile('program/days.json') || [];
  const modulesData = loadJsonFile('program/modules.json') || [];
  const videosData = loadJsonFile('program/videos.json') || [];
  const exercisesData = loadJsonFile('program/exercises.json') || [];
  const rubricsData = loadJsonFile('program/rubrics.json') || [];
  const claudeData = loadJsonFile('claude-problems.json') || [];
  const problemsData = loadJsonFile('problems.json') || [];

  const moduleByNumber = new Map<number, any>(modulesData.map((m: any) => [m.number, m]));
  const videosByDay = new Map<number, any[]>(videosData.map((v: any) => [v.dayNumber, v.videos]));
  const exercisesByModule = new Map<number, any[]>();
  for (const ex of exercisesData) {
    if (!exercisesByModule.has(ex.moduleNumber)) exercisesByModule.set(ex.moduleNumber, []);
    exercisesByModule.get(ex.moduleNumber)!.push(ex);
  }
  const rubricByModule = new Map<number, any>(rubricsData.map((r: any) => [r.moduleNumber, r]));

  // 1. AI Cohort: Day Chunks
  for (const day of daysData) {
    const mod = moduleByNumber.get(day.moduleNumber);
    const videos = videosByDay.get(day.dayNumber) || [];

    let text = mod ? `Module ${mod.number}: ${mod.title}\n\n` : '';
    text += `Brief:\n${day.briefMd || ''}`;
    if (day.objectives?.length) text += '\n\nObjectives:\n- ' + day.objectives.join('\n- ');
    if (day.tools?.length) text += '\n\nTools:\n- ' + day.tools.join('\n- ');
    if (videos.length) text += '\n\nVideos:\n- ' + videos.map((v: any) => v.title).join('\n- ');

    chunks.push({
      heading: `Day ${day.dayNumber} (Module ${day.moduleNumber}): ${day.title}`,
      text,
      source: 'days.json',
      tier: 'generated',
      programId: 'ai-cohort',
      accessLevel: 'gated',
      contentType: 'curriculum-day',
      dayNumber: day.dayNumber,
      moduleNumber: day.moduleNumber
    });
  }

  // 2. AI Cohort: Module Chunks
  for (const mod of modulesData) {
    const exercises = exercisesByModule.get(mod.number) || [];
    const rubric = rubricByModule.get(mod.number);

    let text = `${mod.subtitle}\n\n`;
    if (exercises.length) {
      text += 'Exercises:\n';
      for (const ex of exercises) {
        text += `- [${ex.language}] ${ex.title}: ${ex.description}\n`;
      }
    }
    if (rubric && rubric.criteria?.length) {
      text += '\nRubrics:\n';
      for (const crit of rubric.criteria) {
        text += `- ${crit.name} (${crit.weight}%): ${crit.description}\n`;
      }
    }

    chunks.push({
      heading: `Module ${mod.number}: ${mod.title} - Exercises & Rubric`,
      text,
      source: 'modules.json',
      tier: 'generated',
      programId: 'ai-cohort',
      accessLevel: 'gated',
      contentType: 'curriculum-module',
      moduleNumber: mod.number
    });
  }

  // 3. Claude Challenge Tasks
  for (const day of claudeData) {
    let text = day.problemStatement || '';
    if (day.learningObjectives?.length) text += '\n\nObjectives:\n- ' + day.learningObjectives.join('\n- ');
    if (day.dayContent?.task?.steps?.length) text += '\n\nSteps:\n- ' + day.dayContent.task.steps.join('\n- ');

    chunks.push({
      heading: `Day ${day.dayNumber}: ${day.title}`,
      text,
      source: 'claude-problems.json',
      tier: 'generated',
      programId: 'claude-challenge',
      accessLevel: 'gated',
      contentType: 'challenge-task',
      dayNumber: day.dayNumber,
      domain: 'CLAUDE'
    });
  }

  // 4. Coding Challenge Tasks
  for (const day of problemsData) {
    let text = day.problemStatement || '';
    if (day.learningObjectives?.length) text += '\n\nObjectives:\n- ' + day.learningObjectives.join('\n- ');

    chunks.push({
      heading: `Day ${day.dayNumber} (${day.domain}): ${day.title}`,
      text,
      source: 'problems.json',
      tier: 'generated',
      programId: 'coding-challenge',
      accessLevel: 'gated',
      contentType: 'challenge-task',
      dayNumber: day.dayNumber,
      domain: day.domain
    });
  }

  return chunks;
}

async function main() {
  // knowledge/generated/*.md is the machine-produced tier (scripts/extract-public-content.ts,
  // always wins on conflict — see docs/plans/063-chatbot-dynamic-knowledge-ingestion.md §4).
  // knowledge/processed/*.md is the small, hand-maintained supplementary tier.
  const files: { file: string; rawText: string; tier: KnowledgeTier }[] = [
    ...readMarkdownDir(GENERATED_DIR).map((f) => ({ ...f, tier: 'generated' as const })),
    ...readMarkdownDir(PROCESSED_DIR).map((f) => ({ ...f, tier: 'processed' as const })),
  ];
  console.log(`[embeddings-gen] Found ${files.length} markdown files (generated + processed)`);

  const allChunks: Omit<EmbeddedChunk, 'embedding'>[] = [];
  for (const { file, rawText, tier } of files) {
    const chunks = chunkMarkdown(rawText, file.replace(/\.md$/, ''));
    console.log(`[embeddings-gen] ${file}: ${chunks.length} chunk(s) [${tier}]`);
    for (const chunk of chunks) {
      allChunks.push({
        heading: chunk.heading,
        text: chunk.text,
        source: file,
        tier,
        programId: chunk.programId,
        accessLevel: chunk.accessLevel || 'public'
      });
    }
  }

  // Ingest curriculum JSONs directly
  const jsonChunks = ingestComprehensiveCurriculum();
  console.log(`[embeddings-gen] Generated ${jsonChunks.length} chunk(s) directly from Prisma JSON curricula`);
  allChunks.push(...jsonChunks);

  // Incremental embedding: reuse the previous run's embedding for any chunk
  // whose exact text hasn't changed, keyed by a content hash — not source
  // filename or position, so a chunk surviving a reorder still hits the
  // cache. Only chunks with genuinely new/changed text need the (expensive)
  // local embedding model at all.
  const previousByHash = new Map<string, number[]>();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const previous: EmbeddedChunk[] = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      for (const chunk of previous) {
        previousByHash.set(hashText(chunk.text), chunk.embedding);
      }
    } catch {
      console.warn('[embeddings-gen] Could not parse existing kb-embeddings.json — re-embedding everything.');
    }
  }

  const toEmbed = allChunks.filter((c) => !previousByHash.has(hashText(c.text)));
  console.log(
    `[embeddings-gen] ${allChunks.length - toEmbed.length} chunk(s) unchanged (reused), ${toEmbed.length} chunk(s) need embedding.`,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @xenova/transformers' pipeline() return type is loosely typed upstream
  let extractor: any = null;
  if (toEmbed.length > 0) {
    console.log('[embeddings-gen] Loading embedding model (Xenova/all-MiniLM-L6-v2)...');
    const { pipeline } = await import('@xenova/transformers');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  const embeddedChunks: EmbeddedChunk[] = [];
  for (const chunk of allChunks) {
    const hash = hashText(chunk.text);
    const cached = previousByHash.get(hash);
    if (cached) {
      embeddedChunks.push({ ...chunk, embedding: cached });
      continue;
    }
    const output = await extractor(chunk.text, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data) as number[];
    embeddedChunks.push({ ...chunk, embedding });
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(embeddedChunks, null, 2));
  console.log(`[embeddings-gen] Saved ${embeddedChunks.length} embedded chunks to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('[embeddings-gen] fatal:', err);
  process.exitCode = 1;
});
