// DEMO ONLY. The recorded data the demo slices replay, imported statically so it ships inside the
// server build (the Docker runtime image has no tests/ folder; src/lib/demo/recordings.ts does the same).
// Public chain data and sample invoices only. Nothing here is read from disk at request time.

import catalogue from "../../../tests/fixtures/real/scenarios/catalogue.json";
import freezeIndex from "../../../tests/fixtures/real/freeze-demo-index.json";
import finalityEth from "../../../tests/fixtures/real/FINALITY-ETH-ETHERSCAN.json";
import finalityTron from "../../../tests/fixtures/real/FINALITY-TRON.json";
import s_bsc_01 from "../../../tests/fixtures/real/scenarios/BSC-01.json";
import s_eth_01 from "../../../tests/fixtures/real/scenarios/ETH-01.json";
import s_eth_02 from "../../../tests/fixtures/real/scenarios/ETH-02.json";
import s_eth_03 from "../../../tests/fixtures/real/scenarios/ETH-03.json";
import s_eth_04 from "../../../tests/fixtures/real/scenarios/ETH-04.json";
import s_eth_05 from "../../../tests/fixtures/real/scenarios/ETH-05.json";
import s_eth_06 from "../../../tests/fixtures/real/scenarios/ETH-06.json";
import s_eth_07 from "../../../tests/fixtures/real/scenarios/ETH-07.json";
import s_eth_08 from "../../../tests/fixtures/real/scenarios/ETH-08.json";
import s_fake_06 from "../../../tests/fixtures/real/scenarios/FAKE-06.json";
import s_fake_hg from "../../../tests/fixtures/real/scenarios/FAKE-HG.json";
import s_poison_1 from "../../../tests/fixtures/real/scenarios/POISON-1.json";
import s_poison_2 from "../../../tests/fixtures/real/scenarios/POISON-2.json";
import s_trn_01 from "../../../tests/fixtures/real/scenarios/TRN-01.json";
import f_eth_01 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-01.json";
import f_eth_02 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-02.json";
import f_eth_03 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-03.json";
import f_eth_04 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-04.json";
import f_eth_05 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-05.json";
import f_eth_06 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-06.json";
import f_eth_07 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-07.json";
import f_eth_08 from "../../../tests/fixtures/real/FREEZE-DEMO-ETH-08.json";
import f_poison_1 from "../../../tests/fixtures/real/FREEZE-DEMO-POISON-1.json";
import f_poison_2 from "../../../tests/fixtures/real/FREEZE-DEMO-POISON-2.json";
import f_trn_01 from "../../../tests/fixtures/real/FREEZE-DEMO-TRN-01.json";
import type { Recording } from "../demo/recordings";

export const CATALOGUE = catalogue as unknown as { scenarios: unknown[] };
export const FREEZE_INDEX = freezeIndex as unknown as { rows: unknown[] };

/** Recordings by file name, as the catalogue and the freeze index name them. */
const FILES: Record<string, unknown> = {
  "FINALITY-ETH-ETHERSCAN.json": finalityEth, "FINALITY-TRON.json": finalityTron,
  "BSC-01.json": s_bsc_01, "ETH-01.json": s_eth_01, "ETH-02.json": s_eth_02, "ETH-03.json": s_eth_03, "ETH-04.json": s_eth_04, "ETH-05.json": s_eth_05, "ETH-06.json": s_eth_06, "ETH-07.json": s_eth_07, "ETH-08.json": s_eth_08, "FAKE-06.json": s_fake_06, "FAKE-HG.json": s_fake_hg, "POISON-1.json": s_poison_1, "POISON-2.json": s_poison_2, "TRN-01.json": s_trn_01,
  "FREEZE-DEMO-ETH-01.json": f_eth_01, "FREEZE-DEMO-ETH-02.json": f_eth_02, "FREEZE-DEMO-ETH-03.json": f_eth_03, "FREEZE-DEMO-ETH-04.json": f_eth_04, "FREEZE-DEMO-ETH-05.json": f_eth_05, "FREEZE-DEMO-ETH-06.json": f_eth_06, "FREEZE-DEMO-ETH-07.json": f_eth_07, "FREEZE-DEMO-ETH-08.json": f_eth_08, "FREEZE-DEMO-POISON-1.json": f_poison_1, "FREEZE-DEMO-POISON-2.json": f_poison_2, "FREEZE-DEMO-TRN-01.json": f_trn_01,
};

export function recording(file: string): Recording {
  const r = FILES[file];
  if (!r) throw new Error(`Not a demo recording: ${file}`);
  return r as Recording;
}
