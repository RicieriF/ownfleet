import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamMemberDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;
}
