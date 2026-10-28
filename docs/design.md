# 实现设计与决定

## 模块

- `core.js`：默认配置、规范化、域名边界、有效值校验、等概率抽取、纯调度状态转换。
- `background.js`：唯一串行调度入口、权限/动态内容脚本注册、标签和窗口协调、持久化与 UI 消息。所有状态写入经 Promise 队列，避免多标签同时触发重复提醒。
- `content.js`：顶层页面内单例、封闭 Shadow DOM、随机位置和视口约束、自动消失、可见性/全屏事件、到期通知。卡片 DOM 只使用 `textContent`，设置内联重要样式和 `pointer-events:none`，不插入可聚焦控件。
- `popup` / `options`：本地扩展页面，静态 HTML/CSS 和本地 ES modules，无远程代码。保存前前后端双重校验，字段错误保留输入和上次有效配置。

## 调度

`storage.local.config` 保存设置、规则和暂停绝对截止时间；`storage.session.scheduler` 保存规则 `dueAt` 和当前卡片的 token、目标标签与绝对失效时间。会话存储不会跨 Chrome/扩展新会话保留，但可跨 Worker 挂起恢复。

`dueAt <= Date.now()` 表示一条待显示提醒，不累计次数。显示成功后，`dueAt = 实际显示时刻 + 间隔`。同站的所有标签共用规则 ID；关闭最后一页、禁用或权限撤回清除该规则普通状态。预览不更改 `dueAt`，暂停独立保存，不因外观保存丢失。

前台内容脚本使用一次性 `setTimeout` 通知精确到期，自动消失也由页面执行。后台以每 30 秒 Chrome alarm 检查恢复，并监听导航、标签切换、窗口焦点、权限事件。恢复时读取绝对时间，不依赖 Worker 的常驻内存计时器。页面隐藏/全屏时不设置前台到期 timer；返回事件立即核查待显示状态。

本轮显示后若中断，下一到期时间不改变。全屏只影响显示资格。F11 不产生 `document.fullscreenElement`，按普通网页处理。暂停到期仍有网站标签时，从原绝对恢复点计算完整间隔；完全退出浏览器期间已过期的暂停在新会话中不产生旧周期补发。

## 权限与数据最小化

必需权限为 `storage`、`alarms`、`scripting` 和 `activeTab`。没有 `tabs`、`history`、`cookies`、网络拦截或调试权限。`tabs` API 查询只使用 Chrome 对已授权主机/临时 activeTab 公开的 URL，在内存中匹配；不持久化完整 URL、页面标题、正文或浏览历史。

可选主机范围声明 HTTP/HTTPS，以支持用户自选域名；实际授权通过明确按钮按单个规则的精确/通配子域名主机模式申请。拒绝不误报成功，新增未授权规则不能保存为启用。权限被撤回时停止运行，保留用户规则以供重新授权。

内容脚本不读取整个设置存储；local 限制为 TRUSTED_CONTEXTS，只收到显示需要的文字和外观。消息按扩展来源区分；页面内容脚本只可通知状态，不能保存设置、暂停网站或发起预览。没有 externally_connectable 入口。

## 参考依据

- [Chrome Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)：设备睡眠不被唤醒，恢复时检查到期；检查 alarm 是否仍存在。
- [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)：按主机授权注册和注入顶层内容脚本。
- [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)：在用户手势中申请可选网站权限。

## 明确限制

域名规则不包含正则/路径，首版不支持 IPv6 字面地址；支持普通域名、IDN（由 URL 转为 punycode）、IPv4 和 localhost。不推断别名或公共后缀归属。随机位置不识别字幕/控件。页面可读取卡片 DOM 的存在，不承诺对宿主页面保密。
