import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

export class CreateCourierDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  phone?: string;
}
