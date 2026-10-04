// Sentence analysis through the pi-ai SDK (@earendil-works/pi-ai) with the
// DeepSeek provider. Runs inside the offscreen document, which has NO
// chrome.storage API — the API key/model must be passed in by the caller
// (the background worker reads them from chrome.storage and relays them).
// pi-ai is imported lazily so a failure in the SDK can never break the
// panel's initial render.

import type { AssistantMessage, Message, MutableModels } from '@earendil-works/pi-ai';

export interface AiConfig {
  apiKey: string;
  model: string;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalysisChunk {
  text: string;
  role: string;
}

export interface AnalysisVocab {
  term: string;
  meaning: string;
}

// The structured sentence analysis the first turn produces.
export interface SentenceAnalysis {
  chunks: AnalysisChunk[];
  vocab: AnalysisVocab[];
  phrases: string[];
}

const SYSTEM_PROMPT = `You are an English reading assistant for Chinese learners.
The user sends an English sentence (or a follow-up question about it).
For the FIRST message, reply with ONLY a JSON object — no markdown fences,
no text before or after it — shaped exactly like this:
{"chunks":[{"text":"<sentence fragment>","role":"<主语|谓语|宾语|定语|状语|补语|其他>"}],
 "vocab":[{"term":"<word or phrase>","meaning":"<中文释义>"}],
 "phrases":["<idiom or fixed expression>"]}
Rules:
- "chunks" covers the WHOLE sentence left to right in order, no gaps, no
  overlaps; "role" is that fragment's grammatical role in this sentence
  (written in Chinese).
- "vocab" lists only non-basic words or phrases with Chinese meanings.
- "phrases" lists idioms or fixed expressions worth knowing.
For follow-up questions, answer in compact plain Chinese text.`;

let cachedModels: MutableModels | null = null;

async function getModels(): Promise<MutableModels> {
  if (!cachedModels) {
    const { createModels } = await import('@earendil-works/pi-ai');
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek');
    cachedModels = createModels();
    cachedModels.setProvider(deepseekProvider());
  }
  return cachedModels;
}

// Rebuild pi-ai context messages from the plain session history. Assistant
// entries are synthesized as minimal replay frames (usage values are not
// meaningful for replayed turns).
function toContextMessages(messages: AiMessage[], modelId: string): Message[] {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content, timestamp: Date.now() }
      : {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: m.content }],
          api: 'openai-completions' as const,
          provider: 'deepseek' as const,
          model: modelId,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        },
  );
}

// Run one completion over the conversation history and return the reply text.
export async function aiComplete(messages: AiMessage[], config: AiConfig): Promise<string> {
  if (!config.apiKey) throw new Error('NO_API_KEY');

  const model = (await getModels()).getModel('deepseek', config.model);
  if (!model) throw new Error(`unknown model: ${config.model}`);

  const response: AssistantMessage = await (
    await getModels()
  ).complete(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: toContextMessages(messages, config.model),
    },
    { apiKey: config.apiKey },
  );
  if (response.stopReason === 'error')
    throw new Error(response.errorMessage ?? 'AI request failed');
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

// Parse the first-turn reply into the structured sentence analysis. Returns
// null when the content is not the expected JSON — older sessions and
// follow-up replies stay plain text.
export function parseAnalysis(content: string): SentenceAnalysis | null {
  const raw = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SentenceAnalysis>;
    if (!Array.isArray(parsed.chunks)) return null;
    const chunks = parsed.chunks.filter(
      (c): c is AnalysisChunk => !!c && typeof c.text === 'string' && typeof c.role === 'string',
    );
    if (chunks.length === 0) return null;
    const vocab = Array.isArray(parsed.vocab)
      ? parsed.vocab.filter(
          (v): v is AnalysisVocab =>
            !!v && typeof v.term === 'string' && typeof v.meaning === 'string',
        )
      : [];
    const phrases = Array.isArray(parsed.phrases)
      ? parsed.phrases.filter((p): p is string => typeof p === 'string')
      : [];
    return { chunks, vocab, phrases };
  } catch {
    return null;
  }
}
