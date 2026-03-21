import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Accepts email (for manager/owner) or phone number (for courier accounts)
  @IsString()
  @MinLength(3)
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
