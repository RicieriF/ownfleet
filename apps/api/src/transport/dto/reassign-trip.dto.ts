import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReassignTripDto {
  @IsOptional()
  @IsUUID()
  courier_id?: string;

  @IsOptional()
  @IsUUID()
  vehicle_id?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
