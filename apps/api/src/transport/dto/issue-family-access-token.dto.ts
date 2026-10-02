import { IsInt, Max, Min } from 'class-validator';

export class IssueFamilyAccessTokenDto {
  @IsInt()
  @Min(1)
  @Max(90)
  ttl_days!: number;
}
