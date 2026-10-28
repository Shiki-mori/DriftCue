let clicks = 0, started = Date.now(), lastCard = null;
const events = [];
function report(kind, data = {}) {
  const event = { kind, at: Date.now(), elapsed: Date.now() - started, host: location.hostname, ...data };
  events.push(event); document.querySelector('#report').textContent = JSON.stringify(events.slice(-30),null,2);
  fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)}).catch(e => console.error('记录失败',e));
}
document.querySelector('#click-layer').addEventListener('click', () => { clicks++;document.querySelector('#counter').textContent=`点击计数：${clicks}`;report('click',{clicks,card:!!document.querySelector('drift-cue-card')}); });
document.querySelector('#fullscreen').addEventListener('click', () => document.querySelector('#full').requestFullscreen().catch(e=>report('error',{message:e.message})));
document.querySelector('#exit').addEventListener('click', () => document.exitFullscreen());
document.addEventListener('fullscreenchange',()=>report('fullscreen',{active:!!document.fullscreenElement}));
document.addEventListener('visibilitychange',()=>report('visibility',{visible:!document.hidden}));
document.querySelector('#reset').addEventListener('click',()=>{events.length=0;started=Date.now();report('reset');});
document.querySelector('#default-run').addEventListener('click',()=>{events.length=0;started=Date.now();report('default-start');});
new MutationObserver(() => {
  const card = document.querySelector('drift-cue-card');
  if (card && card !== lastCard) { const r=card.getBoundingClientRect(); report('show',{rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},pointerEvents:getComputedStyle(card).pointerEvents,focus:document.activeElement?.id ?? '',fullscreen:!!document.fullscreenElement}); }
  else if (!card && lastCard) report('hide');
  lastCard=card;
}).observe(document.documentElement,{childList:true,subtree:true});
report('loaded');
