import { PassengerQrAction } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateQrExceptionDto {
  @IsEnum(PassengerQrAction)
  action!: PassengerQrAction;

  @IsOptional()
  @IsUUID()
  trip_id?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsDateString()
  valid_from!: string;

  @IsDateString()
  valid_until!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  max_uses!: number;
}
