import ReactDOM from 'react-dom/client';

import App from './App';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      // Custom element names must contain a hyphen — 'linguify' makes
      // attachShadow throw and kills the whole content script.
      name: 'linguify-card',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        // React warns when rendering directly on the container, so append a wrapper.
        const wrapper = document.createElement('div');
        container.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();
  },
});
