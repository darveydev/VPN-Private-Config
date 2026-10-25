/**
 * ThreadsHideAds 自测脚本
 * 用法：node ThreadsHideAds.test.js
 * 改动识别规则后请务必跑一遍，防止回归 / 误杀。
 */
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(path.join(__dirname, 'ThreadsHideAds.js'), 'utf8');

function run(body, url, args) {
  let out = null;
  const logs = [];
  const fn = new Function('$argument', '$request', '$response', '$done', 'console', CODE);
  fn(
    JSON.stringify(args || { debug: true, feedOnly: true, blockSuggested: false, diagnose: false }),
    { url },
    { body },
    (r) => { out = r; },
    { log: (...a) => logs.push(a.join(' ')) }
  );
  return { out, logs };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ---------- 1. Threads GraphQL 信息流 ---------- */
const threadsFeed = {
  data: {
    feedData: {
      edges: [
        { cursor: 'c1', node: { thread_items: [{ post: { pk: '1001', caption: { text: '正常帖子 A' } } }] } },
        { cursor: 'c2', node: { thread_items: [{ post: { pk: 'ad-1', ad_id: '34028', is_sponsored: true } }] } },
        { cursor: 'c3', node: { thread_items: [{ post: { pk: '1002', caption: { text: '正常帖子 B' } } }] } },
        { cursor: 'c4', node: { thread_items: [{ post: { pk: 'ad-2', ad: { ad_id: '77821' } } }] } },
        { cursor: 'c5', node: { thread_items: [{ post: { pk: '1003', caption: { text: '正常帖子 C' } } }] } }
      ],
      page_info: { has_next_page: true, end_cursor: 'c5' }
    }
  }
};

let r = run(JSON.stringify(threadsFeed), 'https://www.threads.net/api/graphql');
let parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
check('Threads: 输出被修改', !!parsed);
if (parsed) {
  const edges = parsed.data.feedData.edges;
  check('Threads: 剩余 3 条', edges.length === 3, 'got ' + edges.length);
  check('Threads: 无广告残留', !JSON.stringify(edges).includes('ad_id'));
  check('Threads: 保留正常帖子 A/B/C',
    edges.map(e => e.node.thread_items[0].post.pk).join(',') === '1001,1002,1003');
  check('Threads: page_info 未被破坏', parsed.data.feedData.page_info.end_cursor === 'c5');
}

/* ---------- 2. Instagram App feed/timeline ---------- */
const igFeed = {
  num_results: 4,
  more_available: true,
  feed_items: [
    { media_or_ad: { id: 'm1', code: 'AAA', caption: { text: 'organic 1' } } },
    { media_or_ad: { id: 'ad-9', ad_id: '55123', brs_ad_data: { ad_id: '55123' } } },
    { media_or_ad: { id: 'm2', code: 'BBB', caption: { text: 'organic 2' } } },
    { media_or_ad: { id: 'm3', code: 'CCC', ad_id: null } }
  ]
};
r = run(JSON.stringify(igFeed), 'https://i.instagram.com/api/v1/feed/timeline/');
parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
check('IG App: 输出被修改', !!parsed);
if (parsed) {
  check('IG App: 剩余 3 条', parsed.feed_items.length === 3, 'got ' + parsed.feed_items.length);
  check('IG App: 无 brs_ad_data 残留', !JSON.stringify(parsed).includes('brs_ad_data'));
  check('IG App: ad_id:null 有机内容未误删', parsed.feed_items.some(i => i.media_or_ad.id === 'm3'));
}

/* ---------- 3. Instagram Web（xdt_api 结构，含用户反馈的两个 shortcode） ---------- */
const igWeb = {
  data: {
    xdt_api__v1__feed__timeline__connection: {
      edges: [
        { node: { __typename: 'XDTMediaDict', pk: '1', code: 'ORG1', caption: { text: 'hi' } } },
        { node: { __typename: 'XDTMediaDict', pk: '2', code: 'DZNuXyNDJNX', ad_id: '340282366841710300949128187403844517579', sponsored_label: 'Sponsored' } },
        { node: { __typename: 'XDTMediaDict', pk: '3', code: 'ORG2', caption: { text: 'yo' } } },
        { node: { __typename: 'XDTMediaDict', pk: '4', code: 'DetdBUPs6dj', brs_ad_data: { ad_id: '88', is_holdout: false } } }
      ],
      page_info: { end_cursor: 'x', has_next_page: true }
    }
  }
};
r = run(JSON.stringify(igWeb), 'https://www.instagram.com/api/graphql');
parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
const webEdges = parsed && parsed.data.xdt_api__v1__feed__timeline__connection.edges;
check('IG Web: 输出被修改', !!parsed);
check('IG Web: 4 条去 2 条广告', webEdges && webEdges.length === 2, webEdges && webEdges.length);
check('IG Web: 两条广告（含反馈的两个 shortcode）均被清除',
  webEdges && !webEdges.some(e => e.node.code === 'DZNuXyNDJNX' || e.node.code === 'DetdBUPs6dj'));
check('IG Web: __typename XDTMediaDict 未被误判', webEdges && webEdges.every(e => e.node.__typename === 'XDTMediaDict'));

/* ---------- 4. 不应误伤的正常字段 ---------- */
const tricky = {
  feed_items: [
    { media_or_ad: { __typename: 'XDTMediaDict', id: '1', load_more: true, download_url: 'x', header: { a: 1 }, gradient: [1, 2], broadcast_id: '9' } },
    { media_or_ad: { __typename: 'XDTMediaDict', id: '2', ad_id: '' } },
    { media_or_ad: { __typename: 'XDTMediaDict', id: '3', ads_manager_config: {} } }
  ]
};
r = run(JSON.stringify(tricky), 'https://i.instagram.com/api/v1/feed/timeline/');
check('正常字段（load_more/download/header/gradient）不误杀', r.out && r.out.body === undefined, JSON.stringify(r.out));

/* ---------- 5. 非信息流接口放行 ---------- */
r = run(JSON.stringify({ status: 'ok', ad_id: 'x' }), 'https://i.instagram.com/api/v1/accounts/login/');
check('非 feed 接口放行', r.out && r.out.body === undefined);

/* ---------- 6. 纯有机流零改动 ---------- */
const organic = { data: { feedData: { edges: [
  { node: { thread_items: [{ post: { pk: '1' } }] } },
  { node: { thread_items: [{ post: { pk: '2' } }] } }
] } } };
r = run(JSON.stringify(organic), 'https://www.threads.net/api/graphql');
check('纯有机流不改动', r.out && r.out.body === undefined);

/* ---------- 7. for(;;); 前缀 ---------- */
r = run('for (;;);' + JSON.stringify(threadsFeed), 'https://www.instagram.com/graphql/query');
check('保留 for(;;); 前缀', r.out && typeof r.out.body === 'string' && r.out.body.startsWith('for (;;);'));
if (r.out && r.out.body) {
  const p2 = JSON.parse(r.out.body.replace(/^for \(;;\);/, ''));
  check('前缀响应内广告同样被清除', p2.data.feedData.edges.length === 3);
}

/* ---------- 8. blockSuggested 开关 ---------- */
const withNetego = { feed_items: [
  { media_or_ad: { id: 'm1' } },
  { netego_type: 'suggested_users', suggested_users: { users: [{ pk: 9 }] } }
] };
r = run(JSON.stringify(withNetego), 'https://i.instagram.com/api/v1/feed/timeline/', { debug: true, feedOnly: true, blockSuggested: false, diagnose: false });
check('推荐内容默认保留', r.out && r.out.body === undefined);
r = run(JSON.stringify(withNetego), 'https://i.instagram.com/api/v1/feed/timeline/', { debug: true, feedOnly: true, blockSuggested: true, diagnose: false });
parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
check('开启后推荐内容被移除', parsed && parsed.feed_items.length === 1);

/* ---------- 9. 坏 JSON 安全放行 ---------- */
r = run('{"feed_items": [ broken', 'https://i.instagram.com/api/v1/feed/timeline/');
check('坏 JSON 安全放行', r.out && r.out.body === undefined);

/* ---------- 10. 误杀保护 ---------- */
const allAds = { feed_items: [] };
for (let i = 0; i < 20; i++) allAds.feed_items.push({ media_or_ad: { id: 'a' + i, ad_id: '9' + i } });
r = run(JSON.stringify(allAds), 'https://i.instagram.com/api/v1/feed/timeline/');
check('全广告流触发回滚保护', r.out && r.out.body === undefined);

/* ---------- 11. 诊断模式 ---------- */
const unknownAd = { feed_items: [
  { media_or_ad: { id: 'm1' } },
  { media_or_ad: { id: 'm2', __typename: 'XDTMediaDict', paid_partnership_info_x: 'yes' } },
  { media_or_ad: { id: 'm3', is_promoted_thing: true } }
] };
r = run(JSON.stringify(unknownAd), 'https://i.instagram.com/api/v1/feed/timeline/', { debug: true, feedOnly: true, blockSuggested: false, diagnose: true });
const diagText = r.logs.join('\n');
check('诊断模式列出可疑字段名', diagText.includes('paid_partnership_info_x') || diagText.includes('is_promoted_thing'), diagText);
check('诊断模式不影响正常放行', r.out && r.out.body === undefined);

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
