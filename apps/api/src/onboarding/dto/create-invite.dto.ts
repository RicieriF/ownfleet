import { IsUUID } from 'class-validator';

export class CreateInviteDto {
  @IsUUID()
  courier_id: string;
}
