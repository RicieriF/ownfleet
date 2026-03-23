import { IsIn, IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpsertIntegrationDto {
  @IsIn(['poster', 'iiko'])
  type: 'poster' | 'iiko';

  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
