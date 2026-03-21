import { IsString, IsNotEmpty } from 'class-validator';

export class AssignOrderDto {
  @IsString()
  @IsNotEmpty()
  courier_id: string;
}
