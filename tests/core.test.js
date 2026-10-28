import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, clone, normalizeDomain, matches, supportedUrl, ruleForUrl, origins, validateConfig, hydrate, randomMessage, reconcile, recordDisplay } from '../extension/core.js';
const config = () => clone(DEFAULTS);
test('AC-01 默认仅 bilibili、120/4 秒、50%、10 分钟与默认文字', () => {
  const c = config(); assert.equal(c.sites.length,1);assert.equal(c.sites[0].domain,'bilibili.com');
  assert.deepEqual([c.intervalSeconds,c.durationSeconds,c.transparency,c.pauseMinutes],[120,4,50,10]);
  assert.deepEqual(c.messages,['你在做什么呢？']);assert.equal(validateConfig(c).ok,true);
});
test('AC-10 规范化网址、子域名及伪域名边界', () => {
  assert.equal(normalizeDomain(' HTTPS://WWW.BILIBILI.COM/video/a?b=1 '),'www.bilibili.com');
  const s = config().sites[0];for(const d of ['bilibili.com','www.bilibili.com','live.bilibili.com']) assert.ok(matches(d,s));
  for(const d of ['fakebilibili.com','bilibili.com.example.org','youtube.com']) assert.equal(matches(d,s),false);
  assert.equal(matches('www.bilibili.com',{...s,subdomains:false}),false);
});
test('拒绝不支持协议、凭据、无效域名及空输入', () => {
  for(const raw of ['', 'abc def', 'file:///test','ftp://x.com','https://user:pass@x.com','https://-x.com','https://x..com','https://[::1]']) assert.throws(()=>normalizeDomain(raw));
});
test('支持普通网页，拒绝浏览器/商店/扩展页面', () => {
  for(const u of ['https://bilibili.com/','http://localhost:4173']) assert.ok(supportedUrl(u));
  for(const u of [undefined,'chrome://settings','file:///x','chrome-extension://abc/x','https://chromewebstore.google.com/detail/x','https://chrome.google.com/webstore/x']) assert.equal(supportedUrl(u),false);
  assert.equal(ruleForUrl('https://live.bilibili.com/a',config()).id,'bilibili');
});
test('网站权限只请求目标域名，子域名可选', () => {
  assert.deepEqual(origins(config().sites[0]),['http://*.bilibili.com/*','https://*.bilibili.com/*']);
  assert.deepEqual(origins({domain:'127.0.0.1',subdomains:true}),['http://127.0.0.1/*','https://127.0.0.1/*']);
});
test('AC-09 参数范围、整数与间隔关系均拒绝非法输入', () => {
  for(const [key,value] of [['intervalSeconds',9],['intervalSeconds',7201],['durationSeconds',0],['durationSeconds',61],['durationSeconds',120],['transparency',-1],['transparency',101],['pauseMinutes',0],['pauseMinutes',1441],['intervalSeconds',10.5],['backgroundColor','red']]) {
    const c=config();c[key]=value;assert.equal(validateConfig(c).ok,false,`${key}=${value}`);
  }
});
test('文案按 Unicode 字符计数、保留换行、拒绝空白和超限', () => {
  for(const messages of [[],[' \n '],['😀'.repeat(201)],Array(101).fill('a')]) assert.equal(validateConfig({...config(),messages}).ok,false);
  const messages=['😀'.repeat(200),'第一行\n第二行','<img src=x onerror=alert(1)>'];
  assert.deepEqual(validateConfig({...config(),messages}).config.messages,messages);
});
test('父子覆盖、重复名称/域名拒绝；互不覆盖的规则允许', () => {
  const c=config(); const base={id:'two',name:'two',domain:'youtube.com',subdomains:true,enabled:false};
  for(const addition of [{...base,domain:'live.bilibili.com'},{...base,domain:'bilibili.com'},{...base,name:'bilibili'},{...base,id:'bilibili'}]) assert.equal(validateConfig({...c,sites:[...c.sites,addition]}).ok,false);
  assert.equal(validateConfig({...c,sites:[...c.sites,base]}).ok,true);
});
test('配置升级补充默认字段，不重置已有设置与暂停', () => {
  const c=hydrate({backgroundColor:'#123456',pauses:{bilibili:999999}});
  assert.equal(c.intervalSeconds,120);assert.equal(c.backgroundColor,'#123456');assert.equal(c.pauses.bilibili,999999);
});
test('无效历史配置不被静默重置', () => {assert.throws(()=>hydrate({intervalSeconds:-1}));});
test('AC-07 每个文案等宽概率区间，允许重复', () => {
  const m=['a','b','c']; const counts=[0,0,0];
  for(let i=0;i<3000;i++) counts[m.indexOf(randomMessage(m,()=>i/3000))]++;
  assert.deepEqual(counts,[1000,1000,1000]);assert.equal(randomMessage(m,()=>0.4),'b');assert.equal(randomMessage(m,()=>0.4),'b');
});
test('AC-02/04/15 站点计时与标签数无关，最后标签关闭即清除', () => {
  const c=config(), open=new Set(['bilibili']), allowed=new Set(['bilibili']);
  let s=reconcile(null,c,open,allowed,1000);assert.equal(s.sites.bilibili.dueAt,121000);
  s=reconcile(s,c,open,allowed,10000);assert.equal(s.sites.bilibili.dueAt,121000);
  s=reconcile(s,c,new Set(),allowed,15000);assert.deepEqual(s.sites,{});
  s=reconcile(s,c,open,allowed,20000);assert.equal(s.sites.bilibili.dueAt,140000);
});
test('AC-03/17 后台多周期与睡眠仅保留一次，实际显示重新起算', () => {
  const c=config(), ids=new Set(['bilibili']);let s=reconcile(null,c,ids,ids,1000);
  s=reconcile(s,c,ids,ids,900000);assert.equal(s.sites.bilibili.dueAt,121000);
  s=recordDisplay(s,'bilibili',5,900001,4,120,'token');assert.equal(s.sites.bilibili.dueAt,1020001);
  assert.equal(s.shown.until,904001);
});
test('AC-14/21 预览和关闭不改变普通到期时间', () => {
  const c=config(), ids=new Set(['bilibili']);const s=reconcile(null,c,ids,ids,0);
  const p=recordDisplay(s,'bilibili',1,5000,4,120,'p',true);assert.equal(p.sites.bilibili.dueAt,120000);p.shown=null;assert.equal(p.sites.bilibili.dueAt,120000);
});
test('AC-05 暂停隔离；禁用/撤权优先于到期', () => {
  const c=config();c.sites.push({id:'youtube',name:'YouTube',domain:'youtube.com',enabled:true,subdomains:true});
  const ids=new Set(['bilibili','youtube']);let s=reconcile(null,c,ids,ids,0);
  c.pauses.bilibili=600000;s=reconcile(s,c,ids,ids,130000);
  assert.equal(s.sites.bilibili,undefined);assert.equal(s.sites.youtube.dueAt,120000);
  s=reconcile(s,c,ids,new Set(),130001);assert.deepEqual(s.sites,{});
});
