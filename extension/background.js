import { DEFAULTS, clone, hydrate, validateConfig, ruleForUrl, supportedUrl, origins, reconcile, recordDisplay, randomMessage } from './core.js';

let config, state, lastError = '';
let queue = Promise.resolve();
const isUI = sender => sender.id === chrome.runtime.id && ['popup.html', 'options.html'].some(p => sender.url?.startsWith(chrome.runtime.getURL(p)));
const send = (tabId, message) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
async function safeSend(tabId, message) { try { return await send(tabId, message); } catch { return null; } }
async function permissions(sites = config.sites) {
  const result = new Set();
  for (const site of sites) if (await chrome.permissions.contains({ origins: origins(site) })) result.add(site.id);
  return result;
}
async function register() {
  const allowed = await permissions();
  const desired = config.sites.filter(s => s.enabled && config.enabled && allowed.has(s.id));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(s => s.id) });
  if (desired.length) await chrome.scripting.registerContentScripts(desired.map(s => ({
    id: `site-${s.id}`, matches: origins(s), js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true
  })));
}
async function connect(tabId) {
  let result = await safeSend(tabId, { type: 'PROBE' });
  if (!result) {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
    catch (e) { return { blocked: true, reason: `此页面无法注入：${e.message}` }; }
    result = await safeSend(tabId, { type: 'PROBE' });
  }
  return result;
}
async function persist() { await chrome.storage.session.set({ scheduler: state }); }
async function hide() {
  if (state.shown) await safeSend(state.shown.tabId, { type: 'HIDE' });
  state.shown = null;
}
async function tick() {
  const now = Date.now(), tabs = await chrome.tabs.query({}), allowed = await permissions();
  // Expiration is based on the absolute deadline, even after a sleeping worker.
  let expired = false;
  for (const [id, until] of Object.entries(config.pauses)) if (until <= now) {
    delete config.pauses[id]; expired = true;
    if (config.enabled && config.sites.some(s => s.id === id && s.enabled) && allowed.has(id) && tabs.some(t => ruleForUrl(t.url, config)?.id === id)) state.sites[id] = { dueAt: until + config.intervalSeconds * 1000 };
  }
  if (expired) await chrome.storage.local.set({ config });
  const pairs = tabs.map(tab => ({ tab, rule: ruleForUrl(tab.url, config) }));
  const next = reconcile(state, config, new Set(pairs.filter(p => p.rule).map(p => p.rule.id)), allowed, now);
  let focused = null;
  try { focused = await chrome.windows.getLastFocused(); } catch { /* No browser windows remain. */ }
  const foreground = pairs.find(p => p.tab.active && p.tab.windowId === focused?.id && focused.focused);
  const target = foreground?.rule && allowed.has(foreground.rule.id) ? foreground : null;
  const revoked = state.shown?.ruleId && (!state.shown.preview || state.shown.requiresRulePermission) && !allowed.has(state.shown.ruleId);
  if (state.shown && (!next.shown || state.shown.tabId !== foreground?.tab.id || revoked)) await hide();
  state = { ...next, shown: state.shown };
  if (target && state.sites[target.rule.id]?.dueAt <= now && !state.shown) {
    const probe = await connect(target.tab.id);
    if (probe?.visible && !probe.fullscreen) {
      const token = crypto.randomUUID(), shownAt = Date.now();
      const result = await safeSend(target.tab.id, { type: 'SHOW', token, config: cardConfig(), text: randomMessage(config.messages) });
      if (result?.ok) state = recordDisplay(state, target.rule.id, target.tab.id, shownAt, config.durationSeconds, config.intervalSeconds, token);
    }
  }
  for (const { tab, rule } of pairs) {
    const dueAt = rule && allowed.has(rule.id) ? state.sites[rule.id]?.dueAt : null;
    if (dueAt) {
      // Existing tabs also start immediately after granting access or enabling a rule.
      const probe = await connect(tab.id);
      if (probe && !probe.blocked) await safeSend(tab.id, { type: 'PLAN', dueAt });
    } else if (!(state.shown?.preview && state.shown.tabId === tab.id)) await safeSend(tab.id, { type: 'STOP' });
  }
  await persist();
}
function cardConfig() {
  return { backgroundColor: config.backgroundColor, textColor: config.textColor, transparency: config.transparency, durationSeconds: config.durationSeconds };
}
async function current(tabId) {
  let tab;
  try { tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]; } catch { return { supported: false }; }
  const rule = ruleForUrl(tab?.url, config), allowed = await permissions();
  return {
    tabId: tab?.id, supported: supportedUrl(tab?.url), domain: supportedUrl(tab?.url) ? new URL(tab.url).hostname : '',
    rule, granted: rule ? allowed.has(rule.id) : false, pausedUntil: rule ? config.pauses[rule.id] ?? null : null,
    dueAt: rule ? state.sites[rule.id]?.dueAt ?? null : null,
    cardVisible: !!state.shown && state.shown.tabId === tab?.id && state.shown.until > Date.now()
  };
}
async function handle(message, sender) {
  if (!isUI(sender)) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !['TICK', 'GONE', 'HIDDEN'].includes(message.type)) return { ok: false, error: '不支持的消息来源。' };
    if (message.type === 'HIDDEN' && state.shown?.tabId === sender.tab.id && state.shown.token === message.token) state.shown = null;
    await tick(); return { ok: true };
  }
  switch (message.type) {
    case 'GET': await tick(); return { ok: true, config, current: await current(message.tabId), allowed: [...await permissions()], lastError };
    case 'SAVE': {
      const checked = validateConfig({ ...message.config, pauses: config.pauses });
      if (!checked.ok) return checked;
      const allowed = await permissions(checked.config.sites);
      // A missing grant remains visibly "权限不足", never falsely "运行中".
      for (const s of checked.config.sites) if (s.enabled && !allowed.has(s.id) && !config.sites.some(old => old.id === s.id && old.enabled && old.domain === s.domain && old.subdomains === s.subdomains)) return { ok: false, errors: { sites: `请先为 ${s.domain} 授权，或将规则保存为关闭。` } };
      await hide(); config = checked.config;
      config.pauses = Object.fromEntries(Object.entries(config.pauses).filter(([id]) => config.sites.some(s => s.id === id)));
      await chrome.storage.local.set({ config }); state.sites = {}; await register(); await tick(); return { ok: true };
    }
    case 'GLOBAL': await hide(); config.enabled = !!message.enabled; state.sites = {}; await chrome.storage.local.set({ config }); await register(); await tick(); return { ok: true };
    case 'PAUSE': {
      const c = await current(message.tabId);
      if (!c.rule) return { ok: false, error: '当前网站尚未配置。' };
      if (!Number.isInteger(message.minutes) || message.minutes < 1 || message.minutes > 1440) return { ok: false, error: '本次暂停须为 1–1440 分钟的整数。' };
      config.pauses[c.rule.id] = Date.now() + message.minutes * 60000;
      if (state.shown?.ruleId === c.rule.id) await hide();
      delete state.sites[c.rule.id]; await chrome.storage.local.set({ config }); await tick(); return { ok: true };
    }
    case 'RESUME': {
      const c = await current(message.tabId);
      if (!c.rule) return { ok: false, error: '当前网站尚未配置。' };
      delete config.pauses[c.rule.id]; delete state.sites[c.rule.id];
      await chrome.storage.local.set({ config }); await tick(); return { ok: true };
    }
    case 'DISMISS': {
      const c = await current(message.tabId);
      if (c.cardVisible) await hide();
      await persist(); return { ok: true };
    }
    case 'PREVIEW': {
      const c = await current(message.tabId);
      if (!c.supported) return { ok: false, error: '当前页面不支持预览，请切换到普通 HTTP / HTTPS 网页。' };
      const checked = validateConfig({ ...config, ...message.draft, sites: config.sites, pauses: config.pauses });
      if (!checked.ok) return checked;
      // activeTab is granted by the toolbar gesture, or a site-specific grant.
      const probe = await connect(c.tabId);
      if (!probe || probe.blocked) return { ok: false, error: '权限不足或页面受限制。请先通过弹窗或设置页为此网站授权。' };
      if (probe.fullscreen) return { ok: false, error: '请先退出视频全屏再预览；本次预览不会排队。' };
      if (!probe.visible) return { ok: false, error: '请先切换到需要预览的网页。' };
      await hide();
      const token = crypto.randomUUID(), draft = checked.config;
      const result = await send(c.tabId, { type: 'SHOW', token, config: draft, text: randomMessage(draft.messages) });
      if (!result.ok) throw new Error(result.reason);
      state = recordDisplay(state, c.rule?.id ?? null, c.tabId, Date.now(), draft.durationSeconds, config.intervalSeconds, token, true);
      // A toolbar gesture may grant only activeTab. Do not treat the absence of
      // the rule's persistent host grant as a revocation of that valid preview.
      state.shown.requiresRulePermission = c.granted;
      await persist(); return { ok: true };
    }
    default: throw new Error('未知操作。');
  }
}
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  config = hydrate((await chrome.storage.local.get('config')).config);
  if (!(await chrome.storage.local.get('config')).config) await chrome.storage.local.set({ config: clone(DEFAULTS) });
  const savedState = (await chrome.storage.session.get('scheduler')).scheduler;
  state = savedState ?? { sites: {}, shown: null };
  if (!savedState) {
    // A new browser/extension session starts fresh; elapsed pauses remain absolute.
    for (const [id, until] of Object.entries(config.pauses)) if (until <= Date.now()) delete config.pauses[id];
    await chrome.storage.local.set({ config });
  }
  await register();
  if (!await chrome.alarms.get('recover')) await chrome.alarms.create('recover', { periodInMinutes: 0.5 });
}
const ready = initialize();
function enqueue(work) {
  const result = queue.then(() => ready).then(work);
  queue = result.catch(e => { lastError = e.message; console.error('DriftCue:', e.message); });
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  enqueue(() => handle(message, sender)).then(reply, e => reply({ ok: false, error: e.message })); return true;
});
const wake = () => { void enqueue(tick); };
chrome.tabs.onCreated.addListener(wake);
chrome.tabs.onRemoved.addListener(wake);
chrome.tabs.onReplaced.addListener(wake);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status || info.url || info.discarded !== undefined) wake(); });
chrome.tabs.onActivated.addListener(wake);
chrome.windows.onFocusChanged.addListener(wake);
chrome.alarms.onAlarm.addListener(wake);
chrome.runtime.onStartup.addListener(() => { void enqueue(async () => { await hide(); state.sites = {}; await tick(); }); });
for (const event of [chrome.permissions.onAdded, chrome.permissions.onRemoved]) event.addListener(() => { void enqueue(async () => { await register(); await tick(); }); });
wake();
