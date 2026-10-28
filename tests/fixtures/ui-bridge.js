// HTTP-only UI smoke fixture. This is never packaged with the real extension.
// The visible banner makes it explicit that Chrome permissions/worker are simulated.
import { clone, DEFAULTS, validateConfig } from '/ui/core.js';
const stored = localStorage.getItem('driftcue-ui-fixture');
let config = stored ? JSON.parse(stored) : clone(DEFAULTS);
const allowed = new Set();
function save() { localStorage.setItem('driftcue-ui-fixture',JSON.stringify(config)); }
globalThis.chrome = {
  runtime: {
    getURL: p => `/ui/${p}`,
    sendMessage: async m => {
      if(m.type==='GET') return {ok:true,config:clone(config),allowed:[...allowed],current:{tabId:1,supported:true,domain:'localhost',rule:null,granted:false,cardVisible:false}};
      if(m.type==='SAVE'){const r=validateConfig(m.config);if(!r.ok)return r;config=clone(r.config);save();return {ok:true};}
      if(m.type==='GLOBAL'){config.enabled=m.enabled;save();return {ok:true};}
      if(m.type==='PREVIEW')return {ok:false,error:'这是 HTTP 界面测试模式；实际卡片预览需加载 Chrome 扩展。'};
      return {ok:true};
    }
  },
  permissions: {
    request: async ({origins}) => {
      const domain=origins[0].split('://')[1].replace(/^\*\./,'').split('/')[0];
      return window.confirm(`仅模拟网站权限流程（不会授予真实权限）：${domain}`);
    },
    onRemoved:{addListener:()=>{}}
  },
  tabs:{query:async()=>[{id:1,url:'http://localhost:4173/',active:true,windowId:1}],update:async()=>({windowId:1}),create:async({url})=>{location.href=url;}},
  windows:{update:async()=>{}}
};
const banner=document.createElement('div');banner.textContent='本地 HTTP 界面验收 · Chrome API 为模拟环境 · 不授予真实权限';banner.style.cssText='background:#fff0c8;padding:9px;text-align:center;font-size:12px';document.body.prepend(banner);
