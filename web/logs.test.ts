import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findEventInChunks } from './src/logs.ts';

test('event searches cover long histories with contiguous inclusive ranges of at most 10,000 blocks', async () => {
  const ranges: [bigint, bigint][] = [];
  const start = 10_482_962n;
  const latest = start + 105_000n;
  const result = await findEventInChunks(start, latest, async (from, to) => {
    ranges.push([from, to]);
    assert.ok(to - from + 1n <= 10_000n);
    return [];
  }, () => true);
  assert.equal(result, undefined);
  assert.equal(ranges.length, 11);
  assert.equal(ranges[0][0], start);
  assert.equal(ranges.at(-1)?.[1], latest);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1] + 1n);
});

test('search stops at the first matching event, including chunk boundaries, ignoring removed logs', async () => {
  for (const height of [100n, 10_099n, 10_100n, 20_100n]) {
    let calls = 0;
    const event = { height, removed: false };
    const result = await findEventInChunks(100n, 20_100n, async (from, to) => {
      calls++;
      return height >= from && height <= to ? [{ height, removed: true }, event] : [];
    }, event => !event.removed);
    assert.equal(result, event);
    assert.equal(calls, Number((height - 100n) / 10_000n) + 1);
  }
});

test('single-block and empty ranges are handled without over-querying', async () => {
  let calls = 0;
  const read = async (from: bigint, to: bigint) => { calls++; assert.equal(from, to); return ['event']; };
  assert.equal(await findEventInChunks(5n, 5n, read, () => true), 'event');
  assert.equal(await findEventInChunks(6n, 5n, read, () => true), undefined);
  assert.equal(calls, 1);
});

test('RPC errors propagate instead of silently skipping blocks', async () => {
  await assert.rejects(findEventInChunks(0n, 30_000n, async () => { throw new Error('RPC unavailable'); }, () => true), /RPC unavailable/);
});
