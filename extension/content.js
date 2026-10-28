(() => {
  if (window.top !== window || globalThis.__driftCue) return;
  globalThis.__driftCue = true;
  let host = null, timer = null, dueTimer = null, token = null, deadline = null, connected = true;
  const notify = message => {
    if (!connected) return;
    try { chrome.runtime.sendMessage(message).catch(() => { connected = false; remove(false); clearTimeout(dueTimer); }); }
    catch { connected = false; remove(false); clearTimeout(dueTimer); }
  };
  function remove(report = true) {
    const previous = token;
    host?.remove(); host = null; token = null; clearTimeout(timer);
    if (report && previous) notify({ type: 'HIDDEN', token: previous });
  }
  function position(random = false) {
    if (!host) return;
    const view = window.visualViewport;
    const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
    const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
    const edge = Math.min(16, width / 8, height / 8);
    host.style.setProperty('max-width', `${Math.max(1, width - edge * 2)}px`, 'important');
    host.style.setProperty('max-height', `${Math.max(1, height - edge * 2)}px`, 'important');
    const rect = host.getBoundingClientRect();
    const maxX = Math.max(edge, width - rect.width - edge), maxY = Math.max(edge, height - rect.height - edge);
    const x = random ? edge + Math.random() * (maxX - edge) : Math.max(edge, Math.min(maxX, parseFloat(host.style.left) - left));
    const y = random ? edge + Math.random() * (maxY - edge) : Math.max(edge, Math.min(maxY, parseFloat(host.style.top) - top));
    host.style.setProperty('left', `${left + x}px`, 'important'); host.style.setProperty('top', `${top + y}px`, 'important');
  }
  function arm() {
    clearTimeout(dueTimer);
    if (!deadline || document.hidden || document.fullscreenElement || !connected) return;
    // An overdue notification is sent once; the worker responds with a fresh plan.
    if (deadline > Date.now()) dueTimer = setTimeout(() => { deadline = null; notify({ type: 'TICK' }); }, Math.min(2147483647, deadline - Date.now()));
  }
  function changed() {
    if (document.hidden || document.fullscreenElement) remove();
    arm(); notify({ type: 'TICK' });
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'PROBE') reply({ visible: !document.hidden, fullscreen: !!document.fullscreenElement });
    else if (message.type === 'SHOW') {
      if (document.hidden || document.fullscreenElement) { reply({ ok: false, reason: '页面不在前台或处于全屏。' }); return; }
      remove(false); token = message.token;
      host = document.createElement('drift-cue-card'); host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial!important;position:fixed!important;display:block!important;box-sizing:border-box!important;width:280px!important;pointer-events:none!important;z-index:2147483647!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;opacity:1!important;transform:none!important;';
      const shadow = host.attachShadow({ mode: 'closed' }), style = document.createElement('style'), card = document.createElement('div');
      const { backgroundColor, textColor, transparency, durationSeconds } = message.config;
      const rgb = backgroundColor.match(/\w\w/g).map(x => parseInt(x, 16));
      // Animate the inner card: the host's important opacity keeps page CSS isolated.
      // Both fades fit inside the configured lifetime; forced dismissal stays instant.
      const fadeInEnd = 180 / (durationSeconds * 1000) * 100;
      const fadeOutStart = 100 - 220 / (durationSeconds * 1000) * 100;
      style.textContent = `:host,:host *{pointer-events:none!important;box-sizing:border-box}div{font:400 16px/1.65 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;padding:18px 20px;border-radius:16px;background:rgba(${rgb.join(',')},${1 - transparency / 100});color:${textColor};max-height:inherit;overflow:hidden;animation:drift-cue-fade ${durationSeconds}s linear both}@keyframes drift-cue-fade{0%{opacity:0;animation-timing-function:ease-out}${fadeInEnd}%{opacity:1}${fadeOutStart}%{opacity:1;animation-timing-function:ease-in}100%{opacity:0}}@media(prefers-reduced-motion:reduce){div{animation:none}}`;
      card.textContent = message.text; shadow.append(style, card); document.documentElement.append(host);
      position(true); timer = setTimeout(() => remove(), durationSeconds * 1000); reply({ ok: true });
    } else if (message.type === 'PLAN') { deadline = message.dueAt; arm(); reply({ ok: true }); }
    else if (message.type === 'HIDE') { remove(false); reply({ ok: true }); }
    else if (message.type === 'STOP') { deadline = null; clearTimeout(dueTimer); remove(false); reply({ ok: true }); }
  });
  document.addEventListener('visibilitychange', changed);
  document.addEventListener('fullscreenchange', changed);
  window.addEventListener('focus', changed);
  window.addEventListener('pageshow', changed);
  window.addEventListener('pagehide', () => { remove(); notify({ type: 'GONE' }); });
  window.addEventListener('resize', () => position());
  window.visualViewport?.addEventListener('resize', () => position());
  window.visualViewport?.addEventListener('scroll', () => position());
  notify({ type: 'TICK' });
})();
