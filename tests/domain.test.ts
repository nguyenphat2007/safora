import assert from 'node:assert/strict';
import test from 'node:test';
import { hostname, isAllowed, matchesDomain, normalizeDomain } from '../src/shared/defaults.ts';

test('domain boundaries include descendants and exclude deceptive suffixes', () => {
  for (const host of ['example.com', 'news.example.com', 'deep.news.example.com']) assert.equal(matchesDomain(host, 'example.com'), true);
  for (const host of ['notexample.com', 'example.com.evil.test', 'example.net']) assert.equal(matchesDomain(host, 'example.com'), false);
  assert.equal(matchesDomain('example.com', 'news.example.com'), false);
});

test('allowlist parent domains cover descendants without covering siblings', () => {
  assert.equal(isAllowed('deep.news.example.com', ['news.example.com']), true);
  assert.equal(isAllowed('news.example.com', ['example.com']), true);
  assert.equal(isAllowed('shop.example.com', ['news.example.com']), false);
  assert.equal(isAllowed('example.com.evil.test', ['example.com']), false);
  assert.equal(isAllowed('example.com', []), false);
});

test('domain exclusions recognize the excluded subtree without excluding siblings', () => {
  assert.equal(matchesDomain('private.example.com', 'private.example.com'), true);
  assert.equal(matchesDomain('deep.private.example.com', 'private.example.com'), true);
  assert.equal(matchesDomain('public.example.com', 'private.example.com'), false);
  assert.equal(matchesDomain('private.example.com.evil.test', 'private.example.com'), false);
});

test('hostname accepts web documents and normalization rejects non-domain input', () => {
  assert.equal(hostname('https://NEWS.Example.com/article?q=1'), 'news.example.com');
  assert.equal(hostname('chrome://extensions'), '');
  assert.equal(hostname('file:///tmp/example.html'), '');
  assert.equal(hostname('not a URL'), '');
  assert.equal(normalizeDomain(' Example.COM. '), 'example.com');
  assert.equal(normalizeDomain('https://example.com/'), 'example.com');
  assert.equal(normalizeDomain('tênmiền.vn'), 'xn--tnmin-hsa0954c.vn');
  for (const invalid of ['example.com/path', 'example.com:8080', '*.example.com', 'https://user@example.com', 'example.com?q=1', 'example.com#anchor']) assert.throws(() => normalizeDomain(invalid));
});
