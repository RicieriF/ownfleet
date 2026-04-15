import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';

export class CompleteDeliveryDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy?: number;

  // photo_key is set after client uploads to R2 via presigned URL
  // Must match the S3 key pattern issued by getUploadUrl
  @IsOptional()
  @IsString()
  @Matches(/^proofs\//, { message: 'photo_key must start with proofs/' })
  photo_key?: string;
}
