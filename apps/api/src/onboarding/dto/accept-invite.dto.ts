import { IsString, MinLength, MaxLength, IsIn } from 'class-validator';
import { TransportMode } from '@prisma/client';

const TRANSPORT_MODES: TransportMode[] = [
  'car',
  'moto_gas',
  'moto_electric',
  'bicycle',
  'walking',
];

export class AcceptInviteDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsIn(TRANSPORT_MODES)
  transport_mode: TransportMode;
}
