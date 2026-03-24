import { IsInt, Min, Max } from 'class-validator';

export class ExtendSubscriptionDto {
  /** Number of days to extend. min 1, max 365. */
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}
