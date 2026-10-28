// Test-only instrumentation retains a reference to the still-closed shadow root.
// This file is not part of the installed extension.
let listener, root;
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  const result = attachShadow.call(this, options);
  if (this.localName === 'drift-cue-card') root = result;
  return result;
};
globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: fn => { listener = fn; } } } };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function send(message) { let result; listener(message, {}, reply => { result = reply; }); return result; }
function show(durationSeconds = 4) {
  return send({ type: 'SHOW', token: crypto.randomUUID(), text: '你在做什么呢？', config: { backgroundColor: '#FFF3CD', textColor: '#222222', transparency: 50, durationSeconds } });
}
document.querySelector('#show').addEventListener('click', () => show());
document.querySelector('#hide').addEventListener('click', () => send({ type: 'HIDE' }));
document.querySelector('#run').addEventListener('click', async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) throw new Error(name); };
  try {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const duration of [1, 4, 60]) {
      check(`显示 ${duration} 秒卡片`, show(duration).ok);
      await frame();
      const card = root.querySelector('div'), animation = card.getAnimations()[0];
      if (reduced) {
        check('减少动态效果时不播放动画', !animation && getComputedStyle(card).opacity === '1');
      } else {
        check('浏览器实际生成淡化动画', !!animation);
        animation.pause();
        const opacityAt = async time => { animation.currentTime = time; await frame(); return Number(getComputedStyle(card).opacity); };
        const samples = [];
        for (const time of [0, 90, 250, duration * 500, duration * 1000 - 110, duration * 1000]) samples.push(await opacityAt(time));
        check('淡入、保持、淡出透明度正确', samples[0] === 0 && samples[1] > 0 && samples[1] < 1 && samples[2] === 1 && samples[3] === 1 && samples[4] > 0 && samples[4] < 1 && samples[5] === 0, { duration, samples });
        check('总时长等于配置保持时间', animation.effect.getTiming().duration === duration * 1000);
      }
      check('背景透明度和文字颜色独立保留', getComputedStyle(card).backgroundColor === 'rgba(255, 243, 205, 0.5)' && getComputedStyle(card).color === 'rgb(34, 34, 34)');
      const host = document.querySelector('drift-cue-card');
      check('整个卡片点击穿透', getComputedStyle(host).pointerEvents === 'none' && getComputedStyle(card).pointerEvents === 'none');
      send({ type: duration === 4 ? 'STOP' : 'HIDE' });
      check('中断立即移除，无淡出等待或残留', !document.querySelector('drift-cue-card'));
    }
    document.querySelector('#report').textContent = JSON.stringify({ ok: true, reducedMotion: reduced, results }, null, 2);
  } catch (error) {
    send({ type: 'HIDE' });
    document.querySelector('#report').textContent = JSON.stringify({ ok: false, error: error.message, results }, null, 2);
  }
});
