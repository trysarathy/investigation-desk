# Executed validation

All results below are [VERIFIED] from this review's commands, not prior PR descriptions. No secrets or generated builds are included in the commits.

| Target | Command / result |
| --- | --- |
| main 24fdab4 | `npm ci --no-audit --no-fund`: passed |
| main 24fdab4 | `npx tsc --noEmit`: passed |
| main 24fdab4 | First `npx vitest run`: 571 passed, 57 skipped, one 5-second audit-route timeout |
| main 24fdab4 | Isolated timeout rerun: 11/11 passed; full rerun: 572 passed, 57 skipped |
| main 24fdab4 | `npm run qa`: failed because the script is absent; not silently substituted |
| main 24fdab4 | `npm run build`: passed |
| PR71 merge 8847bc9 | `python3 -m unittest discover -s funding-replay/tests -p 'test_*.py'`: 139 passed |
| PR71 tester browser | Recipient suite attempted; bundled browser absent; install failed; system Chromium failed to create local socket. No browser-pass claim. |
| Attribution fix based on S | Four new cases fail before fix; 830 passed, 67 skipped, 1 todo after fix. TypeScript and production build passed. |
| Finality-copy fix based on S | 826 passed, 67 skipped, 1 todo. TypeScript and production build passed. |

The two code branches start independently from 28b62de. Their totals overlap and must not be added together as coverage. Their combined merge still needs integration validation. Skipped live tests remain unverified. Source fix branches do not change the published demo until reviewed, merged and deployed.

Paper review: all seven pages rendered and visually inspected; proposed text corrections supplied separately. Old six-slide brief text extracted and source inspected. Current website source inspected; no fresh rendered website/browser review claimed.
