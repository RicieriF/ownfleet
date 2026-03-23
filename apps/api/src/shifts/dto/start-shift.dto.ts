import { IsISO8601, IsOptional } from 'class-validator';

export class StartShiftDto {
  @IsOptional()
  @IsISO8601()
  planned_end_at?: string;
}
