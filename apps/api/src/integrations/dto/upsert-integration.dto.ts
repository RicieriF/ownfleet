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
  @IsUrl(
    { protocols: ['http', 'https'], require_tld: false },
    {
      message: 'iiko server_url must be a valid URL',
    },
  )
  server_url: string;

  @IsString()
  login: string;

  @IsString()
  password: string;

  @IsString()
  organization_id: string;
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
