import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CheckEventType, CheckValidationStatus } from '@prisma/client';

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
  qr_nonce_hash?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
