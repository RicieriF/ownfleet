import { IsDateString, IsOptional, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TimelineQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  @Transform(({ value }) => value ?? 'day')
  granularity?: 'day' | 'week' | 'month' = 'day';
}
