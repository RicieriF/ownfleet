import { IsNumber, IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

export class PingDto {
  @IsString()
  @IsNotEmpty()
  courier_id: string;

  @IsNumber()
  @Min(-90) @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  lng: number;

  @IsOptional()
  @IsInt()
  @Min(0) @Max(100)
  battery?: number;
}
