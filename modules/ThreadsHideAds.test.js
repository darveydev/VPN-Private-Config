const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(path.join(__dirname, "ThreadsHideAds.js"), 'utf8');

function run(body, url, args) {
  let out = null;
  const logs = [];
  const fn = new Function('$argument', '$request', '$response', '$done', 'console', CODE);
  fn(
    JSON.stringify(args || { debug: true, feedOnly: true, blockSuggested: false }),
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

/* ---------- 用例 1：Threads GraphQL 信息流（含 2 条广告） ---------- */
const threadsFeed = {
  data: {
    feedData: {
      edges: [
        { cursor: 'c1', node: { thread_items: [{ post: { pk: '1001', caption: { text: '正常帖子 A' }, user: { username: 'a' } } }] } },
        { cursor: 'c2', node: { thread_items: [{ post: { pk: 'ad-1', ad_id: '34028', is_sponsored: true, caption: { text: '买它' } } }] } },
        { cursor: 'c3', node: { thread_items: [{ post: { pk: '1002', caption: { text: '正常帖子 B' } } }] } },
        { cursor: 'c4', node: { thread_items: [{ post: { pk: 'ad-2', ad_id: '77821', ad: { ad_id: '77821' }, caption: { text: '广告二' } } }] } },
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
  check('Threads: 无广告残留', !JSON.stringify(edges).includes('ad_id'), JSON.stringify(edges));
  check('Threads: 保留正常帖子 A/B/C',
    edges.map(e => e.node.thread_items[0].post.pk).join(',') === '1001,1002,1003',
    edges.map(e => e.node.thread_items[0].post.pk).join(','));
  check('Threads: page_info 未被破坏', parsed.data.feedData.page_info.end_cursor === 'c5');
}

/* ---------- 用例 2：Instagram feed/timeline（media_or_ad 结构） ---------- */
const igFeed = {
  num_results: 4,
  more_available: true,
  feed_items: [
    { media_or_ad: { id: 'm1', code: 'AAA', caption: { text: 'organic 1' } } },
    { media_or_ad: { id: 'ad-9', ad_id: '55123', brs_ad_data: { ad_id: '55123', is_holdout: false }, caption: { text: 'Sponsored' } } },
    { media_or_ad: { id: 'm2', code: 'BBB', caption: { text: 'organic 2' } } },
    { media_or_ad: { id: 'm3', code: 'CCC', caption: { text: 'organic 3' }, ad_id: null } }
  ]
};
r = run(JSON.stringify(igFeed), 'https://i.instagram.com/api/v1/feed/timeline/');
parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
check('IG: 输出被修改', !!parsed);
if (parsed) {
  check('IG: 剩余 3 条', parsed.feed_items.length === 3, 'got ' + parsed.feed_items.length);
  check('IG: 无广告残留', !JSON.stringify(parsed).includes('brs_ad_data'));
  check('IG: ad_id:null 的有机内容未被误删', parsed.feed_items.some(i => i.media_or_ad.id === 'm3'));
}

/* ---------- 用例 3：非信息流接口必须原样放行 ---------- */
r = run(JSON.stringify({ status: 'ok', ad_id: 'x' }), 'https://i.instagram.com/api/v1/accounts/login/');
check('非 feed 接口放行', r.out && r.out.body === undefined, JSON.stringify(r.out));

/* ---------- 用例 4：纯有机信息流不应产生改动 ---------- */
const organic = { data: { feedData: { edges: [
  { node: { thread_items: [{ post: { pk: '1' } }] } },
  { node: { thread_items: [{ post: { pk: '2' } }] } }
] } } };
r = run(JSON.stringify(organic), 'https://www.threads.net/api/graphql');
check('纯有机流不改动', r.out && r.out.body === undefined, JSON.stringify(r.out));

/* ---------- 用例 5：for(;;); 前缀保持 ---------- */
r = run('for (;;);' + JSON.stringify(threadsFeed), 'https://www.instagram.com/graphql/query');
check('保留 for(;;); 前缀', r.out && typeof r.out.body === 'string' && r.out.body.startsWith('for (;;);'),
  r.out && String(r.out.body).slice(0, 20));
if (r.out && r.out.body) {
  const p2 = JSON.parse(r.out.body.replace(/^for \(;;\);/, ''));
  check('前缀响应内广告同样被清除', p2.data.feedData.edges.length === 3, 'got ' + p2.data.feedData.edges.length);
}

/* ---------- 用例 6：blockSuggested 开关 ---------- */
const withNetego = { feed_items: [
  { media_or_ad: { id: 'm1' } },
  { netego_type: 'suggested_users', suggested_users: { users: [{ pk: 9 }] } }
] };
r = run(JSON.stringify(withNetego), 'https://i.instagram.com/api/v1/feed/timeline/', { debug: true, feedOnly: true, blockSuggested: false });
check('推荐内容默认保留', r.out && r.out.body === undefined, JSON.stringify(r.out));
r = run(JSON.stringify(withNetego), 'https://i.instagram.com/api/v1/feed/timeline/', { debug: true, feedOnly: true, blockSuggested: true });
parsed = r.out && r.out.body ? JSON.parse(r.out.body) : null;
check('开启后推荐内容被移除', parsed && parsed.feed_items.length === 1, parsed && parsed.feed_items.length);

/* ---------- 用例 7：损坏 JSON 不崩溃 ---------- */
r = run('{"feed_items": [ broken', 'https://i.instagram.com/api/v1/feed/timeline/');
check('坏 JSON 安全放行', r.out && r.out.body === undefined);

/* ---------- 用例 8：误杀保护 ---------- */
const allAds = { feed_items: [] };
for (let i = 0; i < 20; i++) allAds.feed_items.push({ media_or_ad: { id: 'a' + i, ad_id: '9' + i } });
r = run(JSON.stringify(allAds), 'https://i.instagram.com/api/v1/feed/timeline/');
check('全广告流触发回滚保护', r.out && r.out.body === undefined, JSON.stringify(r.out).slice(0, 80));

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
