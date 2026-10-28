import { $, request, notice, statusText } from './ui.js';
import { origins } from './core.js';
let snapshot, tabId;
async function refresh(initial = false) {
  snapshot = await request('GET', { tabId }); const { config, current: c } = snapshot; tabId = c.tabId;
  $('#enabled').checked = config.enabled;
  $('#domain').textContent = c.domain || '当前网页'; $('#status').textContent = statusText(c, config.enabled);
  $('#detail').textContent = c.pausedUntil > Date.now() ? `预计 ${new Date(c.pausedUntil).toLocaleString('zh-CN')} 恢复；恢复后等待完整间隔。` : c.rule && !c.granted ? '请授权此规则覆盖的网站后开始提醒。' : c.rule ? '本站所有标签页共用计时。关闭卡片不影响下一次提醒。' : '前往设置添加网站，或在支持的页面立即预览。';
  $('#grant').hidden = !c.rule || c.granted;
  $('#pause').disabled = !c.rule || !c.rule.enabled || !c.granted || !config.enabled;
  $('#resume').hidden = !(c.pausedUntil > Date.now());
  $('#dismiss').disabled = !c.cardVisible;
  $('#preview').disabled = !c.supported;
  if (initial) $('#minutes').value = config.pauseMinutes;
  if (snapshot.lastError) notice(snapshot.lastError, true);
}
const action = work => async () => { try { notice(); await work(); await refresh(); } catch (e) { notice(e.message, true); } };
$('#enabled').addEventListener('change', action(() => request('GLOBAL', { enabled: $('#enabled').checked })));
$('#pause').addEventListener('click', action(async () => {
  const minutes = Number($('#minutes').value);
  $('#minutes-error').textContent = '';
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { $('#minutes-error').textContent = '请输入 1–1440 分钟的整数。'; return; }
  await request('PAUSE', { tabId, minutes }); notice('本站已暂停，其他网站继续提醒。');
}));
$('#resume').addEventListener('click', action(async () => { await request('RESUME', { tabId }); notice('本站已恢复，从完整间隔重新计时。'); }));
$('#dismiss').addEventListener('click', action(() => request('DISMISS', { tabId })));
$('#preview').addEventListener('click', action(async () => { await request('PREVIEW', { tabId }); notice('已预览；普通计时和暂停状态不变。'); }));
$('#grant').addEventListener('click', action(async () => {
  const granted = await chrome.permissions.request({ origins: origins(snapshot.current.rule) });
  notice(granted ? '网站访问已授权，已开始完整间隔计时。' : '授权未完成，本站权限不足。', !granted);
}));
$('#settings').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?tab=${tabId ?? ''}`) }));
refresh(true).catch(e => notice(e.message, true));
// Keep the dismiss button and absolute pause status accurate while the popup stays open.
setInterval(() => { void refresh().catch(e => notice(e.message, true)); }, 1000);
