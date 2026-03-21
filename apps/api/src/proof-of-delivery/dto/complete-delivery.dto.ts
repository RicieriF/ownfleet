import { IsNumber, IsOptional, IsString, IsDateString, Min, Max } from 'class-validator';

export class CompleteDeliveryDto {
  @IsNumber()
  @Min(-90) @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  lng: number;

  @IsDateString()
  captured_at: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  // photo_key is set after client uploads to R2 via presigned URL
  @IsOptional()
  @IsString()
  photo_key?: string;
}
