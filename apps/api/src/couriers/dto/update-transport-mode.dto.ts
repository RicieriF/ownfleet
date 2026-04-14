import { IsEnum } from 'class-validator';
import { TransportMode } from '@prisma/client';

export class UpdateTransportModeDto {
  @IsEnum(TransportMode)
  transport_mode: TransportMode;
}
