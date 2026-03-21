import { IsUrl, IsString, IsArray, ArrayMinSize, IsNotEmpty } from 'class-validator';

export const SUPPORTED_EVENTS = [
  'order.created',
  'order.assigned',
  'order.cancelled',
  'delivery.started',
  'delivery.completed',
  'delivery.failed',
] as const;

export type WebhookEvent = (typeof SUPPORTED_EVENTS)[number];

export class CreateWebhookDto {
  @IsUrl({ require_tld: false }) // allow localhost in dev
  url: string;

  @IsString()
  @IsNotEmpty()
  secret: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];
}
