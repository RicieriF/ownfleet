import { IsString, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * Primary website domain, e.g. "pizza.com" or "https://pizza.com".
   * Auto-expanded to include www variant: pizza.com → ['pizza.com', 'www.pizza.com'].
   */
  @IsOptional()
  @IsString()
  website_url?: string;
}
