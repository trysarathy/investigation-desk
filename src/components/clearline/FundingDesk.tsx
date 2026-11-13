"use client";
import { FUNDING_DESK_HREF } from "./nav";
import { LinkBtn, Panel, ui } from "./ui";

/** Treasury & Funding → the specialist Funding Desk workflow, which runs in this deployment at /mentor-demo. */
export function FundingDeskPanel() {
  return (
    <Panel title="Specialist workflow: Funding Desk" id="funding-desk">
      <div className={ui.panelBody} data-testid="funding-desk-panel">
        <p style={{ marginTop: 0 }}>
          The Funding Desk is the specialist workflow for one advance from start to finish: the advance review, the
          maker–checker treasury approval, the supplier payout and the repayment exception. It uses its own fictional
          data and opens outside this console, in the same deployment. Nothing you do there changes this workspace.
        </p>
        <LinkBtn href={FUNDING_DESK_HREF}>Open the Funding Desk workflow</LinkBtn>
      </div>
    </Panel>
  );
}
