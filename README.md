# VPN-Private-Config

面向 **Shadowrocket、Clash Verge Rev、FlClash** 的个人代理配置与网络工具仓库。配置重点是 DNS 分流与隐私保护、国内外流量分流、网络切换稳定性，以及 Tailscale 等组网工具的兼容性。

> 本仓库提供的是可自行审阅和修改的配置模板，不提供代理节点、订阅服务或账号凭据。不同客户端版本、系统版本、网络环境和机场订阅均可能影响实际行为；请先备份原配置，再按需启用并验证。

<p align="center">
  <a href="https://github.com/darveydev/VPN-Private-Config">GitHub Repository</a> ·
  <a href="https://github.com/darveydev/VPN-Private-Config/tree/main/Shadowrocket">Shadowrocket</a> ·
  <a href="https://github.com/darveydev/VPN-Private-Config/tree/main/ClashVerge">Clash Verge</a> ·
  <a href="https://github.com/darveydev/VPN-Private-Config/tree/main/FlClash">FlClash</a> ·
  <a href="https://github.com/darveydev/VPN-Private-Config/tree/main/modules">Modules</a>
</p>

## 功能概览

- **DNS 分流**：区分代理节点域名、国内直连域名和海外域名的解析路径，尽量避免 DNS 查询意外绕过代理。
- **规则分流**：按地区、应用服务和网络类型组织代理策略，兼顾国内直连与海外访问。
- **网络稳定性**：针对 Wi-Fi / 蜂窝网络切换、连接保活、MTU 和 QUIC 等场景提供可调整参数。
- **Tailscale 兼容**：为 Tailscale 地址段、域名或进程预留规则/路由例外；具体行为取决于客户端和当前配置。
- **可选模块**：提供 Surge 的 Threads / Instagram 信息流广告过滤模块及配套脚本。

## 快速选择

| 使用场景 | 推荐入口 | 说明 |
|---|---|---|
| iPhone / iPad 日常使用，想从当前维护的轻量配置开始 | [Mini-Net-Enhanced.conf](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/Shadowrocket/Mini-Net-Enhanced.conf) | Shadowrocket 精简分流配置，包含 DNS、地区代理组、基础规则和网络参数 |
| iOS，需要较完整的流媒体 / AI / 社交服务分流 | [Full-Final-Config.conf](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/Shadowrocket/Full-Final-Config.conf) | 业务策略组较丰富；使用前检查策略组中的节点名称是否与你的订阅匹配 |
| iOS，偏好较精简的地区策略 | [Mini-Final-Config.conf](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/Shadowrocket/Mini-Final-Config.conf) | 精简策略组版本 |
| iOS，经常在 Wi-Fi 与蜂窝网络间切换 | [Mini-Cellular-WiFi-Config.conf](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/Shadowrocket/Mini-Cellular-WiFi-Config.conf) | 面向移动网络切换场景的配置变体 |
| Windows，使用 Clash Verge Rev | [ClashVerge 目录](https://github.com/darveydev/VPN-Private-Config/tree/main/ClashVerge) | 通常使用全局扩展脚本与覆写配置组合 |
| Android / Windows，使用 FlClash | [FlClash-Private.js](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/FlClash/FlClash-Private.js) | Mihomo JS Override / 订阅覆写脚本 |
| Surge，过滤 Threads / Instagram 信息流广告 | [modules 目录](https://github.com/darveydev/VPN-Private-Config/tree/main/modules) | 需要按模块说明配置脚本路径与 MITM |

**注意：** Shadowrocket 目录中还保留了其他历史版本、测试版本和备份文件。除非你明确知道它们的用途，否则优先从上表入口开始，不要把多个完整配置叠加导入。

## 仓库结构

```text
VPN-Private-Config/
├── ClashVerge/
│   ├── 全局扩展脚本.js
│   ├── 全局扩展覆写配置.yaml
│   └── ClashVerge-DNS-Leak-Protection.yaml
│
├── FlClash/
│   └── FlClash-Private.js
│
├── Shadowrocket/
│   ├── Mini-Net-Enhanced.conf
│   ├── Mini-Net-Enhanced.bak.conf
│   ├── Mini-Net-Config.conf
│   ├── Mini-DualNet-Config.conf
│   ├── Mini-Final-Config.conf
│   ├── Mini-Final-Config-Test.conf
│   ├── Mini-FinalNet-Config.conf
│   ├── Mini-Cellular-WiFi-Config.conf
│   ├── Full-Final-Config.conf
│   ├── Full-Net-Enhanced.conf
│   └── Mini-iPad-Final-Config.conf
│
├── modules/
│   ├── README.md
│   ├── ThreadsHideAds.module
│   ├── ThreadsHideAds.js
│   └── ThreadsHideAds.test.js
│
└── README.md
```

## 各客户端配置说明

### 1. Shadowrocket（iOS / iPadOS）

配置文件位于 [Shadowrocket](https://github.com/darveydev/VPN-Private-Config/tree/main/Shadowrocket)。

主要配置系列：

| 文件 | 定位 |
|---|---|
| `Mini-Net-Enhanced.conf` | 当前重点维护的轻量网络增强版本 |
| `Mini-Net-Config.conf` | 基础精简网络配置 |
| `Mini-DualNet-Config.conf` | 双网络相关配置变体 |
| `Mini-Final-Config.conf` | 精简最终版 |
| `Mini-Cellular-WiFi-Config.conf` | Wi-Fi / 蜂窝网络切换场景 |
| `Full-Final-Config.conf` | 完整业务分流版本 |
| `Full-Net-Enhanced.conf` | 完整网络增强变体 |
| `Mini-iPad-Final-Config.conf` | iPad 使用的配置变体 |
| `Mini-Final-Config-Test.conf` | 测试版本，使用前请自行检查 |
| `Mini-Net-Enhanced.bak.conf` | 备份文件，不作为默认入口 |

以 `Mini-Net-Enhanced.conf` 为例，当前文件包含以下设计：

- 使用加密 DNS：常规 DNS 通过代理访问，代理节点域名使用可在代理建立前访问的国内 DoH。
- 关闭系统 DNS 回退相关选项，并通过 DNS 劫持接管常规 53 端口请求。
- 提供地区自动测速组、手动选择组及最终策略组。
- 为本地网段与 Tailscale 地址段配置单独规则。
- 提供 IPv6、STUN 响应、MTU、TCP Keepalive 和 QUIC 等网络行为的配置项。

配置文件中的代理策略组可能依赖订阅中的节点名称或地区命名。若节点名称不匹配，地区组可能为空或无法按预期选择节点；导入后请检查策略组。

#### 导入步骤

1. 在本仓库打开目标 `.conf` 文件，点击 Raw 获取原始配置链接，或下载文件到设备。
2. 将文件通过 AirDrop、文件 App 或 iCloud Drive 传到 iPhone / iPad。
3. 使用 Shadowrocket 导入配置；也可以在配置管理界面添加远程配置链接。
4. 检查代理组、DNS 设置、规则和节点匹配情况。
5. 选择可用节点，连接后进行 DNS、IP 和应用访问测试。

### 2. Clash Verge Rev（Windows / Mihomo）

配置文件位于 [ClashVerge](https://github.com/darveydev/VPN-Private-Config/tree/main/ClashVerge)。

| 文件 | 用途 |
|---|---|
| [全局扩展脚本.js](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/ClashVerge/%E5%85%A8%E5%B1%80%E6%89%A9%E5%B1%95%E8%84%9A%E6%9C%AC.js) | Script 阶段，生成/调整 DNS、代理组与规则 |
| [全局扩展覆写配置.yaml](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/ClashVerge/%E5%85%A8%E5%B1%80%E6%89%A9%E5%B1%95%E8%A6%86%E5%86%99%E9%85%8D%E7%BD%AE.yaml) | Merge 阶段，配置 TUN、Sniffer、路由及其他运行参数 |
| [ClashVerge-DNS-Leak-Protection.yaml](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/ClashVerge/ClashVerge-DNS-Leak-Protection.yaml) | 独立完整配置方案 |

推荐组合方式：

```text
机场订阅
   │
   ▼
全局扩展覆写配置.yaml（Merge）
   │
   ▼
全局扩展脚本.js（Script）
   │
   ▼
最终运行配置
```

脚本与覆写配置承担不同职责。当前脚本会构建 DNS、代理组和规则；覆写配置主要处理 TUN、Sniffer、路由等运行参数。若脚本对某个配置段执行整体替换，覆写文件中的同名设置可能不会成为最终生效值，修改时应同时检查两份文件及最终配置。

`ClashVerge-DNS-Leak-Protection.yaml` 是独立 profile，与脚本 + Merge 组合属于不同使用方式。**不要把独立 profile 与组合方案重复叠加启用**；选择一种方案，并在 Clash Verge 中确认最终配置是否通过校验。

#### 部署步骤

1. 备份 Clash Verge 当前配置。
2. 导入机场订阅，确认原始节点可用。
3. 在 Clash Verge 的全局扩展脚本入口中加载 `全局扩展脚本.js`。
4. 在全局扩展覆写入口中加载 `全局扩展覆写配置.yaml`。
5. 按当前 Clash Verge Rev 版本检查 TUN、自动路由、自动检测接口和 DNS 劫持选项。
6. 更新配置并重启 Mihomo 内核，查看日志确认配置加载成功。
7. 如需使用独立 YAML profile，先关闭组合方案中的脚本与覆写，避免重复覆盖。

不同版本的 Clash Verge Rev 菜单名称和配置优先级可能不同，以软件当前界面和 Mihomo 实际运行配置为准。

### 3. FlClash（Android / Windows）

配置文件：[FlClash-Private.js](https://raw.githubusercontent.com/darveydev/VPN-Private-Config/main/FlClash/FlClash-Private.js)

该脚本用于 Mihomo 配置覆写，对订阅配置进行二次处理。脚本涉及 DNS、TUN、代理组、规则和节点识别等逻辑。

#### 部署步骤

1. 在 FlClash 中导入并确认机场订阅可正常使用。
2. 打开配置覆写功能，按当前版本支持的方式添加 `FlClash-Private.js`。
3. 更新订阅或重新生成配置。
4. 检查代理组是否生成、节点是否匹配、配置是否通过 Mihomo 校验。
5. 开启 TUN 前确认系统 VPN 权限、路由与局域网访问需求。

FlClash 不同平台及版本对覆写入口、脚本 API 和 TUN 实现的支持可能存在差异，请以当前版本文档为准。

### 4. Surge 模块（Threads / Instagram）

模块位于 [modules](https://github.com/darveydev/VPN-Private-Config/tree/main/modules)，详细说明见 [modules/README.md](modules/README.md)。

| 文件 | 作用 |
|---|---|
| `ThreadsHideAds.module` | Surge 模块入口，声明规则、参数与 MITM 域名 |
| `ThreadsHideAds.js` | 响应处理脚本，识别并移除信息流中的广告条目 |
| `ThreadsHideAds.test.js` | Node.js 自测脚本 |

该模块通过处理符合条件的信息流 JSON 响应来过滤广告，不代表能够屏蔽所有广告接口、网页首屏内容或客户端缓存内容。安装前请阅读模块文档，并确认 MITM 证书、脚本路径和模块参数均已正确设置。

## DNS 与网络行为说明

本仓库的不同配置并非完全相同，以下是常见设计思路，不应理解为所有文件都使用完全一致的参数。

### DNS 分层

典型场景会区分：

1. **代理节点域名解析**：代理尚未建立时也必须能解析，因此通常选择可直连的 DNS 服务，避免代理 DNS 引导循环。
2. **国内直连域名解析**：按配置指定国内 DNS，降低国内服务解析异常的概率。
3. **海外域名解析**：部分配置通过代理访问加密 DNS，使 DNS 查询出口与代理策略尽量一致。
4. **备用解析**：按客户端能力配置备用 DNS；备用路径也需要检查是否会回退到系统 DNS。

DoH / DoT 能加密客户端到 DNS 服务商之间的查询链路，但不能保证绝对匿名，也不能单凭 DNS 设置证明不存在任何流量泄露。DNS 服务商仍可能看到其接收的查询；应用自带 DoH、硬编码 IP、系统网络扩展行为和规则优先级也会影响结果。

### IPv6

部分配置关闭 IPv6，是为了降低未被代理接管的 IPv6 流量绕行风险。此设置可能影响纯 IPv6 网络或服务。是否应该关闭 IPv6，应结合客户端的 IPv6 代理能力、系统网络和实际测试决定，不能将其视为适用于所有网络的通用最优解。

### MTU、QUIC 与连接保活

- **MTU**：若网页可打开但图片、视频或大文件加载异常，可尝试降低 MTU；应逐步测试，不要直接认定某个数值适用于所有网络。
- **QUIC / HTTP/3**：部分配置限制代理流量中的 QUIC，以规避某些网络环境下的 UDP 兼容问题；可能影响支持 HTTP/3 的应用连接方式。
- **Keepalive**：较短的保活间隔可能更快发现失效连接，但会增加少量网络活动和耗电；不同客户端参数含义也不完全相同。

### Tailscale

仓库中的部分配置为 Tailscale 地址段、域名或进程设置了专门规则或路由排除项。使用前应核对：

- Tailscale 是否已正常连接，设备之间是否可互访。
- `100.64.0.0/10` 等地址段是否被代理规则或 TUN 路由错误接管。
- MagicDNS、出口节点和子网路由是否符合自己的使用需求。
- Shadowrocket、Mihomo 的规则与路由排除项是否与当前 Tailscale 配置一致。

不要在未确认路由影响前，直接删除 Tailscale 相关规则。

## 验证与故障排查

导入配置后，建议按以下顺序测试：

1. **基础连通性**：确认代理节点可连接，常用国内网站和海外网站均可正常访问。
2. **DNS 检查**：访问 [DNS Leak Test](https://www.dnsleaktest.com/) 执行标准或扩展测试，检查解析服务商是否符合预期。
3. **公网 IP 检查**：访问 [IPLeak](https://ipleak.net/) 或 [BrowserLeaks](https://browserleaks.com/ip/)，检查公网 IPv4 / IPv6、DNS 与 WebRTC 信息。
4. **国内应用检查**：测试电商、短视频、即时通信、支付及常用 App 的图片、登录和内容加载。
5. **网络切换检查**：在 Wi-Fi 与蜂窝网络之间切换，观察连接是否自动恢复。
6. **Tailscale 检查**：验证设备互访、MagicDNS、出口节点及局域网访问。

测试结果会受浏览器自身 DNS、系统缓存、运营商网络、节点出口和检测站点策略影响。单次检测不能证明所有应用、协议和网络路径都不存在泄露。

### 常见问题

| 现象 | 排查方向 |
|---|---|
| 代理显示已连接，但网站无法访问 | 检查节点域名解析、节点可用性、代理组选择和 DNS 引导路径 |
| 国内 App 图片或内容加载慢/失败 | 检查国内域名是否误走代理、规则集是否更新、DNS 解析结果及 MTU |
| 海外网站能打开但 DNS 检测出现本地解析器 | 检查系统 DNS 回退、浏览器安全 DNS、应用内 DoH 和 DNS 劫持是否生效 |
| Wi-Fi 切蜂窝网络后连接异常 | 检查客户端网络权限、TUN 自动检测接口、连接保活和节点连通性 |
| 图片或视频加载到一半卡住 | 尝试调整 MTU，检查 UDP / QUIC 策略及节点线路质量 |
| Tailscale 已连接但设备不可达 | 检查 TUN 路由排除、`100.64.0.0/10`、MagicDNS 和出口节点设置 |
| 地区策略组为空 | 检查机场节点名称是否符合正则匹配条件 |
| Clash Verge 启动配置报错 | 查看 Mihomo 日志、覆写合并结果和脚本语法，逐项禁用定位 |
| Surge 模块没有过滤效果 | 按 `modules/README.md` 检查 MITM、脚本路径、接口匹配和调试日志 |

## 更新与维护建议

- 优先使用各客户端目录中明确标注为当前使用或推荐的配置；测试版与备份文件仅用于对照和回滚。
- 修改 DNS、规则或 TUN 参数前，先确认配置最终由哪个阶段生成或覆盖。
- 更新后先进行配置语法检查，再测试国内外网站、常用 App、网络切换与 Tailscale。
- 如果配置依赖远程规则集、图标或脚本资源，需考虑资源不可用、版本变化和缓存导致的加载问题。
- 建议通过 Git 提交记录追踪变更；重要调整保留可回滚版本，并在提交说明中写明变更原因。

## 免责声明

本仓库为个人配置整理与技术实验项目，不提供代理节点、订阅链接、账号密码或商业代理服务。请自行确认所使用的网络服务、规则集和第三方资源来源可靠，并遵守所在地法律法规、软件许可及服务提供方条款。

配置不承诺在所有设备、系统版本、网络运营商或代理服务上均可直接使用。使用者应自行备份、审阅、测试并承担修改配置带来的风险。
