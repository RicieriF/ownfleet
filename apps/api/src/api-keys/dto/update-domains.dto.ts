import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateDomainsDto {
  /**
   * Website URL or domain, e.g. "pizza.com" or "https://pizza.com".
   * Auto-expanded to include www variant.
   */
  @IsString()
  @IsNotEmpty()
  website_url!: string;
}
