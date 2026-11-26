import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundingStore } from '../../src/lib/funding/store';

// A read that overlapped a write could fail: the reader opened the old file, the writer renamed a new one over it,
// and the reader's private-file check then refused the replaced file as unsafe (seen in the server log as
// "Private file is unsafe…" from FundingStore.load). That was the rare HTTP 500 behind the flaky funding browser suite.
// A load therefore runs inside the store's lock, after any write in progress.
describe('funding store: reads wait for writes', () => {
  it('a load started during an update resolves only after the update is written', async () => {
    const store = new FundingStore(join(await mkdtemp(join(tmpdir(), 'funding-race-')), 'funding.json'));
    await store.update((d) => [d, undefined]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const write = store.update(async (d) => { await gate; order.push('write'); return [d, undefined]; });
    const read = store.load().then((d) => { order.push(`read r${d.revision}`); });
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([]); // the read is waiting for the write
    release();
    await Promise.all([write, read]);
    expect(order).toEqual(['write', 'read r2']);
  });
});
