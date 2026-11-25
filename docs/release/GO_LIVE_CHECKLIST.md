# Go-live checklist

> **Status: incomplete. This checklist will be completed in Phase 8.** Items are added as decisions are made; an item
> here is a reminder, not evidence that it was done. Tick an item only with the date, who did it and the evidence.

## Database

- [ ] **chain_reads partitions 24 months ahead** (v1 #169): the owner runs `chain-read-partitions` monthly
      (docs/runbooks/CHAIN_READ_PARTITIONS.md). Before go-live, check the last partition is at least 23 months after
      the current month.
- [ ] **Drop `chain_reads_unpartitioned` only after 30 days of verified use** (v1 #169; the contract step of migration
      0036's expand/contract). Not before: until it is dropped it is the rollback copy. "Verified use" means 30 days in
      which the partitioned `chain_reads` served every chain read with no refused month and no restore from the old
      table. As the owner (`DATABASE_OWNER_URL`), in one session:

      ```sql
      -- 1. every row of the old table is in the partitioned table, same key (expected: 0)
      SELECT count(*) AS missing
      FROM chain_reads_unpartitioned u
      WHERE NOT EXISTS (SELECT 1 FROM chain_reads c WHERE c.org_id = u.org_id AND c.id = u.id AND c.at = u.at);

      -- 2. only if step 1 returned 0: drop it (no CASCADE, so anything still depending on it refuses the drop)
      BEGIN;
      DROP TABLE chain_reads_unpartitioned;
      COMMIT;
      ```

      Record the date, the owner who ran it and the result of step 1.
