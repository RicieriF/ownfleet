import {
  IsString, IsOptional, IsNumber, Min, Max, IsEnum, MinLength,
} from 'class-validator';
import { OrderSource } from '@prisma/client';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  external_id?: string;

  @IsString()
  @MinLength(3)
  address: string;

  @IsOptional()
  @IsNumber()
  @Min(-90) @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180) @Max(180)
  lng?: number;

  @IsOptional()
  @IsEnum(OrderSource)
  source?: OrderSource;

  @IsOptional()
  @IsString()
  notes?: string;
}
