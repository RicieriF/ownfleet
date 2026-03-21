import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class UpdateDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  device_token: string;

  @IsEnum(DevicePlatform)
  device_platform: DevicePlatform;

  @IsOptional()
  @IsString()
  device_brand?: string;
}
