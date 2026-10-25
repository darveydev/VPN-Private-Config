/**
 * ThreadsHideAds.js
 * ---------------------------------------------------------------------------
 * Threads / Instagram 信息流内置广告过滤脚本
 * 运行位置：Surge 5 http-response 脚本（Loon 亦可直接复用，见 README）
 *
 * 设计原则
 *   1. 只做「删减」，不改写任何已有字段，最大程度避免客户端解析报错；
 *   2. 接口白名单 + 响应体特征 双重校验，未验证的接口一律原样放行；
 *   3. 广告判定基于字段语义（is_sponsored / ad_id / brs_ad_data ...），
 *      不写死下标、不依赖固定 doc_id，Meta 改版后依然有效；
 *   4. 内置误杀保护：删除比例异常时整包回滚，宁可不拦也不能把信息流清空。
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  /* =========================================================================
   * 0. 参数解析
   * ====================================================================== */

  var ARGS = {
    debug: false,          // 输出匹配日志
    feedOnly: true,        // 仅处理白名单信息流接口
    blockSuggested: false  // 额外屏蔽 netego / 推荐内容
  };

  function toBool(v, dflt) {
    if (v === true || v === false) return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      var s = v.replace(/\s+/g, '').toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
    }
    return dflt;
  }

  (function initArgs() {
    var raw = null;
    try {
      if (typeof $argument === 'string' && $argument.length > 0) {
        raw = JSON.parse($argument);
      } else if ($argument && typeof $argument === 'object') {
        raw = $argument;
      }
    } catch (e) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return;
    if ('debug' in raw) ARGS.debug = toBool(raw.debug, ARGS.debug);
    if ('feedOnly' in raw) ARGS.feedOnly = toBool(raw.feedOnly, ARGS.feedOnly);
    if ('blockSuggested' in raw) ARGS.blockSuggested = toBool(raw.blockSuggested, ARGS.blockSuggested);
  })();

  function log() {
    if (!ARGS.debug) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    console.log('[ThreadsHideAds] ' + parts.join(' '));
  }

  function done(result) {
    if (typeof $done === 'function') $done(result || {});
  }

  /* =========================================================================
   * 1. 请求 / 响应基础信息
   * ====================================================================== */

  var url = '';
  try {
    if (typeof $request !== 'undefined' && $request && $request.url) url = String($request.url);
  } catch (e) { /* ignore */ }

  var body = null;
  try {
    if (typeof $response !== 'undefined' && $response && typeof $response.body === 'string') {
      body = $response.body;
    }
  } catch (e) { body = null; }

  if (!body || body.length < 32) {
    log('skip: empty body', url);
    return done({});
  }

  // 超大响应（视频清单、图片 base64 等）直接放行，避免占用内存
  var MAX_BODY = 16 * 1024 * 1024;
  if (body.length > MAX_BODY) {
    log('skip: body too large', body.length);
    return done({});
  }

  /* =========================================================================
   * 2. 接口白名单（仅 feedOnly 开启时生效）
   * ====================================================================== */

  var FEED_PATTERNS = [
    // Threads Web / App
    /\/api\/graphql/i,
    /\/graphql(?:\/query)?(?:[/?]|$)/i,
    /\/api\/v1\/text_post_app_timeline/i,
    /\/api\/v1\/text_feed/i,
    // Instagram Web / App
    /\/api\/v1\/feed(?:\/|$|\?)/i,
    /\/api\/v1\/clips(?:\/|$|\?)/i,
    /\/api\/v1\/discover(?:\/|$|\?)/i,
    /\/api\/v1\/explore(?:\/|$|\?)/i,
    /\/api\/v1\/loops(?:\/|$|\?)/i
  ];

  function isFeedUrl(u) {
    if (!u) return false;
    for (var i = 0; i < FEED_PATTERNS.length; i++) {
      if (FEED_PATTERNS[i].test(u)) return true;
    }
    return false;
  }

  if (ARGS.feedOnly && !isFeedUrl(url)) {
    log('skip: not a feed endpoint', url);
    return done({});
  }

  /* =========================================================================
   * 3. 响应体形态校验（避免解析登录、配置、上传等 JSON）
   * ====================================================================== */

  var FEED_HINTS = [
    '"feed"', '"feed_items"', '"feedItems"', '"timeline"',
    '"thread_items"', '"media_or_ad"', '"edges"', '"items"',
    '"sections"', '"xdt_api'
  ];

  var hinted = false;
  for (var h = 0; h < FEED_HINTS.length; h++) {
    if (body.indexOf(FEED_HINTS[h]) !== -1) { hinted = true; break; }
  }
  if (!hinted) {
    log('skip: body has no feed hint', url);
    return done({});
  }

  /* =========================================================================
   * 4. 反劫持前缀处理（Instagram / Facebook 常见 for (;;); 或 )]}'）
   * ====================================================================== */

  var PREFIX_RE = /^\s*(?:for\s*\(\s*;\s*;\s*\)\s*;|\)\]\}',?)\s*/;
  var prefixMatch = body.match(PREFIX_RE);
  var prefix = prefixMatch ? prefixMatch[0] : '';
  var jsonText = prefix ? body.slice(prefix.length) : body;

  var root;
  try {
    root = JSON.parse(jsonText);
  } catch (e) {
    log('skip: JSON.parse failed', e && e.message);
    return done({});
  }

  if (!root || typeof root !== 'object') {
    log('skip: root is not object');
    return done({});
  }

  /* =========================================================================
   * 5. 广告特征表
   * ====================================================================== */

  // 5.1 布尔型「这就是广告」标记
  var TRUE_FLAGS = [
    'is_sponsored', 'isSponsored',
    'is_ad', 'isAd',
    'is_ads', 'isAds',
    'is_ad_post', 'isAdPost',
    'is_sponsored_post', 'isSponsoredPost',
    'is_promoted', 'isPromoted',
    'is_brs_ad', 'isBrsAd',
    'is_paid_partnership', 'isPaidPartnership',
    'is_dynamic_ad', 'isDynamicAd',
    'is_ad_break', 'isAdBreak',
    'sponsored'
  ];

  // 5.2 非空的广告 ID / 广告令牌
  var ID_KEYS = [
    'ad_id', 'adId', 'adid',
    'advertiser_id', 'advertiserId',
    'ad_click_token', 'adClickToken',
    'ad_tracking_token', 'adTrackingToken',
    'ad_impression_token', 'adImpressionToken',
    'ad_tracking_data', 'adTrackingData',
    'ad_client_token'
  ];

  // 5.3 广告载荷对象（存在且非空即判定为广告）
  var PAYLOAD_KEYS = [
    'ad', 'ads',
    'brs_ad_data', 'brsAdData',
    'ad_data', 'adData',
    'ad_metadata', 'adMetadata',
    'ad_info', 'adInfo',
    'sponsored_info', 'sponsoredInfo',
    'ad_header', 'adHeader',
    'ad_cta', 'adCta',
    'ad_break', 'adBreak',
    'ads_pool', 'adsPool',
    'advertiser'
  ];

  // 5.4 __typename 特征
  var TYPENAME_RE = /(?:^|[^a-z])(?:ads?|adpost|adunit|aditem|adbreak|adslot|sponsored|promoted|brsad)[a-z0-9]*$/i;

  // 5.5 类型字段取值
  var TYPE_KEYS = ['product_type', 'item_type', 'netego_type', 'type', 'ad_type', 'feed_item_type'];
  var TYPE_VALUE_RE = /^(?:ad|ads|sponsored|promoted|ig_ad|brs_ad|paid_partnership|branded_content_ad)$/i;

  function isMeaningful(v) {
    if (v === null || v === undefined || v === false) return false;
    if (typeof v === 'string') return v.length > 0 && v !== '0';
    if (typeof v === 'number') return v !== 0;
    return true;
  }

  function isNonEmptyObject(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) return true;
    }
    return false;
  }

  function hasAdMarker(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;

    var i, k, v;

    // 布尔标记
    for (i = 0; i < TRUE_FLAGS.length; i++) {
      if (o[TRUE_FLAGS[i]] === true) return true;
    }

    // 广告 ID
    for (i = 0; i < ID_KEYS.length; i++) {
      if (isMeaningful(o[ID_KEYS[i]])) return true;
    }

    // 广告载荷
    for (i = 0; i < PAYLOAD_KEYS.length; i++) {
      k = PAYLOAD_KEYS[i];
      v = o[k];
      if (isNonEmptyObject(v)) return true;
    }

    // 类型名
    var tn = o.__typename || o.typename;
    if (typeof tn === 'string' && TYPENAME_RE.test(tn)) return true;

    // 类型字段
    for (i = 0; i < TYPE_KEYS.length; i++) {
      v = o[TYPE_KEYS[i]];
      if (typeof v === 'string' && TYPE_VALUE_RE.test(v)) return true;
    }

    return false;
  }

  /* --- 推荐 / netego 特征（blockSuggested 开启时启用） --- */

  var SUGGESTED_TRUE = ['is_suggested', 'isSuggested', 'is_netego', 'isNetego'];
  var SUGGESTED_KEYS = [
    'netego_type', 'netegoType',
    'suggested_users', 'suggestedUsers',
    'suggested_businesses', 'suggested_media',
    'explore_story', 'bloks_netego',
    'recommended_users', 'chaining_info'
  ];
  var SUGGESTED_TYPENAME_RE = /netego|suggested|recommend/i;

  function hasSuggestedMarker(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var i, v;

    for (i = 0; i < SUGGESTED_TRUE.length; i++) {
      if (o[SUGGESTED_TRUE[i]] === true) return true;
    }
    for (i = 0; i < SUGGESTED_KEYS.length; i++) {
      v = o[SUGGESTED_KEYS[i]];
      if (typeof v === 'string' && v.length > 0) return true;
      if (isNonEmptyObject(v)) return true;
    }
    var tn = o.__typename || o.typename;
    if (typeof tn === 'string' && SUGGESTED_TYPENAME_RE.test(tn)) return true;
    return false;
  }

  /* =========================================================================
   * 6. 深度扫描：单个信息流条目内部任意层级出现广告特征即判定为广告条目
   * ====================================================================== */

  var MAX_DEPTH = 5;
  var MAX_NODES = 900;

  function deepScan(rootObj, predicate) {
    var stack = [{ v: rootObj, d: 0 }];
    var visited = 0;

    while (stack.length > 0) {
      var cur = stack.pop();
      var v = cur.v;
      var d = cur.d;

      if (!v || typeof v !== 'object') continue;
      if (++visited > MAX_NODES) break;

      if (!Array.isArray(v) && predicate(v)) return true;
      if (d >= MAX_DEPTH) continue;

      var i, child;
      if (Array.isArray(v)) {
        var limit = v.length < 40 ? v.length : 40;
        for (i = 0; i < limit; i++) {
          child = v[i];
          if (child && typeof child === 'object') stack.push({ v: child, d: d + 1 });
        }
      } else {
        for (var k in v) {
          if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
          child = v[k];
          if (child && typeof child === 'object') stack.push({ v: child, d: d + 1 });
        }
      }
    }
    return false;
  }

  function isRemovableEntry(el) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return false;
    if (deepScan(el, hasAdMarker)) return true;
    if (ARGS.blockSuggested && deepScan(el, hasSuggestedMarker)) return true;
    return false;
  }

  /* =========================================================================
   * 7. 递归清理：只从数组中摘除元素，不触碰任何键值结构
   * ====================================================================== */

  var stats = { removed: 0, candidates: 0, arrays: 0 };

  function sanitize(node) {
    if (!node || typeof node !== 'object') return;

    var i, j, v;

    if (Array.isArray(node)) {
      stats.arrays++;
      for (i = node.length - 1; i >= 0; i--) {
        var el = node[i];
        if (!el || typeof el !== 'object') continue;
        if (!Array.isArray(el)) {
          stats.candidates++;
          if (isRemovableEntry(el)) {
            node.splice(i, 1);
            stats.removed++;
            continue;
          }
        }
        sanitize(el);
      }
      return;
    }

    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      v = node[k];
      if (v && typeof v === 'object') sanitize(v);
    }
  }

  sanitize(root);

  /* =========================================================================
   * 8. 误杀保护 & 输出
   * ====================================================================== */

  if (stats.removed === 0) {
    log('no ad removed |', url);
    return done({});
  }

  // 删除比例异常（>85% 且超过 8 条）时判定为规则误伤，整包回滚
  if (stats.removed > 8 && stats.candidates > 0 && stats.removed / stats.candidates > 0.85) {
    console.log('[ThreadsHideAds] 警告：删除比例异常 ' + stats.removed + '/' + stats.candidates + '，已回滚，请提交 issue');
    return done({});
  }

  var out;
  try {
    out = prefix + JSON.stringify(root);
  } catch (e) {
    log('stringify failed, rollback', e && e.message);
    return done({});
  }

  log('removed ' + stats.removed + ' ad item(s), candidates ' + stats.candidates + ' |', url);

  return done({ body: out });
})();
