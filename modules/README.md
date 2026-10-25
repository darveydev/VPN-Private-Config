# ThreadsHideAds

Threads / Instagram 信息流内置广告过滤（Surge 5 模块 + http-response 脚本）。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `ThreadsHideAds.module` | Surge 模块，声明拦截规则、参数与 MITM 域名 |
| `ThreadsHideAds.js` | 核心过滤脚本，对响应 JSON 做语义化广告识别与摘除 |
| `ThreadsHideAds.test.js` | 自测脚本（`node ThreadsHideAds.test.js`），改规则后跑一遍防止回归 |

## 工作原理

两个平台的信息流都是「GraphQL / REST 返回一大坨 JSON，客户端渲染」。广告不是独立的广告接口，
而是混在信息流数组里的一条普通条目，所以只能从响应体里识别并摘掉。

脚本做四件事：

1. **接口白名单**：只处理 `/api/graphql`、`/graphql/query`、`/api/v1/feed/*`、`/api/v1/clips/*`、
   `/api/v1/text_post_app_timeline` 等信息流接口。登录、评论、消息、上传一律不碰。
2. **响应体特征校验**：必须含 `feed` / `feed_items` / `thread_items` / `edges` 等结构关键字才继续解析，
   避免误伤其它同名接口。
3. **语义化广告识别**（不写死下标、不依赖 doc_id，Meta 改版后仍有效）：
   - 布尔标记：`is_sponsored`、`is_ad`、`is_sponsored_post`、`is_promoted`、`is_brs_ad` …
   - 非空广告 ID：`ad_id`、`advertiser_id`、`ad_click_token`、`ad_tracking_token` …
   - 广告载荷：`brs_ad_data`、`ad_data`、`ad_metadata`、`sponsored_info`、`ad_header`、`ad` …
   - 类型名：`__typename` 命中 `AdPost` / `Sponsored*` / `Promoted*` / `AdUnit` …
   - 类型字段：`product_type` / `item_type` / `feed_item_type` 取值为 `ad`、`sponsored` …
   条目内部任意层级（≤5 层、≤900 节点）命中任一特征即判定为广告，兼容
   `edges[].node.thread_items[].post` 与 `feed_items[].media_or_ad` 等不同嵌套结构。
4. **安全摘除**：只从数组里 `splice` 掉广告元素，不改写、不新增任何字段；
   并保留 `for (;;);` 之类的反劫持前缀。

## 安装

1. 把 `ThreadsHideAds.js` 和 `ThreadsHideAds.module` 放在 **同一目录**（Surge 配置目录）。
2. Surge → 首页 → 模块 → 安装新模块 → 选择 `ThreadsHideAds.module`。
3. 确保 MITM 证书已安装并信任（设置 → MITM → 生成证书 → 安装描述文件 → 系统设置里信任）。
4. 模块参数中打开「启用调试模式」，刷一次信息流，看 Surge 日志出现
   `[ThreadsHideAds] removed N ad item(s)` 即表示生效，之后可关闭调试。

### 脚本托管方式（三选一）

- **本地**（默认）：`script-path=ThreadsHideAds.js`，文件放在 Surge 配置目录即可。
- **远程**：把 JS 上传到 GitHub / Gist，把模块里的 `script-path` 换成 raw 链接，
  例如 `https://raw.githubusercontent.com/<user>/<repo>/main/ThreadsHideAds.js`。
  注意 raw 链接要能被国内网络访问，建议配合加速域名或自建对象存储。
- **局域网**：`python -m http.server 8000` 起个静态服务，
  `script-path=http://192.168.x.x:8000/ThreadsHideAds.js`（仅调试用）。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| 启用调试模式 | 关 | 输出命中 URL 与删除条数，排查用 |
| 仅处理信息流 | **开** | 强烈建议保持开启，否则会波及非信息流 GraphQL |
| 同时屏蔽推荐内容 | 关 | 额外移除 netego（推荐用户 / 推荐帖子 / 探索卡片） |

## 已知限制

- 只处理**返回后**的响应，无法拦截已缓存内容；客户端本地缓存的历史广告需下拉刷新或清缓存。
- 删除条目后不重算 `num_results` / `count` 等计数字段，这通常无害（客户端会继续加载下一页）。
  若某些版本出现「刷不到底」，把调试日志发我，可针对性补计数字段修正。
- 广告识别依赖 Meta 当前字段命名。若某天失效，先开调试模式确认命中情况，
  再把日志里广告条目的原始 JSON 补进 `TRUE_FLAGS` / `ID_KEYS` / `PAYLOAD_KEYS` 即可，
  改完执行 `node ThreadsHideAds.test.js` 验证不回归。
- 内置误杀保护：单次删除超过候选条目 85% 且多于 8 条时整包回滚，宁可漏拦不清空信息流。

## 其它客户端适配

- **Loon**：语法不同，把 `[Script]` 段改成
  `http-response <正则> script-path=..., requires-body=1, max-size=-1, tag=ThreadsAds, argument=...`，
  `[MITM]` 段保留；JS 可直接复用。
- **Quantumult X**：需改写为 `[rewrite_local]` + `[mitm]`，脚本用 `$response.body` / `$done({body})`，
  本脚本已兼容该调用约定，只需删掉 `$argument` 相关分支即可。
