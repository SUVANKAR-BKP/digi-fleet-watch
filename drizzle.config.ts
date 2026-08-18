import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://fleetwatch:fleetwatch@localhost:5432/fleetwatch",
  },
  verbose: true,
  strict: true,
});
