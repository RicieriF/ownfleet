import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class UpdateUserDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  device_token: string;

  @IsEnum(DevicePlatform)
  device_platform: DevicePlatform;
}
