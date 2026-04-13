import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password?: string;
}
