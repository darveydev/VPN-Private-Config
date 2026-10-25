# ThreadsHideAds

Threads / Instagram 信息流内置广告过滤（Surge 5 模块 + http-response 脚本）。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `ThreadsHideAds.module` | Surge 模块，声明拦截规则、参数与 MITM 域名 |
| `ThreadsHideAds.js` | 核心过滤脚本，对响应 JSON 做语义化广告识别与摘除 |
| `ThreadsHideAds.test.js` | 自测脚本（`node ThreadsHideAds.test.js`，24 项用例），改规则后跑一遍防止回归 |

## v2 关键修复

v1 的模块写了 `max-size=0`。Surge 的 `max-size` 是**缓冲上限字节数**（默认 iOS 1 MB / macOS 10 MB），
`-1` 才表示不限制。设成 `0` 等于「只允许缓冲 0 字节」，任何非空响应都会被判为超限 →
**脚本被跳过、响应原样放行**。所以 v1 实际上一条广告都没拦到过（Threads 也一样，只是不易察觉）。

v2 已改为 `max-size=4194304`（4 MB），足够覆盖信息流响应，同时避免 iOS 网络扩展内存超限。

## 工作原理

两个平台的信息流都是「GraphQL / REST 返回一大坨 JSON，客户端渲染」。广告不是独立的广告接口，
而是混在信息流数组里的一条普通条目，所以只能从响应体里识别并摘掉。

脚本做四件事：

1. **接口白名单**：只处理 `/api/graphql`、`/graphql/query`、`/api/v1/feed/*`、`/api/v1/clips/*`、
   `/api/v1/text_post_app_timeline` 等信息流接口。登录、评论、消息、上传一律不碰。
2. **响应体特征校验**：必须含 `feed` / `feed_items` / `thread_items` / `edges` / `xdt_api` 等结构关键字才继续解析。
3. **语义化广告识别**（不写死下标、不依赖 doc_id）：
   - 布尔标记：`is_sponsored`、`is_ad`、`is_sponsored_post`、`is_promoted`、`is_brs_ad`、`is_paid_partnership` …
   - 非空 ID：`ad_id`、`advertiser_id`、`ad_campaign_id`、`ad_click_token`、`ad_tracking_token` …
   - 广告文案字段：`sponsored_label`、`sponsored_by`、`advertiser_name`、`ad_title` …
   - 广告载荷对象：`brs_ad_data`、`ad_data`、`ad_metadata`、`sponsored_info`、`ad_header`、`ad` …
   - `__typename`：大小写敏感匹配 `Ad` / `AdPost` / `AdUnit` / `Sponsored*` / `Promoted*` / `BRSAd*`
     （刻意避开 `MediaDict`、`LoadMore` 这类含 `ad` 字母的干扰项）
   - 类型字段：`product_type` / `item_type` / `feed_item_type` 取值为 `ad`、`sponsored`、`ig_ad` …
   条目内部任意层级（≤6 层、≤2400 节点）命中任一特征即判定为广告，兼容
   `edges[].node.thread_items[].post`、`feed_items[].media_or_ad`、
   `data.xdt_api__v1__feed__timeline__connection.edges[].node` 三种主流结构。
4. **安全摘除**：只从数组里 `splice` 掉广告元素，不改写、不新增任何字段；保留 `for (;;);` 反劫持前缀。

## 安装

1. 把 `ThreadsHideAds.js` 和 `ThreadsHideAds.module` 放在 **同一目录**（Surge 配置目录）。
2. Surge → 首页 → 模块 → 安装新模块 → 选择 `ThreadsHideAds.module`。
3. 确保 MITM 证书已安装并信任（设置 → MITM → 生成证书 → 安装描述文件 → 系统设置里信任）。
4. 打开「启用调试模式」，刷一次信息流，日志出现 `removed N ad item(s) / candidates M` 即生效，之后可关闭。

### 脚本托管方式（三选一）

- **本地**（默认）：`script-path=ThreadsHideAds.js`，文件放在 Surge 配置目录即可。
- **远程**：把 JS 上传到 GitHub / Gist，把模块里的 `script-path` 换成 raw 链接。
- **局域网**：`python -m http.server 8000` 起静态服务，`script-path=http://192.168.x.x:8000/ThreadsHideAds.js`（仅调试用）。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| 启用调试模式 | 关 | 输出命中 URL 与删除条数 |
| 仅处理信息流 | **开** | 强烈建议保持开启 |
| 同时屏蔽推荐内容 | 关 | 额外移除 netego（推荐用户 / 推荐帖子 / 探索卡片） |
| 诊断未知广告字段 | 关 | 输出「字段名像广告但没被识别」的键路径，用于补齐规则 |

## 排障：还有广告漏过怎么办

按顺序检查，基本能定位到原因：

1. **日志完全没有 `[ThreadsHideAds]` 输出** → 脚本没跑起来。检查：MITM 证书是否信任、
   `script-path` 文件是否存在、`max-size` 是否为 -1 或足够大。
2. **日志只有 `skip: not a feed endpoint`** → 该请求不在白名单。把完整 URL 发我，加进 `FEED_PATTERNS`。
3. **日志只有 `skip: body has no feed hint`** → 响应不是信息流 JSON（可能是 HTML 首屏或其它接口）。
4. **日志有 `removed N` 但广告还在** → 说明广告来自**另一个接口**（比如广告详情页、Reels 单页）。
   在 Surge「请求记录」里搜那次请求，看它命中的 URL，发我。
5. **有广告但 `removed 0`** → 打开「诊断未知广告字段」，日志会打出
   `edges[3].node.xxx_ad_xxx = ...` 这类键路径，把那几行发我即可精准补进特征库。

> 提示：Surge 对同一响应**只会执行配置中靠前的第一个**匹配的 http-response 脚本。
> 如果同时装了其它针对 instagram.com 的脚本，请把本模块排到前面，否则可能被抢占。

## 已知限制

- 只处理**返回后**的响应，客户端本地缓存的历史广告需下拉刷新或清缓存。
- 删除条目后不重算 `num_results` / `count` 等计数字段，通常无害（客户端会继续加载下一页）。
- **网页首屏 SSR 的 HTML 不做处理**。Instagram / Threads 网页首次加载时，前几条帖子是直接嵌在 HTML 里的；
  脚本只处理 XHR 的 JSON。若首屏出现广告，下拉刷新一次即可（刷新走的是 JSON 接口）。
  之所以不解析 HTML：`JSON.parse` 会把 128 位广告 ID 这类大整数转成 double 丢精度，回写可能损坏页面。
- 广告识别依赖 Meta 当前字段命名。若某天失效，走上面的「排障」第 5 步。
- 内置误杀保护：单次删除超过信息流候选条目 85% 且多于 8 条时整包回滚。

## 其它客户端适配

- **Loon**：把 `[Script]` 段改成
  `http-response <正则> script-path=..., requires-body=1, max-size=-1, tag=ThreadsAds, argument=...`；
  `[MITM]` 保留；JS 可直接复用。
- **Quantumult X**：改写为 `[rewrite_local]` + `[mitm]`，脚本本身已兼容 `$response.body` / `$done({body})` 约定。
