import { IsString, IsNotEmpty } from 'class-validator';

export class AssignRecommendedDto {
  @IsString()
  @IsNotEmpty()
  courier_id: string;
}
