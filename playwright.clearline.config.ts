import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
 testDir:"./tests/browser",
 testMatch:"clearline-console.spec.ts",
 timeout:45000,
 retries:1,
 use:{baseURL:"http://127.0.0.1:3184",trace:"retain-on-failure",screenshot:"only-on-failure"},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},
  {name:"mobile",use:{...devices["iPhone 13"],browserName:"chromium"}}],
 webServer:{command:"npx next start -H 127.0.0.1 -p 3184",url:"http://127.0.0.1:3184/clearline",
  timeout:120000,reuseExistingServer:false,
  env:{CLEARLINE_CUSTOMER_PREVIEW:"1",NEXT_TELEMETRY_DISABLED:"1"}},
 reporter:[["line"]]
});