import { createServer } from "node:http";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
import * as schema from "../../apps/api/src/db/schema";
import type { GoogleVerifier } from "../../apps/api/src/services/google";
import { attachSocket } from "../../apps/api/src/socket";

const apiPort = Number(process.env.E2E_API_PORT ?? "4000");
const webPort = Number(process.env.E2E_WEB_PORT ?? "5173");
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

const client = new PGlite();
const db = drizzle(client, { schema });
await migrate(db, {
  migrationsFolder: resolve(process.cwd(), "apps/api/drizzle"),
});
for (const [sortOrder, [name, slug]] of [
  ["Books", "books"],
  ["Electronics", "electronics"],
  ["Furniture", "furniture"],
  ["Cycles", "cycles"],
].entries())
  await db.insert(schema.categories).values({ name, slug, sortOrder });
await db.insert(schema.academicDomains).values({
  domain: "students.example.edu",
  institutionName: "E2E University",
  sourceUrl: "https://students.example.edu",
});
const verifier: GoogleVerifier = {
  async verify(credential) {
    const id = credential
      .replace(/[^a-z0-9-]/gi, "")
      .replace(/x+$/, "")
      .slice(0, 30)
      .toLowerCase();
    return {
      sub: `e2e-${id}`,
      email: `${id}@example.test`,
      emailVerified: true,
      name: id.replaceAll("-", " ") || "E2E Student",
    };
  },
};
const config = loadConfig({
  NODE_ENV: "test",
  APP_ENV: "e2e",
  DEV_MODE: "true",
  PORT: String(apiPort),
  CLIENT_URL: webUrl,
  API_URL: apiUrl,
  DATABASE_URL: "pglite://:memory:",
  SESSION_SECRET: "e2e-session-secret-at-least-32-chars",
  CSRF_SECRET: "e2e-csrf-secret-at-least-32-chars",
  SMTP_FROM_EMAIL: "test@example.com",
  BOOTSTRAP_ADMIN_EMAILS: "moderator@example.test,support@example.test",
});
const app = createApp({ db, config, googleVerifier: verifier });
const server = createServer(app);
attachSocket(server, db, config);
server.listen(apiPort, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => void client.close().then(() => process.exit(0))),
  );
