export const $ = selector => document.querySelector(selector);
export function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
export async function request(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) {
    const error = new Error(result?.error ?? Object.values(result?.errors ?? {}).join(' ') ?? '操作失败。');
    error.fields = result?.errors; throw error;
  }
  return result;
}
export function notice(message = '', bad = false) { const n = $('#notice'); n.textContent = message; n.classList.toggle('bad', bad); }
export function statusText(c, enabled) {
  if (!c.supported) return '当前页面不支持';
  if (!c.rule) return '尚未配置';
  if (!c.granted) return '权限不足';
  if (!enabled) return '全局提醒已关闭';
  if (!c.rule.enabled) return '本站规则已关闭';
  if (c.pausedUntil > Date.now()) return '本站已暂停';
  return '本站已启用';
}
