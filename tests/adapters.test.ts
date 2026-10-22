import { describe, it, expect } from 'vitest';
import { FallbackSource } from '../src/lib/chain/adapters';
import type { EvmSource } from '../src/lib/chain/evm';
const source = (call: EvmSource['call']): EvmSource => ({ kind: 'public-rpc', call });
describe('provider failover', () => {
  it('recovers a failed provider and exposes observed health', async () => {
    const s = new FallbackSource([source(async () => { throw Error('down'); }), source(async () => '0x2')]);
    expect(await s.call('eth_blockNumber', [], {ttlSec: 5}, [])).toBe('0x2');
    expect(s.health()).toMatchObject({provider: 1, ok: true});
  });
  it('does not turn not-found into a different provider answer', async () => {
    const s = new FallbackSource([source(async () => null), source(async () => { throw Error('must not run'); })]);
    expect(await s.call('eth_getTransactionByHash', [], {ttlSec: 5}, [])).toBeNull();
  });
  it('propagates total outage', async () => {
    const s = new FallbackSource([source(async () => { throw Error('down'); })]);
    await expect(s.call('eth_blockNumber', [], {ttlSec: 5}, [])).rejects.toThrow('down');
  });
});
