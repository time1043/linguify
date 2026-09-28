// AI provider settings persisted in chrome.storage, editable in the options
// page. The provider is fixed to DeepSeek via the pi-ai SDK.

export const DEFAULT_AI_MODEL = 'deepseek-flash';

export const AI_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;

export const aiApiKeyItem = storage.defineItem<string>('local:aiApiKey', { fallback: '' });

export const aiModelItem = storage.defineItem<string>('local:aiModel', {
  fallback: DEFAULT_AI_MODEL,
});

// The sentence waiting to be analyzed, handed from the content script to the
// side panel through storage (works even if the panel opens afterwards).
export interface PendingAiSession {
  sentence: string;
  url: string;
  ts: number;
}

export const aiPendingSessionItem = storage.defineItem<PendingAiSession | null>(
  'local:aiPendingSession',
  { fallback: null },
);
