import { PassengerQrAction } from '@prisma/client';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

export class IssuePassengerQrDto {
  @IsEnum(PassengerQrAction)
  action!: PassengerQrAction;

  @IsInt()
  @Min(30)
  @Max(600)
  ttl_seconds!: number;
}
