import { z } from 'zod';

export const iikoConfigSchema = z.object({
  server_url: z.string().url(),
  login: z.string().min(1),
  password: z.string().min(1),
  organization_id: z.string().min(1),
});

export type IikoConfig = z.infer<typeof iikoConfigSchema>;

export const posterConfigSchema = z.object({
  application_secret: z.string().min(1),
});

export type PosterConfig = z.infer<typeof posterConfigSchema>;

/**
 * Parse and validate iiko integration config from Prisma JsonValue.
 * Returns null if config is missing required fields — caller should skip/warn.
 */
export function parseIikoConfig(raw: unknown): IikoConfig | null {
  const result = iikoConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Parse and validate poster integration config from Prisma JsonValue.
 * Returns null if config is missing required fields — caller should skip/warn.
 */
export function parsePosterConfig(raw: unknown): PosterConfig | null {
  const result = posterConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}
