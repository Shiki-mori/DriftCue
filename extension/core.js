export const DEFAULTS = Object.freeze({
  schemaVersion: 1, enabled: true, intervalSeconds: 120, durationSeconds: 4,
  backgroundColor: '#FFF3CD', textColor: '#222222', transparency: 50,
  pauseMinutes: 10, messages: ['你在做什么呢？'],
  sites: [{ id: 'bilibili', name: 'bilibili', domain: 'bilibili.com', subdomains: true, enabled: true }],
  pauses: {}
});
export const clone = value => structuredClone(value);
export function normalizeDomain(input) {
  const raw = String(input).trim();
  if (!raw || /\s/.test(raw)) throw new Error('请输入有效域名或 HTTP / HTTPS 网址。');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含账号密码的 HTTP / HTTPS 网址。');
  const domain = url.hostname.toLowerCase().replace(/\.$/, '');
  if (domain.length > 253 || !/^(localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(domain) || domain.split('.').some(x => !x || x.length > 63 || x.startsWith('-') || x.endsWith('-'))) throw new Error('域名格式不受支持（IPv6 不在首版范围）。');
  return domain;
}
export function matches(domain, rule) {
  return domain === rule.domain || (rule.subdomains && domain.endsWith(`.${rule.domain}`));
}
export function supportedUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !['chromewebstore.google.com'].includes(u.hostname) && !(u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
  } catch { return false; }
}
export function ruleForUrl(url, config) {
  if (!supportedUrl(url)) return null;
  return config.sites.find(s => matches(new URL(url).hostname.toLowerCase(), s)) ?? null;
}
export function origins(rule) { return ['http', 'https'].map(s => `${s}://${rule.subdomains && rule.domain !== 'localhost' && !/^\d+(\.\d+){3}$/.test(rule.domain) ? '*.' : ''}${rule.domain}/*`); }
export function validateConfig(value) {
  const c = clone(value), errors = {};
  const integer = (key, min, max, label) => { if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) errors[key] = `${label}须为 ${min}–${max} 的整数。`; };
  integer('intervalSeconds', 10, 7200, '间隔秒数'); integer('durationSeconds', 1, 60, '保持秒数');
  integer('transparency', 0, 100, '背景透明度'); integer('pauseMinutes', 1, 1440, '暂停分钟数');
  if (c.durationSeconds >= c.intervalSeconds) errors.durationSeconds = '保持时间必须小于出现间隔。';
  for (const key of ['backgroundColor', 'textColor']) if (!/^#[\da-f]{6}$/i.test(c[key])) errors[key] = '请输入 #RRGGBB 格式的颜色。';
  if (!Array.isArray(c.messages) || c.messages.length < 1 || c.messages.length > 100) errors.messages = '请保留 1–100 条提醒文字。';
  else c.messages.forEach((m, i) => { if (typeof m !== 'string' || !m.trim() || [...m].length > 200) errors[`message-${i}`] = '每条须为 1–200 个 Unicode 字符，不能全为空白。'; });
  if (typeof c.enabled !== 'boolean' || !Array.isArray(c.sites)) errors.sites = '网站配置格式无效。';
  else {
    const ids = new Set();
    c.sites.forEach((s, i) => {
      try {
        if (!s.id || ids.has(s.id) || !/^[\w-]{1,80}$/.test(s.id)) throw new Error('网站标识重复或无效。');
        ids.add(s.id); s.domain = normalizeDomain(s.domain);
        if (typeof s.enabled !== 'boolean' || typeof s.subdomains !== 'boolean' || typeof s.name !== 'string' || !s.name.trim() || [...s.name].length > 60) throw new Error('名称须为 1–60 字，网站开关格式须正确。');
        if (c.sites.slice(0, i).some(p => p.name.trim().toLowerCase() === s.name.trim().toLowerCase())) throw new Error('网站名称重复，请使用不同名称。');
        if (c.sites.slice(0, i).some(p => matches(s.domain, p) || matches(p.domain, s))) throw new Error('域名重复或与已有父/子域名规则重叠，请先调整已有规则。');
      } catch (e) { errors[`site-${i}`] = e.message; }
    });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, config: c };
}
export function hydrate(saved) {
  const c = { ...clone(DEFAULTS), ...saved, schemaVersion: 1 };
  const checked = validateConfig(c);
  if (!checked.ok) throw new Error('本地配置无效，请在设置页修正；原始数据未覆盖。');
  c.pauses = Object.fromEntries(Object.entries(c.pauses ?? {}).filter(([id, time]) => c.sites.some(s => s.id === id) && Number.isFinite(time) && time > 0));
  return c;
}
export function randomMessage(messages, random = Math.random) { return messages[Math.min(messages.length - 1, Math.floor(random() * messages.length))]; }
export function reconcile(state, config, openRuleIds, allowedIds, now) {
  const next = clone(state ?? { sites: {}, shown: null });
  next.sites ??= {};
  const active = new Set(config.sites.filter(s => config.enabled && s.enabled && openRuleIds.has(s.id) && allowedIds.has(s.id)).map(s => s.id));
  for (const id of Object.keys(next.sites)) if (!active.has(id) || config.pauses[id] > now) delete next.sites[id];
  for (const id of active) {
    if (config.pauses[id] > now) continue;
    if (!next.sites[id]) next.sites[id] = { dueAt: now + config.intervalSeconds * 1000 };
  }
  if (next.shown && (now >= next.shown.until || (!next.shown.preview && !next.sites[next.shown.ruleId]))) next.shown = null;
  return next;
}
export function recordDisplay(state, ruleId, tabId, now, duration, interval, token, preview = false) {
  const next = clone(state);
  if (!preview) next.sites[ruleId].dueAt = now + interval * 1000;
  next.shown = { ruleId, tabId, until: now + duration * 1000, token, preview };
  return next;
}
