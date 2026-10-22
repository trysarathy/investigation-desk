// Minimal ABI decoding shared by the Tron and EVM fetchers. Only what deposit checks need:
// ERC-20/TRC-20 Transfer events, transfer(address,uint256) call data, and symbol()/decimals().

export const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SELECTOR = "a9059cbb";

const strip0x = (h: string) => h.replace(/^0x/i, "").toLowerCase();

/** Last 20 bytes of a 32-byte word, as 40 hex chars (no prefix). */
export const wordToAddressHex = (word: string) => strip0x(word).padStart(64, "0").slice(24);

/** Integer token units to a plain decimal string: 49975000000000 with 6 decimals = "49975000.000000". */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const s = value.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export function hexToBigInt(h: string): bigint | undefined {
  const s = strip0x(h);
  if (!/^[0-9a-f]*$/.test(s)) return undefined;
  return s === "" ? 0n : BigInt(`0x${s}`);
}

/** Decodes an ABI `string` return value, or a legacy `bytes32` one. */
export function decodeAbiString(hex: string): string | undefined {
  const s = strip0x(hex);
  if (s.length < 64) return undefined;
  if (s.length >= 128) {
    const offset = Number(BigInt(`0x${s.slice(0, 64)}`)) * 2;
    const len = Number(BigInt(`0x${s.slice(offset, offset + 64)}`)) * 2;
    if (offset + 64 + len <= s.length && len <= 256) {
      return Buffer.from(s.slice(offset + 64, offset + 64 + len), "hex").toString("utf8");
    }
  }
  return Buffer.from(s.slice(0, 64), "hex").toString("utf8").replace(/\0+$/, "") || undefined;
}

export function decodeAbiUint(hex: string): number | undefined {
  const v = hexToBigInt(strip0x(hex).slice(0, 64));
  return v !== undefined && v < 256n ? Number(v) : undefined;
}

export interface RawLog { address: string; topics: string[]; data: string; index: number }

/** Transfer(address,address,uint256) logs, decoded. Addresses are 40-hex, without prefix. */
export function decodeTransferLogs(logs: RawLog[]) {
  return logs
    .filter((l) => l.topics.length === 3 && strip0x(l.topics[0]) === TRANSFER_TOPIC)
    .map((l) => ({
      index: l.index,
      contractHex: strip0x(l.address).slice(-40),
      fromHex: wordToAddressHex(l.topics[1]),
      toHex: wordToAddressHex(l.topics[2]),
      value: hexToBigInt(strip0x(l.data).slice(0, 64)),
    }));
}

/** transfer(address,uint256) call data: the intended transfer of a call that failed. */
export function decodeTransferCall(data: string): { toHex: string; value: bigint } | undefined {
  const s = strip0x(data);
  if (!s.startsWith(TRANSFER_SELECTOR) || s.length < 8 + 128) return undefined;
  const value = hexToBigInt(s.slice(72, 136));
  return value === undefined ? undefined : { toHex: wordToAddressHex(s.slice(8, 72)), value };
}
