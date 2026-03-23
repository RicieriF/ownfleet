import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateIntegrationDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
