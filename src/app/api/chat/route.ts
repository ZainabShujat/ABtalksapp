import fs from 'fs';
import path from 'path';
import { matchQuestion } from "@/lib/chatbot-matcher";

const KB_DIR = path.join(process.cwd(), 'knowledge', 'processed');

type Chunk = {
  text: string;
  source: string;
};

type ProcessedChunk = Chunk & {
  tokens: string[];
  termFrequencies: Record<string, number>;
};

let cachedKb: ProcessedChunk[] | null = null;
let idfCache: Record<string, number> = {};

// Basic tokenizer
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2);
}

function chunkMarkdown(text: string, filename: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = text.split('\n');
  
  let currentChunkText = '';
  let currentHeader = '';

  for (const line of lines) {
    if (line.match(/^#{2,4}\s/)) {
      if (currentChunkText.trim().length > 20) {
        chunks.push({ text: (currentHeader ? `${currentHeader}\n` : '') + currentChunkText.trim(), source: filename });
      }
      currentHeader = line.trim();
      currentChunkText = '';
    } else {
      currentChunkText += line + '\n';
    }
  }

  if (currentChunkText.trim().length > 20) {
    chunks.push({ text: (currentHeader ? `${currentHeader}\n` : '') + currentChunkText.trim(), source: filename });
  }

  // Refine large chunks
  const refinedChunks: Chunk[] = [];
  for (const c of chunks) {
    if (c.text.length > 1000) {
      const paragraphs = c.text.split('\n\n');
      let subChunk = '';
      for (const p of paragraphs) {
        if ((subChunk.length + p.length) > 1000 && subChunk.trim()) {
           refinedChunks.push({ text: subChunk.trim(), source: c.source });
           subChunk = '';
        }
        subChunk += p + '\n\n';
      }
      if (subChunk.trim()) refinedChunks.push({ text: subChunk.trim(), source: c.source });
    } else {
      refinedChunks.push(c);
    }
  }
  return refinedChunks;
}

// Generates the KB using TF-IDF on the fly
async function getEmbeddedKb(): Promise<{ chunks: ProcessedChunk[], idf: Record<string, number> }> {
  if (cachedKb) return { chunks: cachedKb, idf: idfCache };
  console.log('[chat-api] Generating TF-IDF KB on the fly...');
  
  const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md'));
  const allChunks: Chunk[] = [];

  for (const file of files) {
    const filePath = path.join(KB_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    allChunks.push(...chunkMarkdown(text, file));
  }

  const processed: ProcessedChunk[] = [];
  const documentFreq: Record<string, number> = {};

  for (const chunk of allChunks) {
    const tokens = tokenize(chunk.text);
    const tf: Record<string, number> = {};
    const uniqueTokens = new Set(tokens);
    
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const t of uniqueTokens) documentFreq[t] = (documentFreq[t] || 0) + 1;

    processed.push({ ...chunk, tokens, termFrequencies: tf });
  }

  // Calculate IDF
  const N = processed.length;
  for (const [term, df] of Object.entries(documentFreq)) {
    idfCache[term] = Math.log(1 + (N - df + 0.5) / (df + 0.5)); // BM25-style IDF
  }

  cachedKb = processed;
  return { chunks: cachedKb, idf: idfCache };
}

// BM25 scoring
function scoreQuery(queryTokens: string[], chunk: ProcessedChunk, idf: Record<string, number>): number {
  let score = 0;
  const k1 = 1.5; // Term frequency saturation
  const b = 0.75; // Document length normalization
  const avgdl = 150; // Approximated average doc length in tokens
  const dl = chunk.tokens.length;

  for (const q of queryTokens) {
    if (chunk.termFrequencies[q]) {
      const tf = chunk.termFrequencies[q];
      const termIdf = idf[q] || Math.log(1 + 0.5); // Default rare word IDF
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (dl / avgdl));
      score += termIdf * (numerator / denominator);
    }
  }
  return score;
}

const FALLBACK_MESSAGE =
  "I couldn't find a direct answer to that in my knowledge base. Please reach out to team@abtalks.in.";

const OUT_OF_SCOPE_RE =
  /\b(accommodation|hostel|lodging|travel (allowance|reimbursement)|visa|stipend amount|salary|placement guarantee|job guarantee|revenue|funding|investor|valuation)\b/i;
const OUT_OF_SCOPE_REPLY =
  "I don't have reliable information about that in the ABTalks knowledge base. You can contact the ABTalks team directly at team@abtalks.in.";

const CRISIS_RE =
  /\b(suicid\w*|kill myself|end (my life|it all)|want (to )?end it\b|self[\s-]?harm|hurt myself|want to die|don'?t want to (live|be alive)|no reason to live|no point (in )?living)\b/i;
const CRISIS_REPLY =
  "I'm really sorry you're going through this — please know you don't have to handle it alone. If you're in India, you can reach iCall at 9152987821 or the Vandrevala Foundation at 1860-2662-345, both free and confidential, right now. If you're outside India, please contact your local emergency services or a crisis line where you are. You're also welcome to email team@abtalks.in — but please reach out to one of the helplines above first.";

const HARASSMENT_ESCALATION_RE =
  /\b(harass\w*|doxx\w*|being threatened|threat(en(ed|ing))? (me|us)|blackmail\w*|being bullied|is impersonating|fake (admin|staff)|sue (you|abtalks)|legal action against (you|abtalks)|report (someone|a participant|abuse)|being stalked)\b/i;
const HARASSMENT_ESCALATION_REPLY =
  "I'm sorry to hear that — this isn't something I can resolve here, but it's exactly the kind of thing the ABTalks team handles directly and seriously. Please email team@abtalks.in with as much detail as you're comfortable sharing (screenshots help), and they'll follow up with you personally.";

const SCAM_RE =
  /\b(ask(ed|ing)? (me )?for (payment|money) to (unlock|access|release|activate)|pay to (unlock|get) (my |the )?certificate|asked me to pay|wants? money to (verify|release))\b/i;
const SCAM_REPLY =
  "That's not legitimate — ABTalks never asks for payment to unlock a certificate, verify your account, or access program benefits. Every ABTalks program is free to participate in. Please don't send any money, and forward the message to team@abtalks.in so the team can look into it.";

const SYSTEM_PROMPT = `You are the ABTalks Help Assistant.
Your primary role is to answer questions about ABTalks using ONLY the provided context.
- Always mention that ABTalks is an online community when introducing it.
- If someone asks how to apply or wants to join the team, instruct them to share their cover letter, resume, and any other relevant details to team@abtalks.in.
- When explaining a challenge or program, go into hyper detail based on the context. Every step, requirement, and rule should be clearly listed and explained.
- Site structure (Sitemap): Home (/), Hackathons (/hackathons), Evidence (/evidence), Privacy (/privacy), Sign In (/login).
- For multi-part questions, answer every independently answerable part. Do not stop after answering only the first part.
- Answer naturally as an ABTalks support assistant. Do not mention "the knowledge base", "retrieved context", "chunks", "documents", "RAG", or internal sources unless the user explicitly asks how the assistant works.
- If the answer is NOT present in the provided context, you MUST output exactly: "${FALLBACK_MESSAGE}". Do not invent, guess, or synthesize information outside the context.
- Keep your answers conversational but highly detailed when required.
- If a user's question is ambiguous (e.g., "How do I join?"), briefly explain the options (e.g., Hackathon, AI Cohort) and ask them which one they mean.
- Do not repeat the prompt or context in your response.`;

function sseTextResponse(text: string): Response {
  return new Response(
    `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n\ndata: {"type":"message_stop"}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing messages' }), { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return new Response(JSON.stringify({ error: 'Last message must be from user' }), { status: 400 });
    }

    const trimmedLast = lastMessage.content.trim();
    const exactMatch = matchQuestion(trimmedLast);
    if (exactMatch) {
      return sseTextResponse(exactMatch.answer);
    }
    
    if (CRISIS_RE.test(trimmedLast)) return sseTextResponse(CRISIS_REPLY);
    if (HARASSMENT_ESCALATION_RE.test(trimmedLast)) return sseTextResponse(HARASSMENT_ESCALATION_REPLY);
    if (SCAM_RE.test(trimmedLast)) return sseTextResponse(SCAM_REPLY);
    if (OUT_OF_SCOPE_RE.test(trimmedLast)) return sseTextResponse(OUT_OF_SCOPE_REPLY);

    let searchQuery = lastMessage.content;
    if (messages.length > 2) {
      const prevMessage = messages[messages.length - 2].content;
      searchQuery = `${prevMessage} \n ${searchQuery}`;
    }

    const queryTokens = tokenize(searchQuery);
    
    // 3. Search the KB using TF-IDF / BM25
    const { chunks, idf } = await getEmbeddedKb();
    const scoredChunks = chunks.map(chunk => ({
      ...chunk,
      score: scoreQuery(queryTokens, chunk, idf),
    }));

    scoredChunks.sort((a, b) => b.score - a.score);
    
    // Confidence Threshold (BM25 scores aren't exactly 0-1, so we check for > 0.1 as a baseline)
    const topChunks = scoredChunks.filter(c => c.score > 0.1).slice(0, 10);

    if (topChunks.length === 0) {
      // If we have absolutely no semantic matches, immediately return the fallback text
      // to save LLM latency and enforce strict boundaries.
      return new Response(
        `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(FALLBACK_MESSAGE)}}}\n\ndata: {"type":"message_stop"}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }

    const contextText = topChunks.map(c => `[Source: ${c.source}]\n${c.text}`).join('\n\n---\n\n');
    
    const systemWithContext = `${SYSTEM_PROMPT}\n\nHere is the verified knowledge base context:\n<context>\n${contextText}\n</context>`;

    // 5. Stream response from Gemini using official REST API
    const geminiMessages = messages.map((m: any, idx: number) => {
      let text = m.content;
      // Prepend system instruction to the first user message to avoid systemInstruction API issues
      if (idx === 0 && m.role === 'user') {
        text = `${systemWithContext}\n\nUser query: ${text}`;
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }]
      };
    });

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: geminiMessages,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini API error:', err);
      return new Response(JSON.stringify({ error: 'Failed to generate response', details: err }), { status: 500 });
    }

    // We can pipe the exact Gemini SSE stream back to the client.
    return new Response(geminiRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (err: any) {
    console.error('Error in /api/chat:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', details: err.message }), { status: 500 });
  }
}
