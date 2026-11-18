import assert from 'node:assert/strict';
import test from 'node:test';
import { safeXvideosUrl } from '../lib/preview-url.mjs';

test('accepts an explicit HTTPS preview on the authorized source domain', () => {
  assert.equal(
    safeXvideosUrl('https://cdn.xvideos.com/preview/sample.mp4', { source: 'xvideos' }),
    'https://cdn.xvideos.com/preview/sample.mp4',
  );
});

test('rejects insecure, unrelated, credentialed, or nonstandard-port preview URLs', () => {
  const item = { source: 'xvideos' };
  for (const url of [
    'http://xvideos.com/preview/sample.mp4',
    'https://xvideos.com.evil.invalid/preview/sample.mp4',
    'https://evil.invalid/xvideos.com/preview/sample.mp4',
    'https://user:x@xvideos.com/preview/sample.mp4',
    'https://xvideos.com:444/preview/sample.mp4',
    '//xvideos.com/preview/sample.mp4',
    '',
    null,
  ]) {
    assert.equal(safeXvideosUrl(url, item), null, String(url));
  }
});

test('rejects preview URLs for sources that are not enabled', () => {
  assert.equal(safeXvideosUrl('https://xvideos.com/preview/sample.mp4', { source: 'xnxx' }), null);
  assert.equal(safeXvideosUrl('https://xvideos.com/preview/sample.mp4', { source: 'pornhub' }), null);
});
