# VPN 客户端配置仓库

本目录存放三款代理客户端的自用配置，核心目标只有两个：

1. **DNS 防泄露** —— 全链路加密 DNS，不让明文查询和真实出口 IP 泄露给运营商
2. **网络切换免手动** —— Wi-Fi 与移动网络之间切换、断网重连后自动恢复，不需要手动关开 VPN 开关

---

## 目录结构

```
VPN-Private-Config/
├── ClashVerge/                          Clash Verge Rev（Windows，Mihomo 内核）
│   ├── 全局扩展脚本.js                    Script 阶段：DNS + 代理组 + 规则（实际生效的 DNS）
│   ├── 全局扩展覆写配置.yaml              Merge 阶段：TUN + Sniffer + 兜底规则
│   └── ClashVerge-DNS-Leak-Protection.yaml   独立完整 profile（备选方案，勿与上面两个混用）
│
├── FlClash/                             FlClash（Android / Windows，Mihomo 内核）
│   └── FlClash-Private.js               订阅转换脚本
│
└── Shadowrocket/                        Shadowrocket（iOS）
    ├── Full-Final-Config.conf           完整版：全部业务分流
    ├── Mini-Final-Config.conf           精简版：只保留地区分组
    └── Mini-Cellular-WiFi-Config.conf   精简版 + 移动网络/WiFi 切换优化
```

---

## 文件详解

### ClashVerge/

Clash Verge Rev 的配置由两段叠加而成，**执行顺序决定了谁说了算**：

```
机场订阅  →  全局扩展覆写配置.yaml（Merge）
          →  全局扩展脚本.js（Script，最后执行）
```

#### `全局扩展脚本.js` — Script 阶段（991 行）

在 Clash Verge 的「配置 → 全局扩展脚本」中启用。因为最后执行，它对 `dns`、`proxy-groups`、`rules` 做的是**整体替换**，所以**真正生效的 DNS 和规则都在这里**。

| 项目 | 值 |
|---|---|
| DNS 监听 | `0.0.0.0:53` |
| 模式 | `fake-ip`，段 `198.18.0.1/16` |
| bootstrap | `tls://223.5.5.5`、`tls://223.6.6.6`（DoT） |
| 国外域名 | Google / Cloudflare / OpenDNS / Yandex DoH |
| 节点域名 | 国内 DoH 直连（`223.5.5.5`、`doh.pub`） |
| 直连域名 | 国内 DoH 直连，`direct-nameserver-follow-policy: false` |
| `respect-rules` | `true`（国外域名的 DNS 查询走代理，出口与流量一致） |
| `fallback` | 空（有意留空，避免切网瞬间多一条超时路径） |
| 代理组 | 17 个（节点选择 / 业务服务 / 功能分组） |
| 规则 | 66 条（含内嵌的 `baseRules`） |

内置 `baseRules` 段（顺序敏感）：Tailscale 进程与网段豁免 → 本地内网 → `DST-PORT,53 DIRECT` / `DST-PORT,853 REJECT` → DNS 泄露检测站点走代理。

#### `全局扩展覆写配置.yaml` — Merge 阶段（768 行）

负责脚本不处理的运行时参数：

- **TUN**：`stack: mixed`、`auto-route: true`、**`auto-detect-interface: true`**（切网自动重绑的关键）、`strict-route: true`、`dns-hijack: any:53`、`route-exclude-address` 排除 Tailscale 与内网段
- **Sniffer**：从 TLS SNI / HTTP Host / QUIC 还原域名，让纯 IP 连接也能命中分流规则
- **Keep-alive**：`interval` / `idle` 均为 15 秒
- **prepend-proxy-groups / prepend-rules**：插入式补充，共 49 条兜底规则

> 本文件里的 `dns:` 段会被脚本整体覆盖，保留它有两个作用：一是作为可读文档，二是禁用脚本时能独立撑住防泄露。**改 DNS 时以脚本为准，同步改这里。**

#### `ClashVerge-DNS-Leak-Protection.yaml` — 独立备选方案（287 行）

一份自带 `mixed-port` / `mode` / `tun` / `dns` / `rules` 的**完整 profile**，可直接导入为独立配置使用。

它与上面两个文件的方案功能重叠。**二选一，不要同时启用**：

- 用「全局扩展脚本 + 覆写」组合 → 本文件仅作参考
- 只用单一 profile → 导入本文件，关闭全局扩展脚本与覆写

---

### FlClash/

#### `FlClash-Private.js`（1566 行）

FlClash 的订阅转换脚本（Mihomo JS Override）。在 FlClash 的「配置 → 覆写」中挂载，对机场订阅做二次加工。

| 项目 | 值 |
|---|---|
| 混合端口 | `7890`，`mode: rule` |
| IPv6 | `false`（防 IPv6 绕过隧道） |
| `find-process-mode` | `always` |
| Keep-alive | `interval` / `idle` 均 15 秒 |
| TUN | `stack: gvisor`、`auto-route: true`、**`auto-detect-interface: true`**、`strict-route: true`、`mtu: 1280` |
| DNS 劫持 | `0.0.0.0:53` 与 `tcp://0.0.0.0:53` |
| fake-ip 段 | `172.19.0.1/16` |

DNS 采用四层分工：

```
节点域名  →  proxy-server-nameserver   国内 DoH 直连（避免鸡生蛋死锁）
直连域名  →  direct-nameserver         国内 DoH 直连
国内域名  →  nameserver-policy         国内 DoH
国外域名  →  nameserver + fallback     国外 DoH 经代理
污染检测  →  fallback-filter           GeoIP=CN / geosite:gfw / 域名清单
```

代理组与规则**动态生成**，不是静态写死：

- **地区组**：按节点名正则识别 香港 / 台湾 / 日本 / 新加坡 / 韩国 / 美国 / 加拿大 / 英国 / 其他地区，生成 `url-test` 组
- **业务组**：AI、YouTube、Google、GitHub、Netflix、Spotify、Steam、Telegram、TikTok、Apple、Microsoft、网络检测
- **机场原始组**：识别并保留机场的自动选择 / 故障转移 / 全部节点组，自动选择组会转成 `url-test`
- 图标与规则集从 `cdn.jsdelivr.net/gh/n0de-sudo/Perfect-Rules` 拉取

---

### Shadowrocket/

三份配置共用同一套 DNS 分层结构，差别在冗余度、分流精细度与网络参数。`Full-Final` 与 `Mini-Final` 每层配了 2 个 DoH 互为备份，`Mini-Cellular-WiFi` 每层只留 1 个，查询路径更短、切换时更快。

#### 公共 DNS 骨架

| 配置项 | 值 | 作用 |
|---|---|---|
| `proxy-dns-server` | 国内 DoH `#no-h3` | 解析节点域名，直连可达 |
| `dns-server` | Google / Cloudflare DoH `#proxy` | 国外域名，查询走代理 |
| `direct-dns-server` | 国内 DoH `#no-h3` | DIRECT 域名，不经代理 |
| `fallback-dns-server` | Google / Cloudflare DoH `#proxy` | 兜底，仍为加密 DNS |
| `dns-direct-system` | `false` | 禁止回退 iOS 系统 DNS |
| `dns-fallback-system` | `false` | 禁止 fallback 回退系统 DNS |
| `dns-direct-fallback-proxy` | `false` | 直连解析失败时不偷偷走代理 |
| `hijack-dns` | `:53` | 劫持所有明文 DNS |
| `ipv6` / `prefer-ipv6` | `false` | 防 IPv6 绕过 |
| `stun-response-ip` | `0.0.0.0` / `::` | 防 WebRTC 泄露真实 IP |
| `bypass-system` | `false` | 不绕过系统网络栈，切网更稳 |
| `tun-mtu` | `1400` | 移动网络下减少分片丢包 |
| `tcp-keepalive` | `60` | 加速断线发现与重连 |
| `connect-time` | `10` | 快速失败，便于切节点 |
| 规则 | `DST-PORT,53/853/5349 REJECT` | 堵死明文 DNS、DoT、STUN 绕行 |

#### 三份配置对比

| | Full-Final | Mini-Final | Mini-Cellular-WiFi |
|---|---|---|---|
| 行数 | 619 | 301 | 328 |
| 代理组 | 30 | 16 | 16 |
| 规则条数 | 90 | 18 | 18 |
| 业务分流 | 完整 | 仅地区 | 仅地区 |
| Netflix / YouTube / Disney+ / Prime | 有 | 无 | 无 |
| AI / Telegram / Discord / Gaming / X | 有 | 无 | 无 |
| URL Rewrite 条数 | 8 | 8 | 4（部分已注释） |
| Tailscale 规则 | 3 条 | 3 条 | 3 条 |
| 每层 DNS 服务器数 | 2 | 2 | 1 |
| `skip-proxy` 额外放行 | 仅内网基础 | 仅内网基础 | 银行 + 百度 + 163 |
| 注释详细度 | 分组注释 | 分组注释 | 含原理解释 |

**选择建议**

- 日常主力、需要精细分流 → `Full-Final-Config.conf`
- 只想要能上外网、配置越简单越好 → `Mini-Final-Config.conf`
- 经常在 Wi-Fi 与 4G/5G 之间切换、或用于移动办公 → `Mini-Cellular-WiFi-Config.conf`

`Mini-Cellular-WiFi-Config.conf` 的 `skip-proxy` 额外放行了 `*.ccb.com`、`*.abchina.com.cn`、`*.psbc.com` 等银行域名，以及 `*.baidu.com`、`*.163.com`。银行 App 对代理环境极敏感，这条是为了避免被风控。另外两份配置只放行了内网基础段。

---

## 三款客户端横向对比

| | ClashVerge | FlClash | Shadowrocket |
|---|---|---|---|
| 平台 | Windows | Android / Windows | iOS |
| 内核 | Mihomo | Mihomo | 自研 |
| 配置形式 | Merge YAML + JS 脚本 | 订阅转换 JS | 单文件 conf |
| DNS 模式 | fake-ip | fake-ip | 系统级劫持 |
| TUN auto-detect-interface | 有 | 有 | 无此概念（`bypass-system: false` 等效） |
| 防泄露层级 | 三层（respect-rules + 政策 + DoT bootstrap） | 三层（政策 + fallback-filter + DoT bootstrap） | 三层（system 关闭 + 分路 DNS + hijack） |
| 规则动态生成 | 否 | **是**（按节点名识别地区与业务） | 否 |

**共同设计取舍**

- **全部关闭 IPv6**。IPv4/IPv6 双栈时，代理只接管 IPv4，系统却优先走 IPv6 → 流量直接绕过隧道连到 ISP。关掉 IPv6 是根治办法，代价是无法访问纯 IPv6 站点（国内极少）。
- **bootstrap DNS 一律用 DoT/DoH，不用裸 IP 明文**。用 `223.5.5.5` 这种明文做 bootstrap，等于把「你在用哪些加密 DNS」告诉运营商。
- **节点域名一律用国内 DoH 直连**。这是最容易踩的坑：解析节点域名时代理还没建立，若用国外 DoH 会形成死锁，表现为「配置看着没问题但就是连不上节点」。
- **Keep-alive 统一收到 15 秒（Shadowrocket 为 60）**。默认 30 秒在频繁切网场景下反应太慢，会出现「图标显示已连接但实际不通」。

---

## 部署方法

### ClashVerge

1. 「配置」页新建本地配置，导入机场订阅
2. 打开「全局扩展脚本」编辑框，粘贴 `全局扩展脚本.js` 内容并启用
3. 打开「全局扩展覆写配置」编辑框，粘贴 `全局扩展覆写配置.yaml` 内容并启用
4. 「设置 → TUN 模式」核对：启用 ✓、自动路由 ✓、**自动检测接口 ✓**、DNS 劫持 `any:53`
5. 重启内核使配置生效

> 不同版本的 Clash Verge Rev 菜单位置略有差异，脚本与覆写的入口一般在「设置」页或配置卡片右键菜单中。

> 注意：GUI 的 TUN 设置优先级高于 profile，若覆写文件里的 TUN 参数没生效，先在 GUI 里核对。

### FlClash

1. 导入机场订阅
2. 「配置 → 覆写」挂载 `FlClash-Private.js`
3. 开启 TUN 模式
4. 更新订阅使脚本生效

### Shadowrocket

1. 将对应 `.conf` 文件通过 AirDrop 或 iCloud 传到手机
2. 打开 Shadowrocket → 右上角 `+` → 从文件导入
3. 或直接在「配置」页编辑当前配置，粘贴文件内容
4. 首次连接时允许添加 VPN 配置

---

## 验证与排查

### 验证 DNS 防泄露

浏览器打开 `https://www.dnsleaktest.com`（各配置均已把该域名强制走代理）：

- **通过**：检测到的 DNS 服务器归属地与你所选节点一致，看不到国内运营商
- **失败**：出现中国电信/联通/移动的 DNS → 说明明文查询外泄了

再访问 `https://ipleak.net` 或 `https://browserleaks.com/ip`，确认 IP 归属与 DNS 归属一致。

### 常见症状对照

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 显示已连接但所有网站打不开 | 节点域名解析失败（bootstrap 死锁） | Mihomo 查 `proxy-server-nameserver`；Shadowrocket 查 `proxy-dns-server`，都必须是国内 DoH |
| 内核启动直接报错 | `respect-rules: true` 但缺 `proxy-server-nameserver` | Mihomo 专属，补上该项 |
| 网页能开但视频/大文件加载一半卡住 | MTU 过大导致分片丢弃 | ClashVerge 改 `mtu: 1400`；FlClash 已是 1280；Shadowrocket 已是 1400 |
| 任务栏出现「小地球」/ 提示无 Internet | 连通性检测域名被 fake-ip 拦截 | 确认 `fake-ip-filter` 含 `msftconnecttest.com`、`msftncsi.com` |
| 切换 Wi-Fi 后必须手动关开 VPN | 未开接口自动检测，或系统栈旁路 | ClashVerge/FlClash 设 `auto-detect-interface: true`；Shadowrocket 设 `bypass-system = false` |
| 银行 App 提示环境异常 | 流量被代理接管 | Shadowrocket 在 `skip-proxy` 加该银行域名；Mihomo 加 `DOMAIN-SUFFIX` 直连规则 |
| Tailscale 连上但不通 | TUN 抢走了 100.64/10 网段 | Mihomo 查 `route-exclude-address` 与 `PROCESS-NAME`；Shadowrocket 查 `tun-excluded-routes` |
| QQ / 微信快速登录失败 | 登录检测域名拿到 fake-ip | 确认 `fake-ip-filter` 含 `localhost.ptlogin2.qq.com` 等 |
| 配置校验报 `proxy group not found` | 覆写里用了 `proxy-groups` 整体替换 | 改用 `prepend-proxy-groups` |

### 修改前须知

- **ClashVerge 两个文件的 DNS 必须同步改**。改脚本不改覆写，排查时会被执行顺序误导。
- **`nameserver-policy` 的 key 不能逗号拼接**。`"geosite:private,cn"` 是非法写法，必须是两个独立 key。
- **Shadowrocket 的 `#proxy` / `#no-h3` 标记不能省**。`#proxy` 决定 DNS 查询是否走代理，`#no-h3` 避免 QUIC 在切网瞬间失效。
- 涉及 `geoip` / `geosite` / `RULE-SET` 的规则依赖规则集下载，首次使用需等待更新完成。

---

## 免责说明

本仓库仅为个人配置留档，不含任何节点信息、订阅链接或账号凭据。配置需配合自有的合法代理服务使用，请遵守所在地法律法规与服务商条款。
