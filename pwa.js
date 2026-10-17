// Registra o service worker e mostra o botão "INSTALAR APP" quando disponível.
(function () {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
    });
  }
  var evento = null, botao = null;
  function criarBotao() {
    if (botao || !evento) return;
    botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'INSTALAR APP';
    botao.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#2563eb;color:#fff;border:0;border-radius:999px;padding:12px 18px;font-weight:700;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer';
    botao.onclick = function () {
      var e = evento; evento = null; botao.remove(); botao = null;
      e.prompt(); e.userChoice.catch(function () {});
    };
    document.body.appendChild(botao);
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); evento = e;
    if (document.body) criarBotao(); else document.addEventListener('DOMContentLoaded', criarBotao);
  });
  window.addEventListener('appinstalled', function () { if (botao) botao.remove(); botao = null; evento = null; });
})();
