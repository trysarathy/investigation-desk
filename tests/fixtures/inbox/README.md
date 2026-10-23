Synthetic records for tests/inbox.test.ts and tests/export.test.ts (chunk 2: exceptions and
inbox). Instructions, provider rows ("TP", an invented provider format with fee and return rows),
payout ledger and bank rows are made up. Every transaction hash is a real public BNB Chain USDT
transfer recorded in tests/fixtures/live/bsc-payout-*.json (scripts/record-payouts.ts). None of
them goes to a demo deposit address, so payouts never reuse a deposit-demo transfer.
provider-2-later-return.csv is a later report carrying a refund of a payment the provider had
already reported complete. No real customer data.
