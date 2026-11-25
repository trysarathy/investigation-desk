/**
 * v1 (#169): chain_reads keeps one partition per month; a read in a month without one is refused. The owner-only
 * command `control:admin chain-read-partitions` (and migration 0047) keep this many months ahead of the current month.
 * Run the command monthly: docs/runbooks/CHAIN_READ_PARTITIONS.md.
 */
export const CHAIN_READ_PARTITION_MONTHS_AHEAD = 24;
export const CHAIN_READ_PARTITION_MONTHS_MAX = 120;

/** The command's --months-ahead value: the default when absent; a whole number from 0 to 120, otherwise refused. */
export function monthsAheadArg(args: readonly string[]): number {
  const i = args.indexOf("--months-ahead");
  const ahead = i >= 0 ? Number(args[i + 1]) : CHAIN_READ_PARTITION_MONTHS_AHEAD;
  if (!Number.isInteger(ahead) || ahead < 0 || ahead > CHAIN_READ_PARTITION_MONTHS_MAX) throw new Error(`--months-ahead must be a whole number from 0 to ${CHAIN_READ_PARTITION_MONTHS_MAX}`);
  return ahead;
}
