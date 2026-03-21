import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @IsString()
  @IsNotEmpty()
  brand: string;
}
