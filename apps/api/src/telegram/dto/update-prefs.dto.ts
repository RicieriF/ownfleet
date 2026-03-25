import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePrefsDto {
  // Manager prefs
  @IsOptional() @IsBoolean() order_created?: boolean;
  @IsOptional() @IsBoolean() delivery_assigned?: boolean;
  @IsOptional() @IsBoolean() delivery_completed?: boolean;
  @IsOptional() @IsBoolean() delivery_failed?: boolean;
  @IsOptional() @IsBoolean() delivery_force_closed?: boolean;
  @IsOptional() @IsBoolean() courier_shift_started?: boolean;
  @IsOptional() @IsBoolean() courier_shift_ended?: boolean;
  @IsOptional() @IsBoolean() courier_shift_auto_closed?: boolean;
  @IsOptional() @IsBoolean() courier_not_responding?: boolean;

  // Courier prefs
  @IsOptional() @IsBoolean() manager_reminder?: boolean;
  @IsOptional() @IsBoolean() shift_ending_soon?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(120) shift_ending_soon_min?: number;
}
