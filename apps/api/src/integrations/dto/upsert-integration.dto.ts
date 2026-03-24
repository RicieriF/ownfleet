import {
  IsIn,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class IikoConfigDto {
  @IsUrl({ protocols: ['https'], require_tld: true }, {
    message: 'iiko server_url must be a valid HTTPS URL',
  })
  server_url: string;

  @IsOptional()
  @IsString()
  api_login?: string;

  @IsOptional()
  @IsString()
  api_password?: string;
}

export class UpsertIntegrationDto {
  @IsIn(['poster', 'iiko'])
  type: 'poster' | 'iiko';

  @IsObject()
  @ValidateIf((o) => o.type === 'iiko')
  @ValidateNested()
  @Type(() => IikoConfigDto)
  config: IikoConfigDto | Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
