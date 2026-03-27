import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { DispatchMode } from '@prisma/client';

export const ALLOWED_TIMEZONES = [
  'Europe/Kyiv',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Berlin',
  'Europe/Riga',
] as const;

export class UpdateSettingsDto {
  // ── Retention (JSONB settings) ───────────────────────────────────────────
  @IsOptional() @IsInt() @Min(1) @Max(30)
  retention_orders_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3)
  retention_pings_days?: number;

  @IsOptional() @IsInt() @Min(10) @Max(60)
  courier_not_responding_min?: number;

  // ── ETA alerts (JSONB settings) ──────────────────────────────────────────
  @IsOptional() @IsBoolean()
  show_sla_on_dashboard?: boolean;

  @IsOptional() @IsBoolean()
  eta_alert_enabled?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  eta_alert_delay_minutes?: number;

  // ── Separate columns ─────────────────────────────────────────────────────
  @IsOptional()
  @IsIn(ALLOWED_TIMEZONES)
  timezone?: string;

  @IsOptional()
  @ValidateIf((o: UpdateSettingsDto) => o.delivery_sla_minutes !== null)
  @IsInt() @Min(5) @Max(180)
  delivery_sla_minutes?: number | null;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  lng?: number;

  // ── Dispatch mode ────────────────────────────────────────────────────────
  @IsOptional() @IsEnum(DispatchMode)
  dispatch_mode?: DispatchMode;
}
