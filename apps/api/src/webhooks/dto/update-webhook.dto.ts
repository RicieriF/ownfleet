import {
  IsUrl,
  IsString,
  IsArray,
  ArrayMinSize,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsIn,
} from 'class-validator';
import { SUPPORTED_EVENTS, WebhookEvent } from './create-webhook.dto.js';

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
  @IsIn(SUPPORTED_EVENTS, { each: true })
  events?: WebhookEvent[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
