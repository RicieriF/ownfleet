import { IsUrl, IsString, IsArray, ArrayMinSize, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secret?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
