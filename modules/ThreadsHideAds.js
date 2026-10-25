/**
 * ThreadsHideAds.js
 * ---------------------------------------------------------------------------
 * Threads / Instagram 信息流内置广告过滤脚本
 * 运行位置：Surge 5 http-response 脚本（Loon 亦可直接复用，见 README）
 *
 * v2 变更
 *   - 修正 v1 的致命问题：模块 max-size=0 导致脚本从未拿到响应体（已在 .module 修复）
 *   - 广告特征库大幅扩充，覆盖 IG 网页版 / App / Reels / 探索页已知全部字段
 *   - __typename 判定改为大小写敏感，避免 MediaDict / LoadMore 之类误伤
 *   - 深度扫描上限放宽到 6 层 / 2400 节点，兼容超大媒体节点
 *   - 误杀保护只统计「信息流数组」的候选条目，比例判断更准确
 *   - 新增诊断模式：输出未命中但字段名可疑的键路径，便于补齐规则
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  /* =========================================================================
   * 0. 参数
   * ====================================================================== */

  var ARGS = {
    debug: false,          // 输出处理日志
    feedOnly: true,        // 仅处理白名单信息流接口
    blockSuggested: false, // 额外屏蔽 netego / 推荐内容
    diagnose: false        // 输出未命中的可疑字段
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
    if ('diagnose' in raw) ARGS.diagnose = toBool(raw.diagnose, ARGS.diagnose);
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
   * 1. 请求 / 响应
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
    // 若这里持续无输出，多半是模块 max-size 设置过小，脚本拿不到响应体
    log('skip: empty body（检查模块 max-size 是否为 -1 或足够大）', url);
    return done({});
  }

  var MAX_BODY = 12 * 1024 * 1024;
  if (body.length > MAX_BODY) {
    log('skip: body too large', body.length);
    return done({});
  }

  /* =========================================================================
   * 2. 接口白名单
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
   * 3. 响应体形态校验
   * ====================================================================== */

  var FEED_HINTS = [
    '"feed"', '"feed_items"', '"feedItems"', '"timeline"',
    '"thread_items"', '"media_or_ad"', '"edges"', '"items"',
    '"sections"', '"xdt_api', '"xdt_'
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
   * 4. 反劫持前缀
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
   * 5. 广告特征库
   * ====================================================================== */

  // 5.1 布尔标记
  var TRUE_FLAGS = [
    'is_sponsored', 'isSponsored',
    'is_sponsored_content', 'isSponsoredContent',
    'is_ad', 'isAd',
    'is_ads', 'isAds',
    'is_advertisement', 'isAdvertisement',
    'is_ad_post', 'isAdPost',
    'is_sponsored_post', 'isSponsoredPost',
    'is_promoted', 'isPromoted',
    'is_brs_ad', 'isBrsAd',
    'is_paid_partnership', 'isPaidPartnership',
    'is_dynamic_ad', 'isDynamicAd',
    'is_injected_ad', 'isInjectedAd',
    'is_native_ad', 'isNativeAd',
    'is_ad_break', 'isAdBreak',
    'sponsored'
  ];

  // 5.2 非空即广告的 ID / 令牌
  var ID_KEYS = [
    'ad_id', 'adId', 'adid', 'ad_id_str',
    'brs_ad_id', 'brsAdId',
    'ad_group_id', 'adGroupId',
    'ad_campaign_id', 'adCampaignId',
    'ad_creative_id', 'adCreativeId',
    'ad_set_id', 'adSetId',
    'ad_media_id', 'adMediaId',
    'ad_impression_id', 'adImpressionId',
    'ad_position_id', 'adPositionId',
    'advertiser_id', 'advertiserId',
    'ad_click_token', 'adClickToken',
    'ad_tracking_token', 'adTrackingToken',
    'ad_impression_token', 'adImpressionToken',
    'ad_client_token', 'adClientToken',
    'ad_tracking_data', 'adTrackingData',
    'ad_tracking_tokens', 'adTrackingTokens'
  ];

  // 5.3 非空字符串即广告（广告文案类字段）
  var STRING_KEYS = [
    'ad_title', 'adTitle',
    'ad_name', 'adName',
    'advertiser_name', 'advertiserName',
    'sponsored_label', 'sponsoredLabel',
    'sponsored_label_text',
    'sponsored_by', 'sponsoredBy',
    'ad_cta_text', 'adCtaText',
    'ad_headline', 'adHeadline',
    'ad_body', 'adBody'
  ];

  // 5.4 广告载荷对象（存在且非空即广告）
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
    'ad_break_data', 'adBreakData',
    'ad_slot', 'adSlot',
    'ad_media', 'adMedia',
    'ads_pool', 'adsPool',
    'ads_shopping_info', 'adsShoppingInfo',
    'dynamic_ads', 'dynamicAds',
    'advertiser'
  ];

  // 5.5 __typename：大小写敏感，避免 MediaDict / LoadMore 误伤
  var TYPENAME_CS = /(?:Ad|Ads|AdPost|AdUnit|AdItem|AdSlot|AdBreak|AdMedia)$/;
  var TYPENAME_CI = /sponsored|promoted|brs_?ad|paid_partnership|branded_content_ad/i;

  // 5.6 类型字段
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

    var i, v;

    for (i = 0; i < TRUE_FLAGS.length; i++) {
      if (o[TRUE_FLAGS[i]] === true) return true;
    }
    for (i = 0; i < ID_KEYS.length; i++) {
      if (isMeaningful(o[ID_KEYS[i]])) return true;
    }
    for (i = 0; i < STRING_KEYS.length; i++) {
      if (isMeaningful(o[STRING_KEYS[i]])) return true;
    }
    for (i = 0; i < PAYLOAD_KEYS.length; i++) {
      if (isNonEmptyObject(o[PAYLOAD_KEYS[i]])) return true;
    }

    var tn = o.__typename || o.typename;
    if (typeof tn === 'string' && (TYPENAME_CS.test(tn) || TYPENAME_CI.test(tn))) return true;

    for (i = 0; i < TYPE_KEYS.length; i++) {
      v = o[TYPE_KEYS[i]];
      if (typeof v === 'string' && TYPE_VALUE_RE.test(v)) return true;
    }

    return false;
  }

  /* --- 推荐 / netego 特征 --- */

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
   * 6. 深度扫描
   * ====================================================================== */

  var MAX_DEPTH = 6;
  var MAX_NODES = 2400;

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
   * 7. 诊断：找出未命中但字段名可疑的键
   * ====================================================================== */

  function looksSuspiciousKey(k) {
    var parts = k.split(/_|(?=[A-Z])/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].toLowerCase();
      if (!p) continue;
      if (p === 'ad' || p === 'ads' || p === 'brs' || p === 'paid') return true;
      if (p.indexOf('advert') === 0) return true;
      if (p.indexOf('sponsor') === 0) return true;
      if (p.indexOf('promot') === 0) return true;
      if (p.indexOf('branded') === 0) return true;
    }
    return false;
  }

  var diagBudget = 30;

  function diagCollect(obj, path, out) {
    if (!obj || typeof obj !== 'object' || diagBudget <= 0) return;
    if (Array.isArray(obj)) {
      var limit = obj.length < 8 ? obj.length : 8;
      for (var i = 0; i < limit && diagBudget > 0; i++) {
        diagCollect(obj[i], path + '[' + i + ']', out);
      }
      return;
    }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (diagBudget <= 0) return;
      var v = obj[k];
      if (looksSuspiciousKey(k)) {
        diagBudget--;
        var preview;
        if (v === null || v === undefined) preview = String(v);
        else if (typeof v === 'object') preview = '{' + Object.keys(v).slice(0, 6).join(',') + '}';
        else preview = String(v).slice(0, 40);
        out.push(path + '.' + k + ' = ' + preview);
      }
      if (v && typeof v === 'object') diagCollect(v, path + '.' + k, out);
    }
  }

  /* =========================================================================
   * 8. 递归清理
   * ====================================================================== */

  var FEED_LIST_KEY_RE = /^(edges|items|feed_items|feeditems|thread_items|sections|posts|nodes|entries|media_list|media_items|results)$/i;

  var stats = { removed: 0, candidates: 0, arrays: 0, emptied: 0 };
  var diagOut = [];

  function sanitize(node, keyName) {
    if (!node || typeof node !== 'object') return;

    var i, v;

    if (Array.isArray(node)) {
      stats.arrays++;
      var isFeedList = FEED_LIST_KEY_RE.test(keyName || '');
      var originalLength = node.length;

      for (i = node.length - 1; i >= 0; i--) {
        var el = node[i];
        if (!el || typeof el !== 'object') continue;

        if (!Array.isArray(el)) {
          if (isFeedList) stats.candidates++;

          if (isRemovableEntry(el)) {
            node.splice(i, 1);
            stats.removed++;
            continue;
          }
          if (ARGS.diagnose && isFeedList) {
            diagCollect(el, (keyName || 'root') + '[' + i + ']', diagOut);
          }
        }
        sanitize(el, keyName);
      }

      if (isFeedList && originalLength > 0 && node.length === 0) stats.emptied++;
      return;
    }

    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      v = node[k];
      if (v && typeof v === 'object') sanitize(v, k);
    }
  }

  sanitize(root, 'root');

  /* =========================================================================
   * 9. 输出
   * ====================================================================== */

  if (ARGS.diagnose && diagOut.length > 0) {
    console.log('[ThreadsHideAds][诊断] 以下字段名可疑但未被判定为广告，请反馈：');
    for (var d = 0; d < diagOut.length; d++) console.log('  ' + diagOut[d]);
  }

  if (stats.removed === 0) {
    log('no ad removed |', url);
    return done({});
  }

  if (stats.removed > 8 && stats.candidates > 0 && stats.removed / stats.candidates > 0.85) {
    console.log('[ThreadsHideAds] 警告：删除比例异常 ' + stats.removed + '/' + stats.candidates + '，已回滚');
    return done({});
  }

  var out;
  try {
    out = prefix + JSON.stringify(root);
  } catch (e) {
    log('stringify failed, rollback', e && e.message);
    return done({});
  }

  log('removed ' + stats.removed + ' ad item(s) / candidates ' + stats.candidates + ' |', url);
  if (stats.emptied > 0) log('警告：有 ' + stats.emptied + ' 个信息流数组被清空');

  return done({ body: out });
})();
