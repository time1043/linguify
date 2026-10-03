// Send a message through the background worker to the offscreen document.
// The offscreen replies { ok: true, ...payload } or { ok: false, error }.

export async function callOffscreen<T>(message: Record<string, unknown>): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as {
    ok?: boolean;
    error?: string;
  } & T;
  if (!response?.ok) throw new Error(response?.error || 'offscreen did not respond');
  return response;
}
