// Shared tracking of the active tab's video for the panel tabs that talk to
// the video page (subtitles, notes): the content script announces itself on
// load/navigation and on request; whichever tab is in front is the one the
// panel mirrors and commands.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubtitlesVideoInfo } from '@/lib/subtitles';

export type MessageSender = { tab?: { id?: number } | null };

export interface PanelVideo {
  info: SubtitlesVideoInfo;
  tabId: number;
}

export function useActiveVideo() {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [video, setVideo] = useState<PanelVideo | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const activeTabIdRef = useRef<number | null>(null);
  activeTabIdRef.current = activeTabId;

  // Track the active tab — the panel always mirrors whichever tab is in front.
  useEffect(() => {
    const query = (): void => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => setActiveTabId(tab?.id ?? null))
        .catch(() => setActiveTabId(null));
    };
    query();
    const onActivated = (): void => query();
    browser.tabs.onActivated.addListener(onActivated);
    return () => browser.tabs.onActivated.removeListener(onActivated);
  }, []);

  // Switching tabs drops the old video; the content script on the new tab
  // is asked to (re)announce itself. No answer means it is not a video page.
  useEffect(() => {
    setVideo(null);
    setConnectionLost(false);
    if (activeTabId == null) return;
    void browser.tabs
      .sendMessage(activeTabId, { type: 'subtitlesRequestInfo' })
      .catch(() => setConnectionLost(true));
  }, [activeTabId]);

  useEffect(() => {
    const onMessage = (message: unknown, sender: MessageSender): undefined => {
      const tabId = sender.tab?.id;
      if (tabId == null || tabId !== activeTabIdRef.current) return;
      const msg = message as { type?: string; video?: SubtitlesVideoInfo | null } | undefined;
      if (msg?.type === 'subtitlesVideo') {
        setConnectionLost(false);
        setVideo(msg.video ? { info: msg.video, tabId } : null);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const sendToTab = useCallback(async (message: Record<string, unknown>): Promise<unknown> => {
    const tabId = activeTabIdRef.current;
    if (tabId == null) throw new Error('活动标签页未知');
    return browser.tabs.sendMessage(tabId, message);
  }, []);

  return { activeTabId, video, connectionLost, sendToTab };
}
