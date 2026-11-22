import { resetMerchantDatabase } from "./db";

export default async function globalSetup() {
  await resetMerchantDatabase();
}
