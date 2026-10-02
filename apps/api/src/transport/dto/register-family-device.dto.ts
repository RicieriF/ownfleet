import { DevicePlatform } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterFamilyDeviceDto {
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  device_token!: string;

  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}
