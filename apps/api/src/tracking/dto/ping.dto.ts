import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class PingDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  battery?: number;

  @IsOptional()
  @IsUUID()
  event_uid?: string;

  @IsOptional()
  @IsDateString()
  captured_at?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}
