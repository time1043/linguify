// Server URL persisted in chrome.storage so the popup can edit it and the
// background worker reads it on every request.

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765';

export const serverUrlItem = storage.defineItem<string>('local:serverUrl', {
  fallback: DEFAULT_SERVER_URL,
});
