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
    MSG91_WIDGET_ID: z.string().default(""),
    MSG91_TOKEN_AUTH: z.string().default(""),
    MSG91_AUTH_KEY: z.string().default(""),
    MSG91_OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
    MSG91_VERIFY_ACCESS_TOKEN_URL: z
      .string()
      .url()
      .default("https://api.msg91.com/api/v5/widget/verifyAccessToken"),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    SMTP_FROM_NAME: z.string().default("Uni Market"),
    SMTP_FROM_EMAIL: z.string().email().default("noreply@example.test"),
    DATA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    CUSTOMER_CARE_EMAIL: z.string().email().default("support@uni.rocks"),
    GRIEVANCE_EMAIL: z.string().email().default("grievance@uni.rocks"),
    PRIVACY_EMAIL: z.string().email().default("privacy@uni.rocks"),
    LEGAL_POLICY_VERSION: z.string().default("2026-08-27"),
    EMAIL_PROVIDER_NAME: z.string().default("Configured SMTP provider"),
    EMAIL_PROVIDER_REGION: z.string().default("Contract review required"),
    DATABASE_REGION: z.string().default("Contract review required"),
    OBJECT_STORAGE_REGION: z.string().default("Contract review required"),
    LOG_REGION: z.string().default("Contract review required"),
    RETENTION_MODE: z.enum(["dry-run", "enforce"]).default("dry-run"),
    GRIEVANCE_RETENTION_DAYS: z.coerce.number().int().min(180).max(3650).default(730),
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
        "CLIENT_URL",
        "API_URL",
        "GOOGLE_CLIENT_ID",
        "SESSION_SECRET",
        "CSRF_SECRET",
        "MSG91_WIDGET_ID",
        "MSG91_TOKEN_AUTH",
        "MSG91_AUTH_KEY",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "TURNSTILE_SECRET_KEY",
        "DATA_ENCRYPTION_KEY",
        "CUSTOMER_CARE_EMAIL",
        "GRIEVANCE_EMAIL",
        "PRIVACY_EMAIL",
        "EMAIL_PROVIDER_NAME",
        "EMAIL_PROVIDER_REGION",
        "DATABASE_REGION",
        "OBJECT_STORAGE_REGION",
        "LOG_REGION",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
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
      if (env.LEGAL_POLICY_VERSION !== "2026-08-27") {
        context.addIssue({ code: "custom", path: ["LEGAL_POLICY_VERSION"], message: "LEGAL_POLICY_VERSION must match the reviewed policy release" });
      }
      if (env.DATA_ENCRYPTION_KEY === "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
        context.addIssue({ code: "custom", path: ["DATA_ENCRYPTION_KEY"], message: "DATA_ENCRYPTION_KEY must be replaced in production" });
      }
      if (!env.CLIENT_URL.startsWith("https://") || !env.API_URL.startsWith("https://")) {
        context.addIssue({ code: "custom", path: ["CLIENT_URL"], message: "Production public origins must use HTTPS" });
      }
      if (!env.R2_ENDPOINT && !env.CLOUDFLARE_ACCOUNT_ID) {
        context.addIssue({ code: "custom", path: ["R2_ENDPOINT"], message: "Set R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID in production" });
      }
      const publicValues = [env.CUSTOMER_CARE_EMAIL, env.GRIEVANCE_EMAIL, env.PRIVACY_EMAIL, env.EMAIL_PROVIDER_NAME, env.EMAIL_PROVIDER_REGION, env.DATABASE_REGION, env.OBJECT_STORAGE_REGION, env.LOG_REGION];
      if (publicValues.some((value) => /development|example\.test|contract review required|0000000000/i.test(value))) {
        context.addIssue({ code: "custom", path: ["CUSTOMER_CARE_EMAIL"], message: "Production public contact and processor details must not use development placeholders" });
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
