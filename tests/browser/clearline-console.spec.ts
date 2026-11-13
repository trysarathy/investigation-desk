import {test,expect} from "@playwright/test";
import {mkdirSync} from "node:fs";
test("Connect payment completes and appears in Control reconciliation",async({page},testInfo)=>{
 await page.goto("/clearline");
 await expect(page.getByText("Money movement, in context.")).toBeVisible();
 await page.getByRole("button",{name:/Payment intents/}).click();
 await expect(page.getByText("Create a payment",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Create test intent"}).click();
 await expect(page.getByText("Test intent created.")).toBeVisible({timeout:5000});
 await page.getByRole("button",{name:/Northline Payments \(sandbox\).*Eligible/}).click();
 await page.getByRole("button",{name:"Accept selected quote"}).click();
 for(const label of ["Simulate Approved","Simulate Submitted","Simulate In transit","Simulate Completed"]){
  await page.getByRole("button",{name:label}).click();
 }
 await page.getByRole("button",{name:/Reconciliation/}).click();
 await expect(page.getByText("INV-2026-153")).toBeVisible();
 await expect(page.getByText("Match (unverified)").first()).toBeVisible();
 await page.getByRole("button",{name:/Payments/}).click();
 await page.getByRole("row").filter({hasText:"INV-2026-153"}).click();
 await expect(page.getByText("What happened?")).toBeVisible();
 await expect(page.getByText(/settlement statement has not been independently verified/i)).toBeVisible();
 mkdirSync("clearline-browser-artifacts",{recursive:true});
 await page.screenshot({path:"clearline-browser-artifacts/payment-"+testInfo.project.name+".png",fullPage:true});
});
test("preview protects old finance routes and serves real sandbox docs",async({page})=>{
 await page.goto("/");
 await expect(page).toHaveURL(/\/clearline$/);
 await page.goto("/requests");
 await expect(page.getByText("Not found")).toBeVisible();
 await page.goto("/clearline/docs");
 await expect(page.getByText("Build on one payment lifecycle.")).toBeVisible();
 await page.goto("/mentor-demo");
 await expect(page.getByRole("heading",{name:"Work queue"})).toBeVisible();
});