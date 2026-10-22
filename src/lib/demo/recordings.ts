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

export interface RecordedExchange {
  request: { method: string; url: string; body?: string };
  response: { status: number; headers: Record<string, string>; body: string };
}
export interface Recording { name: string; hash: string; explorer: string; recordedAt: string; exchanges: RecordedExchange[] }

export const RECORDINGS: Recording[] = [
  tronBitfinex, tronTreasury, tronFrozen, ethBinance14, polygonHot20, bscHot16, bscHot11, unknownHash,
] as Recording[];
