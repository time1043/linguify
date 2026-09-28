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

const SYSTEM_PROMPT = `You are an English reading assistant for Chinese learners.
The user sends an English sentence (or a follow-up question about it).
For the first message, analyze the sentence in compact plain Chinese text
using exactly these labels, no markdown syntax:
【生词】word — 中文释义 (only non-basic words or phrases, one per line; write 无 if none)
【结构】句子结构分析 (subject / verb / object / modifiers / clauses, brief)
【短语】习惯用语或固定表达 (write 无 if none)
For follow-up questions, answer directly and concisely in Chinese.`;

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
