# Clearline: roles and working rules

[VERIFIED — repository inventory, 2026-11-06] The table below lists the role files present in `.claude/agents/`. These are AI role definitions, not human employees. Their existence does not establish that a scheduled task is enabled or has run.

## Product direction for this sprint

[ASSUMPTION — founder’s approved positioning] A desk for payment providers that pay suppliers before their customers reimburse them: review the advance, then track what is still owed. The provider makes the credit decision. Clearline does not supply capital or move money.

[VERIFIED — founder’s task brief, 2026-11-06] Keep the earlier stablecoin experiment’s code and address its safety defects, but do not present it as the current product. This direction supersedes older positioning in role files and `company/COMPANY_RULES.md`; the company safety rules still apply.

## Available roles

Each link is the role’s source of instructions. Legacy files are retained rather than silently renamed or deleted.

| Role file | Responsibility |
|---|---|
| [accounting-integrations-engineer](.claude/agents/accounting-integrations-engineer.md) | Owns accounting posting rules and sandbox integrations. |
| [ae-assistant](.claude/agents/ae-assistant.md) | Legacy call-preparation role; prefer sales-closer-assistant for new work. |
| [chief-of-staff](.claude/agents/chief-of-staff.md) | Maintains decisions, handoffs and the founder’s review queue. |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independently reviews code it did not implement. |
| [content-marketer](.claude/agents/content-marketer.md) | Edits sourced product writing and prepares drafts. |
| [crypto-finance-user](.claude/agents/crypto-finance-user.md) | Provides simulated user criticism; never evidence of demand. |
| [crypto-protocol-engineer](.claude/agents/crypto-protocol-engineer.md) | Owns chain evidence, token identity and finality. |
| [devops](.claude/agents/devops.md) | Legacy deployment role; prefer devops-engineer for new work. |
| [devops-engineer](.claude/agents/devops-engineer.md) | Checks builds, hosting and operational risks. |
| [frontend-product-engineer](.claude/agents/frontend-product-engineer.md) | Builds and tests the user workflow. |
| [gtm-strategist](.claude/agents/gtm-strategist.md) | Tests positioning, customer selection and distribution. |
| [lead-designer](.claude/agents/lead-designer.md) | Owns the focused demo, readable screens and accessibility. |
| [matching-engine-engineer](.claude/agents/matching-engine-engineer.md) | Owns attribution rules and matching evaluation. |
| [product-manager](.claude/agents/product-manager.md) | Turns observed customer problems into scoped experiments. |
| [qa-security-engineer](.claude/agents/qa-security-engineer.md) | Tests correctness, security and failure cases. |
| [research-intern](.claude/agents/research-intern.md) | Checks primary sources and qualifies research candidates. |
| [revops-crm-agent](.claude/agents/revops-crm-agent.md) | Maintains prospect records and prepares outreach drafts. |
| [sales-closer-assistant](.claude/agents/sales-closer-assistant.md) | Prepares calls, objections and follow-up drafts. |
| [tech-lead-architect](.claude/agents/tech-lead-architect.md) | Owns architecture, task boundaries and integration planning. |

## Assigning work

1. Read `company/COMPANY_RULES.md`, the applicable role file and the current task brief.
2. Name the output, its owner and its acceptance check. Give parallel owners separate files or worktrees.
3. Have the implementer produce evidence, then have a separate reviewer challenge the change. A self-review is not independent approval.
4. Use the exact role names above. Older references to lead-engineer, qa-tester, research-analyst and sdr refer respectively to crypto-protocol-engineer, qa-security-engineer, research-intern and revops-crm-agent. They are not additional installed roles.

## Boundaries for this sprint

- Read the Company HQ Settings PAUSE flag and check the founder’s recent Clearline replies before external changes. Report unavailable checks; do not invent their results.
- Draft PRs only. Never merge, force-push, delete branches or publish a deployment in this sprint.
- Use synthetic data. Do not commit secrets, generated builds, customer records or large binaries.
- Outreach remains in files for the founder to review. Do not send emails, automate LinkedIn or contact mentors.
- Preserve the meaning of evidence labels. A vendor’s product page supports what it advertises, not measured performance or demand for Clearline.
- Commit as Aashmiin Kaur <aashmiin@gmail.com> where the transport supports an explicit author. Attribute the actual assistant truthfully; do not add a Claude session or co-author to work performed by Codex.
- Keep changes scoped to their task and record checks with the tested revision. Never report a blocked test as passed.

## Schedules and handoffs

[ASSUMPTION — not checked here] Historical schedule descriptions in `company/NIGHT_SHIFT.md` and role files require verification in the scheduling service. This inventory does not enable, disable or reschedule anything. Do not promise that an overnight agent will pick up a task merely because its file exists.

[ASSUMPTION — proposed workflow] Founder’s case notes → product-manager scopes the experiment → tech-lead-architect assigns implementation → code-reviewer and qa-security-engineer check it → founder decides whether to merge. Research and outreach drafts can proceed separately without changing product claims or sending messages.
