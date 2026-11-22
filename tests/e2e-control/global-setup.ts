import { resetDatabase } from "./db";

/** Every run starts from the committed migrations and the fictional seed. */
export default async function globalSetup() {
  await resetDatabase();
}
