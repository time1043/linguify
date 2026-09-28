// AI provider settings persisted in chrome.storage, editable in the options
// page. The provider is fixed to DeepSeek via the pi-ai SDK.

export const DEFAULT_AI_MODEL = 'deepseek-flash';

export const AI_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;

export const aiApiKeyItem = storage.defineItem<string>('local:aiApiKey', { fallback: '' });

export const aiModelItem = storage.defineItem<string>('local:aiModel', {
  fallback: DEFAULT_AI_MODEL,
});
