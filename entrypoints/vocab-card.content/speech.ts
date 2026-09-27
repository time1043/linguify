// English pronunciation via the browser's built-in speech synthesis.
// speechSynthesis is available to content scripts; no permission needed.

export function speakWord(word: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  // Slightly slower than natural speech for language learners.
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
