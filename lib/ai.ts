// Sentence analysis through the pi-ai SDK (@earendil-works/pi-ai) with the
// DeepSeek provider. Runs in windowed extension contexts (side panel); the
// API key is passed explicitly because browsers have no environment.

import { createModels, type AssistantMessage, type Message } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';

import { aiApiKeyItem, aiModelItem } from './settings';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are an English reading assistant for Chinese learners.
The user sends an English sentence (or a follow-up question about it).
For the first message, analyze the sentence in compact plain Chinese text
using exactly these labels, no markdown syntax:
【生词】word — 中文释义 (only non-basic words or phrases, one per line; write 无 if none)
【结构】clause structure: subject / verb / object / modifiers / clauses, brief
【短语】idioms or fixed expressions, if any (write 无 if none)
【翻译】natural Chinese translation
For follow-up questions, answer directly and concisely in Chinese.`;

let cachedModels: ReturnType<typeof createModels> | null = null;

function getModels() {
  if (!cachedModels) {
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
export async function aiComplete(messages: AiMessage[]): Promise<string> {
  const [apiKey, modelId] = await Promise.all([aiApiKeyItem.getValue(), aiModelItem.getValue()]);
  if (!apiKey) throw new Error('NO_API_KEY');

  const model = getModels().getModel('deepseek', modelId);
  if (!model) throw new Error(`unknown model: ${modelId}`);

  const response: AssistantMessage = await getModels().complete(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: toContextMessages(messages, modelId),
    },
    { apiKey },
  );
  if (response.stopReason === 'error')
    throw new Error(response.errorMessage ?? 'AI request failed');
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
