import { defineConfig } from "drizzle-kit";

// Used only to generate SQL for new migrations: `npx drizzle-kit generate`.
// Copy the generated SQL into a new entry in src/lib/db/migrations.ts (migrations run in the browser).
export default defineConfig({ dialect: "postgresql", schema: "./src/lib/db/schema.ts", out: "./drizzle" });
