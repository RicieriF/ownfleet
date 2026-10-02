import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CheckEventType, CheckValidationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export class RecordCheckEventDto {
  @IsString()
  event_uid!: string;

  @IsUUID()
  trip_id!: string;

  @IsUUID()
  trip_passenger_id!: string;

  @IsEnum(CheckEventType)
  type!: CheckEventType;

  @IsEnum(CheckValidationStatus)
  validation_status!: CheckValidationStatus;

  @IsDateString()
  captured_at!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsUUID()
  guardian_id?: string;

  @IsOptional()
  @IsString()
  qr_token?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  override_reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Prisma.InputJsonObject;
}
