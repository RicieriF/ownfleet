import { IsISO8601, IsOptional } from 'class-validator';

export class UpdatePlannedEndDto {
  @IsOptional()
  @IsISO8601()
  planned_end_at: string | null;
}
