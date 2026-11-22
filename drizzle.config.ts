import { defineConfig } from "drizzle-kit";

// Migrations run as the schema OWNER (DATABASE_OWNER_URL), never as the runtime role.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
  strict: true,
});
