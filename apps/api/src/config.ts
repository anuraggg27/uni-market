import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

loadDotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ENV: z.string().default("local"),
    DEV_MODE: booleanString.default(false),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CLIENT_URL: z.string().url().default("http://localhost:5173"),
    API_URL: z.string().url().default("http://localhost:4000"),
    DATABASE_URL: z.string().default("pglite://.data/marketplace"),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    SESSION_SECRET: z
      .string()
      .min(32)
      .default("development-session-secret-change-me-32"),
    CSRF_SECRET: z
      .string()
      .min(32)
      .default("development-csrf-secret-change-me-1234"),
    OTP_SERVICE_API_KEY: z.string().default(""),
    OTP_SERVICE_BASE_URL: z.string().url().default("https://2factor.in/API/V1"),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    SMTP_FROM_NAME: z.string().default("Campus Market"),
    SMTP_FROM_EMAIL: z.string().email().default("noreply@example.test"),
    CLOUDFLARE_ACCOUNT_ID: z.string().default(""),
    R2_ACCESS_KEY_ID: z.string().default(""),
    R2_SECRET_ACCESS_KEY: z.string().default(""),
    R2_BUCKET_NAME: z.string().default(""),
    R2_ENDPOINT: z.string().default(""),
    TURNSTILE_SITE_KEY: z.string().default(""),
    TURNSTILE_SECRET_KEY: z.string().default(""),
    BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
    MAX_LISTING_IMAGES: z.coerce.number().int().min(1).max(12).default(8),
    MAX_IMAGE_SIZE_MB: z.coerce.number().min(1).max(20).default(5),
    MIN_IMAGE_WIDTH: z.coerce.number().int().default(320),
    MIN_IMAGE_HEIGHT: z.coerce.number().int().default(240),
    MAX_IMAGE_DIMENSION: z.coerce.number().int().default(5000),
    OTP_EXPIRY_MINUTES: z.coerce.number().int().default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().default(60),
    OTP_MAX_IP_HOUR: z.coerce.number().int().default(15),
    TRUST_PROXY: booleanString.default(false),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === "production" && env.DEV_MODE) {
      context.addIssue({
        code: "custom",
        path: ["DEV_MODE"],
        message: "DEV_MODE must be false in production",
      });
    }
    if (env.NODE_ENV === "production") {
      const required = [
        "DATABASE_URL",
        "GOOGLE_CLIENT_ID",
        "SESSION_SECRET",
        "CSRF_SECRET",
        "OTP_SERVICE_API_KEY",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "TURNSTILE_SECRET_KEY",
      ] as const;
      for (const key of required) {
        if (
          !env[key] ||
          env[key].includes("development-") ||
          env.DATABASE_URL.startsWith("pglite:")
        ) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required and must be production-safe`,
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return result.data;
}
