// Плашка прогресса в углу страницы. Живёт в Shadow DOM, чтобы стили сайта её не трогали.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.overlay) return;

  const STYLE = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; box-sizing: border-box;
      width: 300px; padding: 12px 14px; background: #fffaf2; color: #2a2a2a; border: 1px solid #c9b79c;
      border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18); font: 14px/1.4 Georgia, 'PT Serif', serif; }
    .head { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #900; }
    .text { margin-top: 6px; }
    .detail { margin-top: 2px; color: #6b5d4b; font-size: 12px; word-break: break-word; }
    .spin { width: 14px; height: 14px; border: 2px solid #e2d3bd; border-top-color: #900; border-radius: 50%;
      animation: r .8s linear infinite; flex: none; }
    .mark { flex: none; }
    .close { margin-left: auto; border: 0; background: none; color: #6b5d4b; font-size: 18px; line-height: 1;
      cursor: pointer; padding: 0 2px; }
    .error .head { color: #8a1c1c; }
    @keyframes r { to { transform: rotate(360deg); } }
  `;

  let host = null;
  let hideTimer = null;

  function render({ state, text, detail }) {
    if (!host) {
      host = document.createElement('fanbooks-saver');
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    clearTimeout(hideTimer);
    const icon =
      state === 'working' ? '<span class="spin"></span>' : `<span class="mark">${state === 'done' ? '✓' : '!'}</span>`;
    host.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="box ${state}">
        <div class="head">${icon}<span>FanBooks Saver</span><button class="close" title="${FBS.t('overlayClose')}">×</button></div>
        <div class="text"></div>
        <div class="detail"></div>
      </div>`;
    host.shadowRoot.querySelector('.text').textContent = text;
    host.shadowRoot.querySelector('.detail').textContent = detail ?? '';
    host.shadowRoot.querySelector('.close').addEventListener('click', hide);
    if (state === 'done') hideTimer = setTimeout(hide, 8000);
  }

  function hide() {
    clearTimeout(hideTimer);
    host?.remove();
    host = null;
  }

  FBS.overlay = {
    working: (text, detail) => render({ state: 'working', text, detail }),
    done: (text, detail) => render({ state: 'done', text, detail }),
    error: (text, detail) => render({ state: 'error', text, detail }),
    hide,
  };
})();
