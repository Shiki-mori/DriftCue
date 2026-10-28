import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, clone } from '../extension/core.js';
let counter = 0;
function event() { const listeners=[];return { addListener:f=>listeners.push(f), fire:(...args)=>listeners.forEach(f=>f(...args)), listeners }; }
async function setup(c = clone(DEFAULTS), initialSession) {
  const local={config:c}, session=initialSession??{}, grant=new Set(c.sites.map(s=>s.domain)), cards=new Map(), pages=new Map(), calls=[];
  const tabs=[{id:1,url:'https://www.bilibili.com/',active:true,windowId:10}];let focused=10;
  const api={
    runtime:{id:'test-extension',getURL:p=>`chrome-extension://test-extension/${p}`,onMessage:event(),onStartup:event()},
    storage:{local:{setAccessLevel:async()=>{},get:async k=>({[k]:clone(local[k])}),set:async o=>Object.assign(local,clone(o))},session:{get:async k=>({[k]:clone(session[k])}),set:async o=>Object.assign(session,clone(o))}},
    permissions:{contains:async({origins})=>grant.has(origins[0].split('://')[1].replace(/^\*\./,'').split('/')[0]),onAdded:event(),onRemoved:event()},
    scripting:{getRegisteredContentScripts:async()=>[],unregisterContentScripts:async()=>{},registerContentScripts:async data=>calls.push(['register',data]),executeScript:async()=>{}},
    alarms:{get:async()=>null,create:async()=>{},onAlarm:event()},
    windows:{getLastFocused:async()=>({id:focused,focused:focused!==null}),onFocusChanged:event()},
    tabs:{query:async()=>clone(tabs),get:async id=>clone(tabs.find(t=>t.id===id)),sendMessage:async(id,m)=>{
      calls.push([id,clone(m)]);const p=pages.get(id)??{visible:tabs.find(t=>t.id===id)?.active??false,fullscreen:false};
      if(m.type==='PROBE')return p;
      if(m.type==='SHOW'){if(p.visible&&!p.fullscreen){cards.set(id,m);return {ok:true};}return {ok:false};}
      if(['HIDE','STOP'].includes(m.type))cards.delete(id);
      return {ok:true};
    },onCreated:event(),onRemoved:event(),onReplaced:event(),onUpdated:event(),onActivated:event()}
  };
  globalThis.chrome=api;
  await import(`../extension/background.js?test=${counter++}`);
  const request=async(type,data={})=>{const r=await new Promise(resolve=>api.runtime.onMessage.listeners[0]({type,...data},{id:api.runtime.id,url:api.runtime.getURL('popup.html')},resolve));if(type==='GET')assert.equal(r.ok,true,r.error);return r;};
  await request('GET');
  return {api,tabs,local,session,grant,cards,pages,calls,request,focus:id=>{focused=id;}};
}
async function clock(t) {
  const previous=Date.now;let now=1000000;Date.now=()=>now;t.after(()=>{Date.now=previous;});return {advance:ms=>{now+=ms;},now:()=>now};
}
test('AC-02 默认连续计时 120/4/240 秒；关闭卡片不推迟下次',async t=>{
  const time=await clock(t), m=await setup();const start=m.session.scheduler.sites.bilibili.dueAt;
  assert.equal(start,time.now()+120000);time.advance(119999);await m.request('GET');assert.equal(m.cards.size,0);
  time.advance(1);await m.request('GET');assert.equal(m.cards.size,1);assert.equal(m.session.scheduler.sites.bilibili.dueAt,start+120000);
  await m.request('DISMISS');assert.equal(m.cards.size,0);assert.equal(m.session.scheduler.sites.bilibili.dueAt,start+120000);
  time.advance(120000);await m.request('GET');assert.equal(m.cards.size,1);
});
test('AC-03/04 后台多标签只保留一次，返回从实际显示起算',async t=>{
  const time=await clock(t),m=await setup();m.tabs[0].active=false;
  m.tabs.push({id:2,url:'https://www.bilibili.com/a',active:false,windowId:10},{id:3,url:'https://other.com',active:true,windowId:10});
  time.advance(600000);await m.request('GET');assert.equal(m.cards.size,0);
  m.tabs[1].active=true;m.tabs[2].active=false;await m.request('GET');assert.deepEqual([...m.cards.keys()],[2]);
  assert.equal(m.session.scheduler.sites.bilibili.dueAt,time.now()+120000);
  await m.request('GET');assert.equal(m.calls.filter(x=>x[1]?.type==='SHOW').length,1);
});
test('AC-05 暂停覆盖同站所有标签，不影响另一个网站',async t=>{
  const time=await clock(t),c=clone(DEFAULTS);c.sites.push({id:'youtube',name:'YouTube',domain:'youtube.com',enabled:true,subdomains:true});
  const m=await setup(c);m.tabs.push({id:2,url:'https://youtube.com',active:false,windowId:10});await m.request('GET');
  await m.request('PAUSE',{tabId:1,minutes:10});time.advance(120000);m.tabs[0].active=false;m.tabs[1].active=true;
  await m.request('GET');assert.deepEqual([...m.cards.keys()],[2]);assert.equal(m.session.scheduler.sites.bilibili,undefined);
});
test('AC-06 到期恢复按绝对时间，提前恢复等待完整间隔',async t=>{
  const time=await clock(t),m=await setup();await m.request('PAUSE',{tabId:1,minutes:1});const until=m.local.config.pauses.bilibili;
  assert.equal(until,time.now()+60000);time.advance(60000);await m.request('GET');assert.equal(m.cards.size,0);assert.equal(m.session.scheduler.sites.bilibili.dueAt,until+120000);
  await m.request('PAUSE',{tabId:1,minutes:1});time.advance(10000);await m.request('RESUME',{tabId:1});assert.equal(m.session.scheduler.sites.bilibili.dueAt,time.now()+120000);
});
test('AC-06/17 新 Worker 从本地暂停和会话时间戳恢复',async t=>{
  const time=await clock(t),c=clone(DEFAULTS);c.pauses.bilibili=time.now()+60000;
  const m=await setup(c);assert.equal(m.session.scheduler.sites.bilibili,undefined);assert.equal(m.local.config.pauses.bilibili,c.pauses.bilibili);
  time.advance(60000+120000);await m.request('GET');assert.equal(m.cards.size,1);
});
test('AC-08/09 保存重置普通计时且保留暂停；非法值不覆盖',async t=>{
  const time=await clock(t),m=await setup();await m.request('PAUSE',{tabId:1,minutes:10});const until=m.local.config.pauses.bilibili;
  const c=clone(m.local.config);c.backgroundColor='#112233';c.intervalSeconds=10;c.durationSeconds=2;
  assert.equal((await m.request('SAVE',{config:c})).ok,true);assert.equal(m.local.config.pauses.bilibili,until);
  const bad=await m.request('SAVE',{config:{...c,intervalSeconds:-1}});assert.equal(bad.ok,false);assert.equal(m.local.config.intervalSeconds,10);assert.equal(m.local.config.backgroundColor,'#112233');
  time.advance(1000);
});
test('AC-12/13 撤回权限立即停止显示并标示权限不足',async t=>{
  const time=await clock(t),m=await setup();time.advance(120000);await m.request('GET');assert.equal(m.cards.size,1);
  m.grant.clear();m.api.permissions.onRemoved.fire({});const r=await m.request('GET');assert.equal(m.cards.size,0);assert.equal(r.current.granted,false);assert.deepEqual(m.session.scheduler.sites,{});
});
test('AC-13 未授权新站点不能虚假保存启用',async t=>{
  await clock(t);const m=await setup();const c=clone(m.local.config);c.sites.push({id:'x',name:'X',domain:'x.com',enabled:true,subdomains:true});
  const result=await m.request('SAVE',{config:c});assert.equal(result.ok,false);assert.match(result.errors.sites,/授权/);assert.equal(m.local.config.sites.length,1);
});
test('已授权的新网站可保存启用，立即为现有标签开始计时',async t=>{
  const time=await clock(t),m=await setup();m.grant.add('youtube.com');m.tabs.push({id:2,url:'https://youtube.com',active:false,windowId:10});
  const c=clone(m.local.config);c.sites.push({id:'youtube',name:'YouTube',domain:'youtube.com',enabled:true,subdomains:true});
  assert.equal((await m.request('SAVE',{config:c})).ok,true);assert.equal(m.session.scheduler.sites.youtube.dueAt,time.now()+120000);
});
test('Chrome 新会话不会补发在完全退出期间已过期的暂停提醒',async t=>{
  const time=await clock(t),c=clone(DEFAULTS);c.pauses.bilibili=time.now()-600000;const m=await setup(c);
  assert.equal(m.cards.size,0);assert.equal(m.session.scheduler.sites.bilibili.dueAt,time.now()+120000);
});
test('AC-14 关闭全局或暂停时主动预览，不改计时或暂停',async t=>{
  await clock(t);const m=await setup();await m.request('PAUSE',{tabId:1,minutes:10});const until=m.local.config.pauses.bilibili;
  assert.equal((await m.request('PREVIEW',{tabId:1})).ok,true);await m.request('GET');assert.equal(m.cards.size,1);assert.equal(m.local.config.pauses.bilibili,until);
  assert.equal(m.session.scheduler.sites.bilibili,undefined);
});
test('AC-14 未配置网页的 activeTab 预览也能保持到期',async t=>{
  await clock(t);const m=await setup();m.tabs[0].url='https://unconfigured.example/';
  assert.equal((await m.request('PREVIEW',{tabId:1})).ok,true);await m.request('GET');assert.equal(m.cards.size,1);assert.deepEqual(m.session.scheduler.sites,{});
});
test('AC-15 关闭最后标签后重新打开等待完整间隔',async t=>{
  const time=await clock(t),m=await setup();m.tabs.length=0;await m.request('GET');time.advance(600000);
  m.tabs.push({id:4,url:'https://bilibili.com/',active:true,windowId:10});await m.request('GET');assert.equal(m.cards.size,0);assert.equal(m.session.scheduler.sites.bilibili.dueAt,time.now()+120000);
});
test('AC-16 仅焦点窗口活动页显示，离开 Chrome 清除',async t=>{
  const time=await clock(t),m=await setup();m.tabs.push({id:2,url:'https://bilibili.com',active:true,windowId:11});
  m.focus(11);time.advance(120000);await m.request('GET');assert.deepEqual([...m.cards.keys()],[2]);m.focus(null);await m.request('GET');assert.equal(m.cards.size,0);
});
test('关闭当前卡片不会误关闭另一个标签页的卡片',async t=>{
  const time=await clock(t),m=await setup();m.tabs.push({id:2,url:'https://bilibili.com',active:false,windowId:10});
  time.advance(120000);await m.request('GET');assert.equal(m.cards.size,1);await m.request('DISMISS',{tabId:2});assert.equal(m.cards.size,1);
});
test('暂停中的主动预览遇到权限撤回仍立即清除',async t=>{
  await clock(t);const m=await setup();await m.request('PAUSE',{tabId:1,minutes:10});await m.request('PREVIEW',{tabId:1});assert.equal(m.cards.size,1);
  m.grant.clear();await m.request('GET');assert.equal(m.cards.size,0);
});
test('已配置但未永久授权的网站仍可用 activeTab 预览完整保持时间',async t=>{
  const time=await clock(t),m=await setup();m.grant.clear();
  assert.equal((await m.request('PREVIEW',{tabId:1})).ok,true);
  time.advance(1000);const r=await m.request('GET');assert.equal(r.current.granted,false);assert.equal(m.cards.size,1);
  time.advance(3000);await m.request('GET');assert.equal(m.cards.size,0);
});
test('AC-17 普通 Worker 挂起恢复不重置，Chrome startup 重置普通计时',async t=>{
  const time=await clock(t),s={scheduler:{sites:{bilibili:{dueAt:time.now()-1}},shown:null}},m=await setup(clone(DEFAULTS),s);
  assert.equal(m.cards.size,1);m.api.runtime.onStartup.fire();await m.request('GET');assert.equal(m.cards.size,0);assert.equal(m.session.scheduler.sites.bilibili.dueAt,time.now()+120000);
});
test('AC-22/25 全屏期间多个周期不显示，预览拒绝，退出仅显示一张',async t=>{
  const time=await clock(t),m=await setup();m.pages.set(1,{visible:true,fullscreen:true});time.advance(600000);await m.request('GET');assert.equal(m.cards.size,0);
  const r=await m.request('PREVIEW',{tabId:1});assert.equal(r.ok,false);assert.match(r.error,/退出视频全屏/);
  m.pages.set(1,{visible:true,fullscreen:false});await m.request('GET');assert.equal(m.cards.size,1);assert.equal(m.calls.filter(x=>x[1]?.type==='SHOW').length,1);
});
test('AC-23/24 进入全屏清卡片不重放，暂停优先于退出全屏',async t=>{
  const time=await clock(t),m=await setup();time.advance(120000);await m.request('GET');const token=m.cards.get(1).token;m.cards.delete(1);m.pages.set(1,{visible:true,fullscreen:true});
  await new Promise(resolve=>m.api.runtime.onMessage.listeners[0]({type:'HIDDEN',token},{id:m.api.runtime.id,tab:m.tabs[0],frameId:0},resolve));
  time.advance(1000);m.pages.set(1,{visible:true,fullscreen:false});await m.request('GET');assert.equal(m.cards.size,0);
  await m.request('PAUSE',{tabId:1,minutes:10});time.advance(120000);await m.request('GET');assert.equal(m.cards.size,0);
});
test('页面来源不能发送配置/暂停/预览等特权指令',async t=>{
  await clock(t);const m=await setup();const r=await new Promise(resolve=>m.api.runtime.onMessage.listeners[0]({type:'GLOBAL',enabled:false},{id:m.api.runtime.id,tab:m.tabs[0],frameId:0},resolve));
  assert.equal(r.ok,false);assert.equal(m.local.config.enabled,true);
});
