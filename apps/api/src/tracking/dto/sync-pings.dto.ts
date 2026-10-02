import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PingDto } from './ping.dto.js';

export class SyncPingsDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PingDto)
  pings!: PingDto[];
}
