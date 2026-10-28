import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
function setup() {
  const events=new Map(), notifications=[],timers=new Map();let id=0;
  const listen=(key,f)=>{if(!events.has(key))events.set(key,[]);events.get(key).push(f);};
  const elements=[];
  function create(tag) {
    const style={setProperty(k,v){this[k]=v;}};
    const node={tagName:tag,style,children:[],attrs:{},setAttribute(k,v){this.attrs[k]=v;},append(...ns){this.children.push(...ns);},remove(){node.removed=true;},attachShadow({mode}){node.mode=mode;node.shadow={children:[],append(...ns){this.children.push(...ns);}};return node.shadow;},getBoundingClientRect(){return {width:Math.min(280,Number.parseFloat(style['max-width'])||280),height:Math.min(100,Number.parseFloat(style['max-height'])||100)};}};
    elements.push(node);return node;
  }
  const document={hidden:false,fullscreenElement:null,createElement:create,documentElement:{append:n=>{n.appended=true;}},addEventListener:listen};
  const context={document,innerWidth:1000,innerHeight:700,Date,Math,console,setTimeout:(f,ms)=>{const n=++id;timers.set(n,{f,ms});return n;},clearTimeout:n=>timers.delete(n)};
  context.window=context;context.top=context;context.addEventListener=listen;
  let handler;
  context.chrome={runtime:{sendMessage:async m=>{notifications.push(m);return {ok:true};},onMessage:{addListener:f=>{handler=f;}}}};
  vm.createContext(context);vm.runInContext(source,context);
  const send=m=>{let result;handler(m,{},r=>{result=r;});return result;};
  const show=(config={})=>send({type:'SHOW',token:'token',text:'<script>alert(1)</script>\n😀',config:{backgroundColor:'#FFF3CD',textColor:'#222222',transparency:50,durationSeconds:4,...config}});
  return {context,document,elements,timers,notifications,send,show,fire:key=>events.get(key)?.forEach(f=>f()),host:()=>elements.filter(n=>n.tagName==='drift-cue-card'&&!n.removed).at(-1)};
}
test('AC-07/18/19/20 文案纯文本、封闭 Shadow DOM、背景独立透明且无可操作控件',()=>{
  const m=setup();assert.equal(m.show().ok,true);const host=m.host();assert.equal(host.mode,'closed');assert.equal(host.attrs['aria-hidden'],'true');
  assert.match(host.style.cssText,/pointer-events:none!important/);assert.match(host.style.cssText,/position:fixed!important/);
  assert.equal(host.shadow.children[1].textContent,'<script>alert(1)</script>\n😀');assert.equal(host.shadow.children[1].children.length,0);
  assert.match(host.shadow.children[0].textContent,/rgba\(255,243,205,0.5\)/);assert.match(host.shadow.children[0].textContent,/color:#222222/);
  for(const [t,a] of [[0,1],[50,0.5],[100,0]]){m.show({transparency:t});assert.ok(m.host().shadow.children[0].textContent.includes(`rgba(255,243,205,${a})`));}
});
test('AC-11 卡片在窄视口内完整显示，resize 后重新约束位置',()=>{
  const m=setup();m.context.innerWidth=180;m.context.innerHeight=90;m.show();let h=m.host();
  const within=()=>{const r=h.getBoundingClientRect(),x=parseFloat(h.style.left),y=parseFloat(h.style.top);assert.ok(x>=0&&y>=0);assert.ok(x+r.width<=m.context.innerWidth+.01);assert.ok(y+r.height<=m.context.innerHeight+.01);};
  within();m.context.innerWidth=100;m.context.innerHeight=50;m.fire('resize');within();
});
test('AC-02 自动消失由内容脚本执行，不等待 Worker 醒来',()=>{
  const m=setup();m.show();const timer=[...m.timers.values()].find(t=>t.ms===4000);assert.ok(timer);timer.f();assert.equal(m.host(),undefined);assert.ok(m.notifications.some(n=>n.type==='HIDDEN'&&n.token==='token'));
});
test('AC-12/23 隐藏/进入全屏即清除，退出不重放旧卡片',()=>{
  const m=setup();m.show();m.document.hidden=true;m.fire('visibilitychange');assert.equal(m.host(),undefined);
  m.document.hidden=false;m.show();m.document.fullscreenElement={};m.fire('fullscreenchange');assert.equal(m.host(),undefined);
  m.document.fullscreenElement=null;m.fire('fullscreenchange');assert.equal(m.host(),undefined);
});
test('AC-25 全屏时拒绝 SHOW，退出不会补发预览',()=>{
  const m=setup();m.document.fullscreenElement={};assert.equal(m.show().ok,false);assert.equal(m.host(),undefined);m.document.fullscreenElement=null;m.fire('fullscreenchange');assert.equal(m.host(),undefined);
});
test('重复初始化不会增加消息处理器或重复卡片',()=>{
  const m=setup();const chrome=m.context.chrome;let count=0;chrome.runtime.onMessage.addListener=()=>count++;vm.runInContext(source,m.context);assert.equal(count,0);
  m.show();m.show();assert.equal(m.elements.filter(n=>n.tagName==='drift-cue-card'&&!n.removed).length,1);
});
test('后台与全屏不设置到期计时器；恢复通过 TICK 判断绝对到期',()=>{
  const m=setup();m.document.hidden=true;m.send({type:'PLAN',dueAt:Date.now()+10000});assert.equal(m.timers.size,0);
  m.document.hidden=false;m.fire('visibilitychange');assert.ok([...m.timers.values()].some(t=>t.ms<=10000&&t.ms>0));assert.ok(m.notifications.some(n=>n.type==='TICK'));
});
