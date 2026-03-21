import { IsString, MinLength, MaxLength } from 'class-validator';

export class AcceptInviteDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
