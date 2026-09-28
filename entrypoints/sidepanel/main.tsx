import React from 'react';
import ReactDOM from 'react-dom/client';

// Surface any boot failure as visible text instead of a blank panel, then
// boot the app. The error handlers only paint the overlay before React has
// mounted; later async failures log to the console like normal.

function showBootError(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin:0;padding:12px;font:12px/1.5 ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap;word-break:break-all;';
  pre.textContent = message;
  root.appendChild(pre);
}

let mounted = false;

window.addEventListener('error', (e) => {
  if (!mounted) showBootError(`启动失败：${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  if (!mounted) showBootError(`启动失败：${String(e.reason)}`);
});

void import('./App').then(
  ({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    mounted = true;
  },
  (err) => showBootError(`启动失败：${String(err)}`),
);
