import { $, el, request, notice } from './ui.js';
import { clone, normalizeDomain, validateConfig, origins, supportedUrl } from './core.js';
let draft, allowed = new Set();
const fields = ['backgroundColor', 'textColor', 'transparency', 'intervalSeconds', 'durationSeconds', 'pauseMinutes'];
function dirty() { $('#dirty').textContent = '有未保存的更改，保存后生效。'; }
function collect() {
  const c = clone(draft);
  for (const f of fields) c[f] = f.endsWith('Color') ? $(`#${f}`).value : Number($(`#${f}`).value);
  c.enabled = $('#enabled').checked;
  c.messages = [...document.querySelectorAll('.message-input')].map(n => n.value);
  return c;
}
function errors(values = {}) {
  document.querySelectorAll('[data-error]').forEach(n => { n.textContent = values[n.dataset.error] ?? ''; });
  $('#global-error').textContent = Object.keys(values).length ? '请修正标记的输入，原有效设置尚未改变。' : '';
}
function checked() { const result = validateConfig(collect()); errors(result.errors); return result; }
function swatch() {
  const c = collect(), rgb = /^#[\da-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor.match(/\w\w/g).map(x => parseInt(x, 16)) : [255,243,205];
  $('#sample').style.backgroundColor = `rgba(${rgb},${1 - Math.max(0, Math.min(100, c.transparency)) / 100})`;
  if (/^#[\da-f]{6}$/i.test(c.textColor)) $('#sample').style.color = c.textColor;
  $('#sample').textContent = c.messages.find(m => m.trim()) ?? '你在做什么呢？';
}
function renderMessages() {
  const list = $('#message-list'); list.replaceChildren();
  draft.messages.forEach((text, i) => {
    const input = el('textarea', { class: 'message-input', value: text, 'aria-label': `提醒文字 ${i + 1}` });
    const count = el('div', { class: 'hint count' }, `${[...text].length}/200`);
    input.addEventListener('input', () => { count.textContent = `${[...input.value].length}/200`; dirty(); swatch(); });
    const remove = el('button', { type: 'button', class: 'quiet danger', 'aria-label': `删除文字 ${i + 1}`, onclick: () => {
      if (draft.messages.length <= 1) { errors({ messages: '至少保留一条有效提醒文字。' }); return; }
      draft = collect(); draft.messages.splice(i, 1); renderMessages(); dirty(); swatch();
    } }, '删除');
    const field = el('div'); field.append(input, count, el('div', { class: 'error', 'data-error': `message-${i}` }));
    const row = el('div', { class: 'message-row' }); row.append(field, remove); list.append(row);
  });
}
function renderSites() {
  const list = $('#site-list'); list.replaceChildren();
  draft.sites.forEach((site, i) => {
    const row = el('div', { class: 'site-row' }), line = el('div', { class: 'row' }), meta = el('div', { class: 'site-meta' });
    meta.append(el('strong', {}, site.name), el('small', {}, `${site.domain}${site.subdomains ? ' · 含子域名' : ' · 仅此域名'}`));
    const badge = el('span', { class: `badge${allowed.has(site.id) ? '' : ' warn'}` }, allowed.has(site.id) ? '已获权限' : '权限不足');
    const toggle = el('input', { type: 'checkbox', checked: site.enabled, 'aria-label': `启用 ${site.name}` });
    toggle.addEventListener('change', () => { site.enabled = toggle.checked; dirty(); });
    const label = el('label', { class: 'check' }); label.append(toggle, document.createTextNode('启用'));
    const grant = el('button', { type: 'button', hidden: allowed.has(site.id), onclick: async () => {
      try {
        const ok = await chrome.permissions.request({ origins: origins(site) });
        if (ok) { allowed.add(site.id); site.enabled = true; renderSites(); dirty(); notice('已授权；点击保存设置后，此规则开始运行。'); }
        else { site.enabled = false; renderSites(); notice('授权未完成，规则保持关闭；可稍后重试。', true); }
      } catch (e) { notice(e.message, true); }
    } }, '授权并启用');
    const remove = el('button', { type: 'button', class: 'quiet danger', 'aria-label': `删除网站 ${site.name}`, onclick: () => { draft.sites.splice(i, 1); renderSites(); dirty(); } }, '删除');
    line.append(meta, badge, label, grant, remove); row.append(line, el('div', { class: 'error', 'data-error': `site-${i}` })); list.append(row);
  });
}
async function refreshTabs() {
  const previous = $('#previewTab').value || new URLSearchParams(location.search).get('tab');
  const tabs = (await chrome.tabs.query({})).filter(t => supportedUrl(t.url));
  $('#previewTab').replaceChildren(...tabs.map(t => el('option', { value: String(t.id) }, `${new URL(t.url).hostname} · ${t.id}`)));
  if (tabs.some(t => String(t.id) === previous)) $('#previewTab').value = previous;
  $('#preview-button').disabled = !tabs.length;
  $('#preview-hint').textContent = tabs.length ? '未列出的网页可先从扩展图标弹窗预览，或配置并授予网站权限。' : '请打开目标网站并授权，或从该网页的扩展弹窗打开设置。';
}
$('#settings-form').addEventListener('input', dirty);
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); notice(); const result = checked(); if (!result.ok) return;
  $('#save').disabled = true;
  try { await request('SAVE', { config: result.config }); draft = result.config; notice('设置已保存。普通提醒从完整间隔重新计时，已有暂停保留。'); $('#dirty').textContent = '所有更改已保存。'; }
  catch (e) { errors(e.fields); notice(e.message, true); }
  finally { $('#save').disabled = false; }
});
$('#add-message').addEventListener('click', () => {
  if (draft.messages.length >= 100) { errors({ messages: '最多 100 条文字，请先删除一条。' }); return; }
  draft = collect(); draft.messages.push(''); renderMessages(); dirty(); $('.message-row:last-child textarea').focus();
});
$('#add-site').addEventListener('click', () => {
  try {
    const site = { id: crypto.randomUUID(), name: $('#siteName').value.trim(), domain: normalizeDomain($('#siteDomain').value), subdomains: $('#siteSubdomains').checked, enabled: false };
    const result = validateConfig({ ...collect(), sites: [...draft.sites, site] });
    const issue = result.errors?.[`site-${draft.sites.length}`]; if (issue) throw new Error(issue);
    draft.sites.push(site); renderSites(); dirty(); $('#site-error').textContent = ''; $('#siteName').value = ''; $('#siteDomain').value = ''; notice('规则已加入草稿；授权、启用后点击保存设置。');
  } catch (e) { $('#site-error').textContent = e.message.includes('Invalid URL') ? '请输入有效域名或完整 HTTP / HTTPS 网址。' : e.message; }
});
document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { $('#siteDomain').value = b.dataset.quick; $('#siteName').value = { 'bilibili.com': 'bilibili', 'youtube.com': 'YouTube', 'x.com': 'X' }[b.dataset.quick]; }));
for (const [picker, text] of [['backgroundPicker', 'backgroundColor'], ['textPicker', 'textColor']]) {
  $(`#${picker}`).addEventListener('input', () => { $(`#${text}`).value = $(`#${picker}`).value; swatch(); });
  $(`#${text}`).addEventListener('input', () => { if (/^#[\da-f]{6}$/i.test($(`#${text}`).value)) $(`#${picker}`).value = $(`#${text}`).value; swatch(); });
}
$('#transparency').addEventListener('input', swatch);
$('#preview-button').addEventListener('click', async () => {
  const result = checked(); if (!result.ok) return;
  const tabId = Number($('#previewTab').value);
  try {
    const tab = await chrome.tabs.update(tabId, { active: true }); await chrome.windows.update(tab.windowId, { focused: true });
    await request('PREVIEW', { tabId, draft: result.config }); notice('网页预览已显示，普通计时与暂停未改变。');
  } catch (e) { errors(e.fields); notice(e.message, true); }
});
$('#refresh-tabs').addEventListener('click', () => refreshTabs().catch(e => notice(e.message, true)));
async function initialize() {
  const result = await request('GET'); draft = clone(result.config); allowed = new Set(result.allowed);
  for (const f of fields) $(`#${f}`).value = draft[f];
  $('#enabled').checked = draft.enabled; $('#backgroundPicker').value = draft.backgroundColor; $('#textPicker').value = draft.textColor;
  renderMessages(); renderSites(); swatch(); await refreshTabs();
  if (result.lastError) notice(result.lastError, true);
}
chrome.permissions.onRemoved.addListener(() => { void request('GET').then(r => { allowed = new Set(r.allowed); renderSites(); }); });
initialize().catch(e => notice(e.message, true));
