import { IsInt, IsOptional, Min, Max } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  retention_orders_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  retention_pings_days?: number;
}
