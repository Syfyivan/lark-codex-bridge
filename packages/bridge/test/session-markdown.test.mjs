import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSessionMarkdownBlockHtml } from '../src/session-markdown.mjs';

test('renderSessionMarkdownBlockHtml renders markdown tables', () => {
  const html = renderSessionMarkdownBlockHtml(
    [
      '| 组件 | 活动期结论 |',
      '| --- | --- |',
      '| 排行榜 | 基本全锁，见 `disabledFields`。 |',
      '| 抽奖 | 中奖率可改。 |',
    ].join('\n'),
  );

  assert.match(html, /<div class="md-table-wrap"><table>/);
  assert.match(html, /<th>组件<\/th>/);
  assert.match(html, /<td>排行榜<\/td>/);
  assert.match(html, /<code>disabledFields<\/code>/);
  assert.doesNotMatch(html, /\| --- \| --- \|/);
});

test('renderSessionMarkdownBlockHtml keeps nearby paragraphs around tables', () => {
  const html = renderSessionMarkdownBlockHtml(
    [
      '前置说明',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '后续说明',
    ].join('\n'),
  );

  assert.match(html, /^<p>前置说明<\/p>/);
  assert.match(html, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/);
  assert.match(html, /<p>后续说明<\/p>$/);
});

test('renderSessionMarkdownBlockHtml protects local markdown links from emphasis parsing', () => {
  const html = renderSessionMarkdownBlockHtml(
    '| 文件 | 说明 |\n| --- | --- |\n| [ranking-list/index.tsx](/Users/bytedance/code.byted.org/novel_unify_admin_activity/src/index.tsx:40) | 路径含下划线 |',
  );

  assert.match(html, /\[ranking-list\/index\.tsx\]\(\/Users\/bytedance\/code\.byted\.org\/novel_unify_admin_activity\/src\/index\.tsx:40\)/);
  assert.doesNotMatch(html, /novel<em>unify<\/em>admin/);
});
