import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { csrfProtection, sessionMiddleware } from "./middleware/auth.js";
import { adaptiveTurnstile } from "./middleware/adaptive-turnstile.js";
import { requestContext } from "./middleware/request.js";
import { AppError, errorHandler, notFound } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import type { GoogleVerifier } from "./services/google.js";
import { StorageService } from "./services/storage.js";
import { authRouter } from "./routes/auth.js";
import { phoneRouter } from "./routes/phone.js";
import { listingsRouter } from "./routes/listings.js";
import { uploadsRouter } from "./routes/uploads.js";
import { communicationRouter } from "./routes/communication.js";
import { reputationRouter, transactionsRouter } from "./routes/transactions.js";
import { adminRouter, userOperationsRouter } from "./routes/operations.js";

function r2ConnectSources(config: AppConfig): string[] {
  const endpoint =
    config.R2_ENDPOINT ||
    (config.CLOUDFLARE_ACCOUNT_ID
      ? `https://${config.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : "");
  if (!endpoint) return [];

  const endpointUrl = new URL(endpoint);
  const origins = new Set([endpointUrl.origin]);
  if (
    config.R2_BUCKET_NAME &&
    endpointUrl.hostname.endsWith(".r2.cloudflarestorage.com") &&
    !endpointUrl.hostname.startsWith(`${config.R2_BUCKET_NAME}.`)
  ) {
    const bucketUrl = new URL(endpointUrl.origin);
    bucketUrl.hostname = `${config.R2_BUCKET_NAME}.${endpointUrl.hostname}`;
    origins.add(bucketUrl.origin);
  }
  return [...origins];
}

export function createApp(deps: {
  db: Database;
  config: AppConfig;
  googleVerifier: GoogleVerifier;
  onMessage?: (conversationId: string, message: unknown) => void;
}) {
  const { db, config, googleVerifier } = deps;
  const storage = new StorageService(config);
  const app = express();
  if (config.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, requestId: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "https://accounts.google.com",
            "https://challenges.cloudflare.com",
            "https://verify.msg91.com",
            "https://www.google.com",
            "https://www.gstatic.com",
            "https://cdnjs.cloudflare.com",
          ],
          frameSrc: [
            "https://accounts.google.com",
            "https://challenges.cloudflare.com",
            "https://www.google.com",
          ],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: [
            "'self'",
            config.CLIENT_URL,
            config.API_URL,
            "https://accounts.google.com",
            "https://verify.msg91.com",
            "https://control.msg91.com",
            "https://www.google.com",
            "https://api.db-ip.com",
            "https://ipinfo.io",
            "https://fonts.googleapis.com",
            "https://fonts.gstatic.com",
            "wss:",
            ...r2ConnectSources(config),
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://accounts.google.com",
            "https://fonts.googleapis.com",
            "https://cdnjs.cloudflare.com",
          ],
          fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
          workerSrc: ["'self'", "blob:"],
        },
      },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === config.CLIENT_URL) callback(null, true);
        else callback(new AppError(403, "CORS_DENIED", "Origin not allowed"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "x-csrf-token",
        "x-request-id",
        "x-turnstile-token",
      ],
    }),
  );
  app.use(cookieParser());
  app.use(sessionMiddleware(db, config));
  app.use(csrfProtection(db, config));
  app.use(express.json({ limit: "128kb", strict: true }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", uploadsRouter(db, config, storage));
  app.use(
    "/api/auth/google",
    adaptiveTurnstile(config, { threshold: 6, windowMs: 15 * 60_000 }),
  );
  app.use(
    "/api/auth/google",
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === "test" ? 1_000 : 20,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use("/api/auth", authRouter(db, config, googleVerifier));
  app.use(
    "/api/phone/send",
    adaptiveTurnstile(config, { threshold: 3, windowMs: 60 * 60_000 }),
  );
  app.use(
    "/api/phone",
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === "test" ? 1_000 : 12,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    phoneRouter(db, config),
  );
  app.use(
    "/api",
    adaptiveTurnstile(config, {
      threshold: 2,
      windowMs: 60 * 60_000,
      applies: (method, path) =>
        method === "POST" &&
        (path === "/reports" || /^\/listings\/[^/]+\/submit$/.test(path)),
    }),
  );
  app.use("/api", listingsRouter(db, config, storage));
  app.use(
    "/api",
    rateLimit({
      windowMs: 10_000,
      limit: config.NODE_ENV === "test" ? 8 : 40,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.method !== "POST" ||
        !/^\/conversations\/[^/]+\/messages$/.test(req.path),
    }),
    communicationRouter(db, storage, deps.onMessage),
  );
  app.use("/api", transactionsRouter(db));
  app.use("/api", reputationRouter(db));
  app.use("/api", userOperationsRouter(db));
  app.use("/api/admin", adminRouter(db));
  if (config.NODE_ENV === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (req, res, next) => {
      if (req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/socket.io")) {
        next();
        return;
      }
      res.sendFile(join(webRoot, "index.html"));
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
