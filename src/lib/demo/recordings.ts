// Real chain responses recorded from TronGrid, Etherscan V2 and the public RPCs (tests/fixtures/live).
// Imported statically so they ship with the server build. They are public chain data only.

import ethBinance14 from "../../../tests/fixtures/live/eth-binance14-to-tether-treasury.json";
import bscHot11 from "../../../tests/fixtures/live/bsc-binance-hot11-below-minimum.json";
import bscHot16 from "../../../tests/fixtures/live/bsc-binance-hot16-withdrawal.json";
import polygonHot20 from "../../../tests/fixtures/live/polygon-usdt0-to-binance-hot20.json";
import tronBitfinex from "../../../tests/fixtures/live/tron-bitfinex-to-tether-treasury.json";
import tronFrozen from "../../../tests/fixtures/live/tron-frozen-sender.json";
import tronTreasury from "../../../tests/fixtures/live/tron-tether-treasury-to-binance.json";
import unknownHash from "../../../tests/fixtures/live/unknown-hash-not-found.json";
// Payout-side transfers (scripts/record-payouts.ts): recipients are not demo deposit addresses.
import bscPayout1 from "../../../tests/fixtures/live/bsc-payout-1.json";
import bscPayout2 from "../../../tests/fixtures/live/bsc-payout-2.json";
import bscPayout3 from "../../../tests/fixtures/live/bsc-payout-3.json";
import bscPayout4 from "../../../tests/fixtures/live/bsc-payout-4.json";
import bscPayout5 from "../../../tests/fixtures/live/bsc-payout-5.json";
import bscPayout6 from "../../../tests/fixtures/live/bsc-payout-6.json";

export interface RecordedExchange {
  request: { method: string; url: string; body?: string };
  response: { status: number; headers: Record<string, string>; body: string };
}
export interface Recording { name: string; hash: string; explorer: string; recordedAt: string; exchanges: RecordedExchange[] }

export const RECORDINGS: Recording[] = [
  tronBitfinex, tronTreasury, tronFrozen, ethBinance14, polygonHot20, bscHot16, bscHot11, unknownHash,
  bscPayout1, bscPayout2, bscPayout3, bscPayout4, bscPayout5, bscPayout6,
] as Recording[];
