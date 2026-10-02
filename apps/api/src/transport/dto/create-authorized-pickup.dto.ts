import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateAuthorizedPickupDto {
  @IsUUID()
  guardian_id!: string;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;
}
