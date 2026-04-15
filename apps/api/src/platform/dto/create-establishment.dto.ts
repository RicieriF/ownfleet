import {
  IsString,
  IsNotEmpty,
  Matches,
  MinLength,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class CreateEstablishmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** URL-safe slug: lowercase letters, digits, hyphens. Used to build email logins. */
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, digits and hyphens only',
  })
  slug: string;

  /** Trial days to grant. Defaults to 14. Max 365. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trial_days?: number;
}
