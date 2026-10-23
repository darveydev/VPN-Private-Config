// ============================================================================
//  Clash Verge Rev —— 全局扩展脚本（Global Extend Script）
// ============================================================================
//
//  【执行顺序】 订阅配置  →  覆写(Merge：全局扩展覆写配置.yaml)  →  脚本(本文件)
//
//  这一点非常重要：
//    1. 本文件的 main() 里 `config["dns"] = dnsConfig` 是【整体覆盖】，
//       所以最终生效的 DNS 一定是本文件里的 dnsConfig。
//    2. 覆写 YAML 里的 prepend-rules 会在 Merge 阶段插入 rules 数组，
//       但本文件又把 `config["rules"]` 整个替换掉 → 覆写里的规则会丢失。
//       因此：**关键的本地/代理/DNS 防护规则必须写进本文件的 rules 数组最前面**，
//       不能只依赖 YAML 的 prepend-rules。（见下方 baseRules）
//    3. 两个文件的 DNS 段落请保持「语义一致」，改一边记得改另一边，
//       否则排查问题时会被执行顺序坑。
//
// ----------------------------------------------------------------------------
//  【本版目标】
//   1. 全链路加密 DNS —— 杜绝 UDP/53 明文 DNS 外泄给运营商
//   2. 国内域名  → 国内 DoH（DIRECT，不经代理，低延迟）
//   3. 国外域名  → 国外 DoH（经代理，出口 IP 与 DNS 出口一致，防泄露）
//   4. 节点域名  → 国内 DoH（DIRECT，避免「先有鸡还是先有蛋」死锁）
//   5. 断网/切网（Wi-Fi ↔ 移动网络）后自动恢复，无需手动关开 VPN
//
// ----------------------------------------------------------------------------
//  【DNS 泄露的三个入口，以及本配置如何逐个堵死】
//
//   泄露入口 ①：明文 UDP/53 / TCP/53 查询 → 运营商 / ISP
//      堵法：TUN 的 dns-hijack 劫持全部 :53 流量 + nameserver 全部为 DoH/DoT
//            + 规则侧对 53 端口收敛（见 baseRules 5.3）
//
//   泄露入口 ②：DIRECT 域名解析时落到「国外 DNS」
//      堵法：direct-nameserver 指向国内 DoH，且 direct-nameserver-follow-policy
//            显式关闭，保证直连域名一律用国内加密 DNS，不绕经代理
//
//   泄露入口 ③：bootstrap（引导）阶段用明文 DNS 解析 DoH 服务器域名本身
//      堵法：default-nameserver 使用 DoT（tls://），不用 223.5.5.5 这种明文
//
//   另外两个非 DNS 但同源的泄露：
//      · IPv6 泄露   → dns.ipv6: false + 全局 ipv6: false
//      · WebRTC/STUN → 规则层可按需拒绝 5349（见 baseRules 5.3，默认注释）
// ============================================================================


// ============================================================================
//  1. DNS 服务器清单
// ============================================================================

// ------------------------------------------------------------
//  国内 DNS（DoH）
// ------------------------------------------------------------
//  用途：
//    · 解析国内域名（geosite:cn / geosite:private）
//    · 解析代理节点域名（proxy-server-nameserver）
//    · 解析 DIRECT 域名（direct-nameserver）
//
//  为什么优先用 IP 形式的 DoH 而不是域名形式？
//    · 用 https://dns.alidns.com/dns-query 需要先解析 dns.alidns.com
//      → 又要依赖 bootstrap DNS → 多一跳，切网瞬间更容易超时
//    · 用 https://223.5.5.5/dns-query 直接打到 IP，无需再解析
//      → 断网重连、Wi-Fi 切 4G 的瞬间成功率明显更高
//    · 两种写法都支持，下面默认用 IP 形式（更抗切换）。
//
//  注意：这两个都是「直连可达」的加密 DNS，不会经过代理，
//        所以不会和代理本身形成循环依赖。
// ------------------------------------------------------------
const domesticNameservers = [
  "https://223.5.5.5/dns-query",   // 阿里 DoH —— 国内延迟最低，抗污染能力够用
  "https://doh.pub/dns-query"      // 腾讯 DoH —— 与阿里互为备份，避免单点故障
];

// ------------------------------------------------------------
//  国外 DNS（DoH）
// ------------------------------------------------------------
//  用途：解析被墙 / 海外域名。查询本身会「经代理」发出，
//        因此返回结果与节点出口一致，不会出现
//        「DNS 走国内、流量走国外」这种出口不一致导致的
//        风控 / 地域判定错误（Netflix、AI 服务尤其敏感）。
//
//  为什么放 4 个不同厂商？
//    · 其中一个在特定网络（移动/电信/联通/CERNET）被干扰时，
//      其余仍可用；mihomo 会并发查询，取最先返回的结果。
//    · 全部为 DoH（443 端口），不会被识别为 DNS 流量而遭 QoS。
//
//  ⚠️ 说明：OpenDNS 与 Yandex 在国内部分网络下 443 可能被干扰，
//           如果发现解析慢，可以只保留 Cloudflare + Google 两组。
// ------------------------------------------------------------
const foreignNameservers = [
  "https://208.67.222.222/dns-query", // OpenDNS    —— 独立于 Google/Cloudflare 的第三方
  "https://77.88.8.8/dns-query",      // Yandex DNS —— 俄罗斯节点，对部分被墙域名解析较干净
  "https://1.1.1.1/dns-query",        // Cloudflare —— 全球延迟优秀
  "https://8.8.4.4/dns-query"         // Google     —— 覆盖面最广，作为兜底
];


// ============================================================================
//  2. DNS 配置主体
// ============================================================================
const dnsConfig = {

  // ----------------------------------------------------------
  //  总开关
  // ----------------------------------------------------------
  "enable": true,

  // ----------------------------------------------------------
  //  监听地址
  // ----------------------------------------------------------
  //  ⚠️ 必须与「全局扩展覆写配置.yaml」里的 dns.listen 保持一致！
  //     两处写不同端口时，最终以本文件为准（本文件后执行），
  //     而你在 YAML 里看到的配置会显得「没生效」。
  //
  //  为什么用 53 而不是 1053？
  //    · TUN 模式下 dns-hijack 劫持的是 :53，监听 53 最直接
  //    · 如果用 1053，需要额外把系统 DNS 指向 127.0.0.1:1053，
  //      切换网络时系统 DNS 设置可能被 DHCP 重新覆盖 → 更容易出问题
  //  如果 Windows 上 53 端口被占用（极少见）再改成 0.0.0.0:1053。
  "listen": "0.0.0.0:53",

  // ----------------------------------------------------------
  //  IPv6
  // ----------------------------------------------------------
  //  false = 不向 AAAA 查询返回 IPv6 地址。
  //  这是防泄露的关键一环：很多「IPv6 泄露」本质是
  //  域名解析出了 IPv6，而代理只代理 IPv4 → 流量绕过隧道直连 ISP。
  "ipv6": false,

  // ----------------------------------------------------------
  //  禁用 HTTP/3（QUIC）承载 DNS
  // ----------------------------------------------------------
  //  原因：QUIC 在 Wi-Fi ↔ 蜂窝 切换的瞬间，连接迁移容易失败，
  //        表现为「刚切完网络有几秒 DNS 完全不通」。
  //        强制走 TCP/TLS 的 DoH 稳定得多。
  "prefer-h3": false,

  // ----------------------------------------------------------
  //  DNS 查询遵循分流规则
  // ----------------------------------------------------------
  //  true 的作用：
  //    · 解析「国外域名」时，这条 DoH 请求本身会按规则走代理
  //      → DNS 出口 = 节点出口，实现真正的「无泄露」
  //    · 解析「国内域名」时，走 direct-nameserver，直连发出
  //
  //  代价：DNS 查询会经过一遍规则匹配，首次解析略慢一点点，
  //        但换来的是出口一致性，值得。
  //
  //  ⚠️ 开启本项后，mihomo 要求必须配置 proxy-server-nameserver，
  //     否则会报错 —— 下面的 proxy-server-nameserver 就是为此存在。
  "respect-rules": true,

  // ----------------------------------------------------------
  //  不使用系统 hosts
  // ----------------------------------------------------------
  //  防止 Windows 的 hosts 文件里存在污染条目（很多破解软件会写）
  //  影响解析结果。
  "use-hosts": false,
  "use-system-hosts": false,

  // ----------------------------------------------------------
  //  DNS 缓存算法
  // ----------------------------------------------------------
  //  arc = Adaptive Replacement Cache，比 lru 命中率高。
  //  切网后缓存里可能残留旧网络下的结果，但 fake-ip 模式下
  //  影响很小（fake-ip 是本地合成的，与网络无关）。
  "cache-algorithm": "arc",

  // ----------------------------------------------------------
  //  Fake-IP 模式
  // ----------------------------------------------------------
  //  工作方式：
  //    域名 → 直接返回一个 198.18.x.x 的假 IP（不发真实 DNS 查询）
  //    → 应用拿着假 IP 建连 → mihomo 从假 IP 反查出域名
  //    → 按域名规则分流 → 真正在代理侧完成解析
  //
  //  这是「防 DNS 泄露最强」的模式：被代理的域名压根没有真实 DNS 查询，
  //  自然也就无从泄露。同时也是切换网络最快恢复的原因
  //  （域名→假 IP 的映射与网络无关，切网后旧连接语义仍有效）。
  "enhanced-mode": "fake-ip",

  //  假 IP 段。用 198.18.0.1/16（RFC 2544 保留测试段），
  //  避免与常见的 172.16/12、10/8 内网冲突。
  "fake-ip-range": "198.18.0.1/16",

  // ----------------------------------------------------------
  //  Fake-IP 排除清单
  // ----------------------------------------------------------
  //  这些域名【不要】返回假 IP，必须返回真实 IP。原因分六类：
  //
  //  A. 本地 / 内网
  //     .lan / .local —— mDNS、NAS、打印机、路由器管理页
  //
  //  B. 系统连通性探测（返回假 IP 会导致系统误判「无网络」）
  //     Windows: msftconnecttest.com / msftncsi.com
  //     → 如果不排除，任务栏会出现「小地球」图标，提示无 Internet
  //
  //  C. 应用自己的登录 / 检测逻辑
  //     QQ、微信的 localhost.xxx 检测域名，拿到假 IP 会「快速登录失败」
  //
  //  D. 反向解析（PTR）
  //     in-addr.arpa / ip6.arpa —— 拿到假 IP 会让 netstat、
  //     抓包工具、部分安全软件显示异常
  //
  //  E. NTP 时间同步
  //     拿到假 IP 会同步失败 → 系统时间偏差 → TLS 证书校验失败
  //
  //  F. Tailscale MagicDNS（若使用）
  //     需要真实解析，否则 100.x 内网域名不可达
  "fake-ip-filter": [

    // ---- A. 本地 / 内网 ----
    "+.lan",
    "+.local",

    // ---- B. 系统连通性探测 ----
    "+.msftconnecttest.com",           // Windows 网络状态检测
    "+.msftncsi.com",                  // Windows NCSI 检测
    "captive.apple.com",               // Apple 强制门户检测
    "connectivitycheck.gstatic.com",   // Android 连通性检测
    "connectivitycheck.android.com",   // Android 连通性检测（备用域名）

    // ---- C. QQ / 微信快速登录检测 ----
    "localhost.ptlogin2.qq.com",
    "localhost.sec.qq.com",
    "localhost.work.weixin.qq.com",

    // ---- D. 反向解析 ----
    "+.in-addr.arpa",
    "+.ip6.arpa",

    // ---- E. NTP 时间同步 ----
    "time.*.com",
    "time.*.gov",
    "pool.ntp.org",

    // ---- F. Tailscale ----
    "+.tailscale.com",
    "+.ts.net"
  ],

  // ----------------------------------------------------------
  //  Bootstrap DNS（引导 DNS）
  // ----------------------------------------------------------
  //  这两个只用来「解析 DoH/DoT 服务器自己的域名」，
  //  例如解析 dns.google、doh.pub 这些主机名。
  //
  //  ⚠️ 绝对不能填明文 UDP DNS（如裸写 "223.5.5.5"）：
  //     那一步就是明文查询，等于把「你正在访问哪些 DoH」暴露给运营商。
  //
  //  这里用 DoT（tls://223.5.5.5:853），链路本身加密，
  //  且直接打 IP，不需要再解析，切网瞬间也不会多一次查询。
  "default-nameserver": [
    "tls://223.5.5.5",   // 阿里 DoT
    "tls://223.6.6.6"    // 阿里 DoT 备用（同厂商不同 IP，延迟都低）
  ],

  // ----------------------------------------------------------
  //  主 DNS —— 国外域名
  // ----------------------------------------------------------
  //  配合 respect-rules: true，这些查询会走代理发出。
  "nameserver": [...foreignNameservers],

  // ----------------------------------------------------------
  //  代理节点域名 DNS
  // ----------------------------------------------------------
  //  作用：解析机场节点服务器地址（如 hk01.example.com）。
  //
  //  为什么必须用【国内直连 DoH】？
  //    · 如果用国外 DNS：解析节点域名时还没有代理可用 → 死锁
  //    · 如果走代理：鸡生蛋问题 → 永远起不来
  //    · 国内 DoH 直连可达，是最稳的选择
  //
  //  ⚠️ 这是很多「配置看起来没问题但就是连不上节点」的元凶。
  "proxy-server-nameserver": [...domesticNameservers],

  // ----------------------------------------------------------
  //  DIRECT 域名 DNS
  // ----------------------------------------------------------
  //  作用：命中 DIRECT 规则的域名（国内网站）用国内 DoH 解析。
  //
  //  为什么单独配？
  //    · 若复用 nameserver（国外 DoH 经代理），
  //      访问淘宝/百度也要先把 DNS 绕一圈代理 → 慢且浪费流量
  //    · 更严重：国内域名的解析结果会由国外 DNS 给出，
  //      可能返回非最优 IP（甚至被 ECS 判成海外用户）
  //
  //  ⇒ 国内域名用国内 DNS，是「正确性」+「性能」+「不泄露」三赢。
  "direct-nameserver": [...domesticNameservers],

  // ----------------------------------------------------------
  //  DIRECT 域名是否跟随分流策略
  // ----------------------------------------------------------
  //  false = direct-nameserver 的查询一律「直连发出」，不按规则走代理。
  //
  //  为什么不设 true？
  //    如果设 true，且规则里某个国内域名被判成代理，
  //    那它的 DNS 也会走代理 → 国内域名解析变慢，
  //    并且在代理不可用时直接解析失败（切网瞬间尤其明显）。
  "direct-nameserver-follow-policy": false,

  // ----------------------------------------------------------
  //  Fallback（兜底 DNS）
  // ----------------------------------------------------------
  //  留空是【有意的决定】，不是遗漏：
  //
  //  · 传统 fallback 的用法是「主 DNS 返回被污染结果时换一组再查」，
  //    但它依赖 fallback-filter 的 GeoIP 判断；在 fake-ip 模式下
  //    被代理的域名根本不做真实解析，fallback 几乎不会触发；
  //  · 保留 fallback 反而带来额外查询与额外失败路径，
  //    在切网瞬间增加超时概率；
  //  · 本配置已通过 fake-ip + respect-rules + nameserver-policy
  //    三层解决了污染问题，不需要 fallback。
  //
  //  如果你确实想启用（例如排查某些域名解析异常），
  //  取消下面两段注释即可：
  //
  //  "fallback": [
  //    "https://dns.google/dns-query",
  //    "https://cloudflare-dns.com/dns-query"
  //  ],
  //  "fallback-filter": {
  //    "geoip": true,
  //    "geoip-code": "CN",
  //    "geosite": ["gfw"],
  //    "domain": ["+.google.com", "+.youtube.com", "+.openai.com"]
  //  },
  "fallback": [],

  // ----------------------------------------------------------
  //  分域名指定 DNS（nameserver-policy）
  // ----------------------------------------------------------
  //  ⚠️⚠️ 原配置这里写的是 "geosite:private,cn"，这是【无效语法】！
  //      mihomo 的 key 必须是「单个」匹配表达式或域名，
  //      写成逗号拼接会被当成一个非法域名 → 该策略不生效，
  //      甚至可能导致 DNS 模块初始化报错。
  //      必须拆成两个独立的 key（见下）。
  // ----------------------------------------------------------
  "nameserver-policy": {

    // ---- 国内域名 → 国内 DoH ----
    //  geosite:cn 覆盖常见中国站点
    "geosite:cn": [...domesticNameservers],

    // ---- 内网 / 私有域名 → 国内 DoH ----
    //  geosite:private 包含局域网、保留域名
    "geosite:private": [...domesticNameservers],

    // ---- 苹果生态 → 国内 DoH ----
    //  Apple 在国内有 CDN，用国内 DNS 能拿到就近节点；
    //  用国外 DNS 反而可能解析到海外 IP，iCloud 同步变慢。
    "+.apple.com": [...domesticNameservers],
    "+.apple.co": [...domesticNameservers],
    "+.icloud.com": [...domesticNameservers],

    // ---- Tailscale → Cloudflare DoH ----
    //  tailscale.com / ts.net 属于「国外但需要真实解析」的域名。
    //  注意这些域名同时在 fake-ip-filter 里，
    //  所以这里真正的效果是「用 Cloudflare 做真实解析」。
    "+.tailscale.com": ["https://cloudflare-dns.com/dns-query"],
    "+.ts.net": ["https://cloudflare-dns.com/dns-query"]
  }
};


// ============================================================================
//  3. 规则集通用配置
// ============================================================================
const ruleProviderCommon = {
  "type": "http",       // 从远程 URL 拉取
  "format": "yaml",     // 规则文件格式
  "interval": 86400     // 每 24 小时更新一次（86400 秒）
};


// ============================================================================
//  4. 规则集定义
// ============================================================================
//  behavior 三种类型说明：
//    · domain    —— 纯域名规则，匹配最快，只能写 DOMAIN/DOMAIN-SUFFIX
//    · ipcidr    —— 纯 IP 段规则，用于 IP-CIDR 匹配
//    · classical —— 混合规则，可包含任意规则类型，但匹配稍慢
//
//  下面按用途分组，方便日后增删。
// ============================================================================
const ruleProviders = {

  // -------------------- Loyalsoldier 基础规则集 --------------------
  "reject": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
    "path": "./ruleset/loyalsoldier/reject.yaml"
  },
  "icloud": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt",
    "path": "./ruleset/loyalsoldier/icloud.yaml"
  },
  "apple": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt",
    "path": "./ruleset/loyalsoldier/apple.yaml"
  },
  "google": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt",
    "path": "./ruleset/loyalsoldier/google.yaml"
  },
  "proxy": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
    "path": "./ruleset/loyalsoldier/proxy.yaml"
  },
  "direct": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
    "path": "./ruleset/loyalsoldier/direct.yaml"
  },
  "private": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
    "path": "./ruleset/loyalsoldier/private.yaml"
  },
  "gfw": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
    "path": "./ruleset/loyalsoldier/gfw.yaml"
  },
  "tld-not-cn": {
    ...ruleProviderCommon,
    "behavior": "domain",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt",
    "path": "./ruleset/loyalsoldier/tld-not-cn.yaml"
  },
  "telegramcidr": {
    ...ruleProviderCommon,
    "behavior": "ipcidr",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt",
    "path": "./ruleset/loyalsoldier/telegramcidr.yaml"
  },
  "cncidr": {
    ...ruleProviderCommon,
    "behavior": "ipcidr",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt",
    "path": "./ruleset/loyalsoldier/cncidr.yaml"
  },
  "lancidr": {
    ...ruleProviderCommon,
    "behavior": "ipcidr",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt",
    "path": "./ruleset/loyalsoldier/lancidr.yaml"
  },
  "applications": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt",
    "path": "./ruleset/loyalsoldier/applications.yaml"
  },

  // -------------------- 第三方业务规则集 --------------------
  "bahamut": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/Bahamut.txt",
    "path": "./ruleset/xiaolin-007/bahamut.yaml"
  },
  "YouTube": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/YouTube.txt",
    "path": "./ruleset/xiaolin-007/YouTube.yaml"
  },
  "Netflix": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/Netflix.txt",
    "path": "./ruleset/xiaolin-007/Netflix.yaml"
  },
  "Spotify": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/Spotify.txt",
    "path": "./ruleset/xiaolin-007/Spotify.yaml"
  },
  "BilibiliHMT": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/BilibiliHMT.txt",
    "path": "./ruleset/xiaolin-007/BilibiliHMT.yaml"
  },
  "AI": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/AI.txt",
    "path": "./ruleset/xiaolin-007/AI.yaml"
  },
  "TikTok": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/TikTok.txt",
    "path": "./ruleset/xiaolin-007/TikTok.yaml"
  },
  "Microsoft": {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/rule/Microsoft.txt",
    "path": "./ruleset/xiaolin-007/Microsoft.yaml"
  }
};


// ============================================================================
//  5. 安全与本地规则（必须排在最前面）
// ============================================================================
//
//  【为什么放在脚本里，而不是只放 YAML 的 prepend-rules】
//    因为 main() 会执行 config["rules"] = rules 整体替换，
//    Merge 阶段插入的 prepend-rules 会被丢弃。
//    把这些「一旦丢失就会出问题」的规则写在这里，才真正可靠。
//
//  【顺序原则】越具体、越要紧的越靠前：
//    进程豁免 → Tailscale  →  本地/内网  →  DNS 防护  →  泄露检测
// ============================================================================
const baseRules = [

  // ==========================================================
  //  5.1 Tailscale（若不用 Tailscale 可整段删除）
  // ==========================================================
  //  Tailscale 自己需要建立 WireGuard 隧道，
  //  如果被 TUN 二次接管会出现「连上但不通」或死循环。
  //  所以：进程直接 DIRECT，100.64/10 网段直接 DIRECT。
  "PROCESS-NAME,tailscale.exe,DIRECT",
  "PROCESS-NAME,tailscaled.exe,DIRECT",
  "PROCESS-NAME,tailscale-ipn.exe,DIRECT",

  //  Cloudflare Tunnel（cloudflared）同样需要直接出网
  "PROCESS-NAME,cloudflared.exe,DIRECT",

  //  Tailscale 使用的 CGNAT 网段（不是普通内网，但必须直连）
  "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",

  //  Tailscale MagicDNS
  "IP-CIDR,100.100.100.100/32,DIRECT,no-resolve",

  //  Tailscale 打洞端口：STUN 3478、WireGuard 41641
  //  ⚠️ 这两条必须在下面 STUN 拦截规则【之前】，
  //     否则 Tailscale 会被误伤，无法打洞。
  "DST-PORT,3478,DIRECT",
  "DST-PORT,41641,DIRECT",

  //  Tailscale IPv6 网段
  "IP-CIDR6,fd7a:115c:a1e0::/48,DIRECT,no-resolve",

  //  Tailscale 业务域名（强制走代理，保证网页/登录能用）
  "DOMAIN-SUFFIX,tailscale.com,节点选择",

  // ==========================================================
  //  5.2 本地 / 内网
  // ==========================================================
  "DOMAIN-SUFFIX,lan,DIRECT",
  "DOMAIN-SUFFIX,local,DIRECT",
  "DOMAIN-SUFFIX,localhost,DIRECT",

  "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
  "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
  "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
  "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
  "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",

  "IP-CIDR6,::1/128,DIRECT,no-resolve",
  "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
  "IP-CIDR6,fc00::/7,DIRECT,no-resolve",

  // ==========================================================
  //  5.3 DNS 泄露防护
  // ==========================================================

  // ---- 明文 DNS（53）----
  //  说明：TUN 的 dns-hijack 会在规则之前把 :53 拦截到 mihomo 内部
  //        DNS，因此这条规则的实际作用是：
  //        把「万一没被劫持到的 53 流量」引到 DIRECT，
  //        由系统/内网 DNS 处理，而不是被错误地送进代理。
  //
  //  ⚠️ 若发现内网设备（NAS、路由器）DNS 异常，可删掉这条；
  //     在纯 TUN 环境下它是可选的安全兜底。
  "DST-PORT,53,DIRECT",

  // ---- DoT（853）：拒绝直连绕行 ----
  //  目的：防止某些 App 自带 DoT 客户端，绕过 mihomo 的 DNS 直接
  //        和外部 853 端口建连，形成一条「DNS 不走你的配置」的旁路。
  //  我们在 mihomo 内部用的是 DoH(443)，不受这条影响。
  //
  //  ⚠️ 若使用强制 DoT 的企业软件，出现解析异常时优先怀疑这条。
  "DST-PORT,853,REJECT",

  // ---- STUN/TURN over TLS（5349）：可选，防 WebRTC 泄露真实 IP ----
  //  说明：网页通过 STUN 探测本机公网 IP，
  //        如果 UDP 没走代理，会探测到你家宽带的真实 IP。
  //  注意 3478（普通 STUN）已在 Tailscale 段落里 DIRECT，
  //  这里只拦 5349（TLS 版），避免误伤 Tailscale。
  //  需要更强防护时取消下一行注释：
  //  "DST-PORT,5349,REJECT",

  // ---- DNS 泄露检测站点：强制走代理 ----
  //  这样检测站点看到的是「节点出口 IP + 节点侧 DNS」，
  //  能如实反映你的真实防泄露水平；如果直连，测出来的结果没有意义。
  "DOMAIN-SUFFIX,dnsleaktest.com,节点选择",
  "DOMAIN-SUFFIX,ipleak.net,节点选择",
  "DOMAIN-SUFFIX,browserleaks.com,节点选择",
  "DOMAIN-SUFFIX,dnsleak.com,节点选择",
  "DOMAIN-SUFFIX,whatismyipaddress.com,节点选择",

  // ==========================================================
  //  5.4 系统连通性检测放行
  // ==========================================================
  //  这几条必须 DIRECT，否则 Windows / iOS 会认为「无 Internet」
  "DOMAIN-SUFFIX,msftconnecttest.com,DIRECT",
  "DOMAIN-SUFFIX,msftncsi.com,DIRECT",
  "DOMAIN-SUFFIX,captive.apple.com,DIRECT"
];


// ============================================================================
//  6. 分流规则
// ============================================================================
const rules = [

  // 把安全规则插到最前面
  ...baseRules,

  // ==========================================================
  //  6.1 少量高优先级白名单
  // ==========================================================
  //  archive.today 系列：常被广告规则集误杀
  //  放在 reject 之前，保证能正常访问
  "DOMAIN,archive.today,节点选择",
  "DOMAIN-SUFFIX,archive.ph,节点选择",
  "DOMAIN-SUFFIX,archive.is,节点选择",
  "DOMAIN-SUFFIX,archive.fo,节点选择",

  // ==========================================================
  //  6.2 硬编码的 Google 域名
  // ==========================================================
  //  比 RULE-SET,google 更靠前，避免被其他规则集抢先匹配
  "DOMAIN-SUFFIX,google.com,谷歌服务",
  "DOMAIN-SUFFIX,googleapis.cn,谷歌服务",          // Google 服务
  "DOMAIN-SUFFIX,gstatic.com,谷歌服务",             // 静态资源
  "DOMAIN-SUFFIX,xn--ngstr-lra8j.com,谷歌服务",     // Google Play 下载（Punycode 形式）

  // 其他需要走代理的零散域名
  "DOMAIN-SUFFIX,github.io,节点选择",               // GitHub Pages
  "DOMAIN,v2rayse.com,节点选择",                    // 节点订阅工具

  // ==========================================================
  //  6.3 规则集分流（顺序即优先级，改动前请想清楚）
  // ==========================================================
  "RULE-SET,applications,全局直连",   // 常见国内 App 域名
  "RULE-SET,private,全局直连",        // 私有域名
  "RULE-SET,reject,广告过滤",         // 广告 / 追踪

  "RULE-SET,Microsoft,微软服务",
  "RULE-SET,icloud,iCloud服务",
  "RULE-SET,apple,苹果服务",

  "RULE-SET,YouTube,YouTube",
  "RULE-SET,Netflix,Netflix",
  "RULE-SET,bahamut,动画疯",
  "RULE-SET,Spotify,Spotify",
  "RULE-SET,BilibiliHMT,哔哩哔哩港澳台",
  "RULE-SET,AI,AI",
  "RULE-SET,TikTok,TikTok",

  "RULE-SET,google,谷歌服务",
  "RULE-SET,proxy,节点选择",
  "RULE-SET,gfw,节点选择",
  "RULE-SET,tld-not-cn,节点选择",

  "RULE-SET,direct,全局直连",
  "RULE-SET,lancidr,全局直连,no-resolve",
  "RULE-SET,cncidr,全局直连,no-resolve",
  "RULE-SET,telegramcidr,电报消息,no-resolve",

  // ==========================================================
  //  6.4 GeoIP / GeoSite 兜底
  // ==========================================================
  //  no-resolve 的意义：不要为了判断这条 IP 规则而额外发起 DNS 查询。
  //  否则 IP 规则会触发解析，既慢又可能造成解析环。
  "GEOSITE,CN,全局直连",
  "GEOIP,LAN,全局直连,no-resolve",
  "GEOIP,CN,全局直连,no-resolve",

  // ==========================================================
  //  6.5 最终兜底
  // ==========================================================
  //  所有没被上面任何规则命中的流量 → 漏网之鱼（默认走代理）
  "MATCH,漏网之鱼"
];


// ============================================================================
//  7. 代理组通用参数
// ============================================================================
const groupBaseOption = {

  // 测速间隔（秒）。300 = 5 分钟一次，够用且不浪费流量。
  "interval": 300,

  // 单次测速超时（毫秒）。
  // ⚠️ 不要设太小：移动网络（4G/5G）首次握手慢，
  //    3000ms 以下容易把好节点误判为超时。
  "timeout": 3000,

  // 测速 URL。用 Google 的 204 端点，返回体极小。
  "url": "https://www.google.com/generate_204",

  // lazy: true = 只有当前被使用的组才测速，节省流量与 CPU。
  // 切网后需要手动触发一次测速才会更新延迟，这是 lazy 的代价。
  "lazy": true,

  // 连续失败 3 次才认为节点不可用，避免网络抖动导致频繁切换。
  "max-failed-times": 3,

  // hidden: false = 在面板中显示该组
  "hidden": false
};


// ============================================================================
//  8. 程序入口
// ============================================================================
function main(config) {

  // ----------------------------------------------------------
  //  8.1 前置校验
  // ----------------------------------------------------------
  //  如果订阅里没有任何代理，直接抛错。
  //  好处：失败得很明显，而不是得到一份「能启动但全都不通」的配置。
  const proxyCount = config?.proxies?.length ?? 0;
  const proxyProviderCount =
    typeof config?.["proxy-providers"] === "object"
      ? Object.keys(config["proxy-providers"]).length
      : 0;

  if (proxyCount === 0 && proxyProviderCount === 0) {
    throw new Error("配置文件中未找到任何代理");
  }

  // ----------------------------------------------------------
  //  8.2 覆盖 DNS
  // ----------------------------------------------------------
  //  注意这是整体替换，不是合并。
  config["dns"] = dnsConfig;

  // ----------------------------------------------------------
  //  8.3 网络切换 / 断线重连优化
  // ----------------------------------------------------------
  //  以下参数直接决定「Wi-Fi 切 4G 后要不要手动关开 VPN」。
  //
  //  keep-alive-interval：
  //    每隔多少秒发一次 TCP keepalive 探测。
  //    设 15 秒 → 网络断开后最多 15 秒就能发现并重连。
  //    设为 0 表示关闭（不推荐，断网后可能长时间「假连接」）。
  //
  //  keep-alive-idle：
  //    连接空闲多久后开始发送 keepalive。与上面配合：
  //    15 秒空闲即开始探测，适合频繁切换网络的移动办公场景。
  //
  //  disable-keep-alive：
  //    必须为 false，否则上面两项都不生效。
  config["keep-alive-interval"] = 15;
  config["keep-alive-idle"] = 15;
  config["disable-keep-alive"] = false;

  //  unified-delay：测速时统一扣掉握手耗时，让不同协议的延迟可比。
  //  开启后「节点延迟」这个数字才靠谱，否则 TLS 节点会显得更慢。
  config["unified-delay"] = true;

  //  tcp-concurrent：对同一域名并发连接多个解析结果，
  //  取最先成功的那个。
  //  效果：切网后首次访问、以及 CDN 多 IP 场景明显更快。
  config["tcp-concurrent"] = true;

  //  find-process-mode：规则里用到 PROCESS-NAME 时必须开启。
  //  always = 始终解析进程（略耗资源，但规则才准确）。
  config["find-process-mode"] = "always";

  // ----------------------------------------------------------
  //  8.4 覆盖代理组
  // ----------------------------------------------------------
  config["proxy-groups"] = [

    // ---------------- 核心选择器 ----------------
    {
      ...groupBaseOption,
      "name": "节点选择",
      "type": "select",        // 手动选择，不自动切换
      "include-all": true,     // 自动收录订阅里的全部节点
      // filter 用正则排除非节点条目（机场常把「剩余流量」「官网」写成节点）
      "filter": "^(?!.*(官网|套餐|流量|异常|剩余)).*$",
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/adjust.svg"
    },

    // 如果你更希望「自动选延迟最低」，把上面那个改成下面这样：
    // {
    //   ...groupBaseOption,
    //   "name": "节点选择",
    //   "type": "url-test",
    //   "include-all": true,
    //   "filter": "^(?!.*(官网|套餐|流量|异常|剩余)).*$",
    //   "url": "https://www.google.com/generate_204",
    //   "interval": 300,
    //   "timeout": 3000,
    //   "tolerance": 50,          // 延迟差 < 50ms 时不切换，防抖
    //   "lazy": false,            // 启动即测速，首次连接更快
    //   "max-failed-times": 3,
    //   "hidden": false,
    //   "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/adjust.svg"
    // },

    // ---------------- 业务分组 ----------------
    {
      ...groupBaseOption,
      "name": "谷歌服务",
      "type": "select",
      // proxies 里先写默认首选项，include-all 会追加全部节点
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/google.svg"
    },
    {
      ...groupBaseOption,
      "name": "YouTube",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/youtube.svg"
    },
    {
      ...groupBaseOption,
      "name": "Netflix",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/netflix.svg"
    },
    {
      ...groupBaseOption,
      "name": "电报消息",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/telegram.svg"
    },
    {
      ...groupBaseOption,
      "name": "AI",
      "type": "select",
      "include-all": true,
      // 默认不走直连：AI 服务对出口 IP 极敏感，直连必失败
      "proxies": ["节点选择"],
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/chatgpt.svg"
    },
    {
      ...groupBaseOption,
      "name": "TikTok",
      "type": "select",
      "include-all": true,
      "proxies": ["节点选择"],
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/tiktok.svg"
    },
    {
      ...groupBaseOption,
      "name": "微软服务",
      "type": "select",
      // 微软在国内有 CDN，默认直连更快
      "proxies": ["全局直连", "节点选择"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/microsoft.svg"
    },
    {
      ...groupBaseOption,
      "name": "iCloud服务",
      "type": "select",
      "proxies": ["全局直连", "节点选择"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/iCloud.svg"
    },
    {
      ...groupBaseOption,
      "name": "苹果服务",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/apple.svg"
    },
    {
      ...groupBaseOption,
      "name": "动画疯",
      "type": "select",
      "proxies": ["节点选择"],
      "include-all": true,
      // 巴哈姆特只接受台湾 IP，这里过滤出台湾节点
      "filter": "(?i)台|tw|TW",
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/Bahamut.svg"
    },
    {
      ...groupBaseOption,
      "name": "哔哩哔哩港澳台",
      "type": "select",
      "proxies": ["全局直连", "节点选择"],
      "include-all": true,
      "filter": "^(?!.*(官网|套餐|流量|异常|剩余)).*$",
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/bilibili.svg"
    },
    {
      ...groupBaseOption,
      "name": "Spotify",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/xiaolin-007/clash@main/icon/spotify.svg"
    },

    // ---------------- 功能分组 ----------------
    {
      ...groupBaseOption,
      "name": "广告过滤",
      "type": "select",
      // 可一键切回 DIRECT 排查「某网站打不开是不是被广告规则误杀」
      "proxies": ["REJECT", "DIRECT"],
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/bug.svg"
    },
    {
      ...groupBaseOption,
      "name": "全局直连",
      "type": "select",
      "proxies": ["DIRECT", "节点选择"],
      "include-all": true,
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/link.svg"
    },
    {
      ...groupBaseOption,
      "name": "全局拦截",
      "type": "select",
      "proxies": ["REJECT", "DIRECT"],
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/block.svg"
    },
    {
      ...groupBaseOption,
      "name": "漏网之鱼",
      "type": "select",
      "proxies": ["节点选择", "全局直连"],
      "include-all": true,
      "filter": "^(?!.*(官网|套餐|流量|异常|剩余)).*$",
      "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/fish.svg"
    }
  ];

  // ----------------------------------------------------------
  //  8.5 覆盖规则集与规则
  // ----------------------------------------------------------
  config["rule-providers"] = ruleProviders;
  config["rules"] = rules;

  // ----------------------------------------------------------
  //  8.6 强制开启节点 UDP 支持
  // ----------------------------------------------------------
  //  作用：
  //    · QUIC / HTTP3 能正常走代理（否则会被迫回落 TCP，视频加载变慢）
  //    · Tailscale、游戏、部分语音通话依赖 UDP
  //
  //  ⚠️ 前提是节点协议本身支持 UDP（SS/VLESS/Trojan/Hysteria 一般都支持）。
  //     如果某个协议不支持，mihomo 会静默丢弃该 UDP 流量，
  //     表现为「这些 App 用了代理就断流」，此时把该节点单独设 udp:false。
  if (config["proxies"]) {
    config["proxies"].forEach(proxy => {
      proxy.udp = true;
    });
  }

  // ----------------------------------------------------------
  //  8.7 返回修改后的配置
  // ----------------------------------------------------------
  return config;
}
