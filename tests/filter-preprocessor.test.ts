import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine, FilterList, Request, RequestType } from '@adguard/tsurlfilter';
import { preprocessChromiumMV3 } from '../src/shared/filter-preprocessor.ts';

test('the real filter engine receives exactly the applicable MV3 branch', () => {
  const input = '!#if !env_mv3\n||inactive.example.test^\n!#else\n||active.example.test^\n!#endif';
  const compiled = new FilterList(preprocessChromiumMV3(input)).getContent();
  const engine = Engine.createSync({ filters: [{ id: 0, content: compiled }] });
  const blocked = (host: string) => Boolean(engine.matchRequest(new Request(`https://${host}/ads.js`, 'https://site.example.test/', RequestType.Script)).getBasicResult());
  assert.equal(blocked('inactive.example.test'), false);
  assert.equal(blocked('active.example.test'), true);
});

test('nested boolean expressions and parent inactivity select a single applicable branch', () => {
  const result = preprocessChromiumMV3([
    '!#if env_firefox', '||firefox.test^', '!#if env_chromium', '||nested-inactive.test^', '!#else', '||also-inactive.test^', '!#endif',
    '!#else', '!#if (env_mv3 && env_chromium) && (!cap_html_filtering || env_safari)', '||active.test^', '!#else', '||other.test^', '!#endif', '!#endif',
    '!#if ext_ubol', '||ubol-only.test^', '!#else', '||not-ubol.test^', '!#endif',
  ].join('\n'));
  assert.deepEqual(result.split('\n').filter(line => line && !line.startsWith('!')), ['||active.test^', '||not-ubol.test^']);
});

test('preprocessing preserves line endings and UTF-16 source offsets and is idempotent', () => {
  const input = '  !#if env_firefox\r\n  ||inactive.test^\r!#else\n||active.test^\r\n!#endif\n';
  const result = preprocessChromiumMV3(input);
  assert.equal(result.length, input.length);
  assert.deepEqual([...result.matchAll(/\r\n|\n|\r/g)].map(match => [match.index, match[0]]), [...input.matchAll(/\r\n|\n|\r/g)].map(match => [match.index, match[0]]));
  assert.equal(result.indexOf('||active.test^'), input.indexOf('||active.test^'));
  assert.equal(preprocessChromiumMV3(result), result);
  const supplementary = '!#if env_firefox\n😀unsupported\n!#endif';
  assert.equal(preprocessChromiumMV3(supplementary).length, supplementary.length);
});

test('malformed or unmatched directives and duplicate else fail closed', () => {
  for (const input of ['!#else', '!#endif', '!#if env_mv3', '!#if', '!#if (env_mv3 &&)', '!#if env_mv3\n!#else\n!#else\n!#endif', '!#if env_mv3\n!#else extra\n!#endif', '!#if env_mv3\n!#endif extra', '!#unknown env_mv3']) {
    assert.throws(() => preprocessChromiumMV3(input), /Bộ tiền xử lý dòng/);
  }
});

test('unknown positive and negative environment variables are rejected even in inactive parents', () => {
  for (const expression of ['future_capability', '!future_capability', 'env_mv3 || future_capability']) {
    assert.throws(() => preprocessChromiumMV3(`!#if ${expression}\n||ads.test^\n!#endif`), /Biến môi trường không được hỗ trợ/);
  }
  assert.throws(() => preprocessChromiumMV3('!#if env_firefox\n!#if !unknown\n!#endif\n!#endif'), /Biến môi trường không được hỗ trợ/);
});

test('includes are rejected in active and inactive branches and nesting is bounded', () => {
  assert.throws(() => preprocessChromiumMV3('!#include https://remote.test/list.txt'), /tải thêm nguồn từ xa/);
  assert.throws(() => preprocessChromiumMV3('!#if env_firefox\n!#include sibling.txt\n!#endif'), /tải thêm nguồn từ xa/);
  const nested = (depth: number) => `${'!#if env_mv3\n'.repeat(depth)}||ads.test^\n${'!#endif\n'.repeat(depth)}`;
  assert(preprocessChromiumMV3(nested(32)).includes('||ads.test^'));
  assert.throws(() => preprocessChromiumMV3(nested(33)), /Tối đa 32/);
});
