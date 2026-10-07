import { useCallback, useEffect } from 'react';

import SelectionPin from '../../components/selection-pin/SelectionPin';
import { clearSentenceHighlight, highlightSentenceHere, samePage } from './highlight';

// Web-page wrapper for the selection pin: selections carry this page's URL,
// the violet pin hands sentences to the side panel through the background,
// and this page answers the side panel's highlightSentence broadcasts.
export default function App() {
  const onEscape = useCallback(() => clearSentenceHighlight(), []);

  // The side panel asks this page to locate a conversation's original
  // sentence; only the tab whose URL matches answers, every other listener
  // declines so the panel can tell "page not open" apart from "found".
  useEffect(() => {
    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: { ok: boolean }) => void,
    ): boolean => {
      const msg = message as { type?: string; sentence?: string; url?: string } | undefined;
      if (msg?.type !== 'highlightSentence' || !msg.sentence || !msg.url) return false;
      if (!samePage(msg.url)) return false;
      try {
        const found = highlightSentenceHere(msg.sentence);
        sendResponse({ ok: found });
      } catch {
        sendResponse({ ok: false });
      }
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  return <SelectionPin selectionUrl={window.location.href} onEscape={onEscape} />;
}
