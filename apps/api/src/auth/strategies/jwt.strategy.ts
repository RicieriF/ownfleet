import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, AuthenticatedUser } from '../auth.types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Cookie fallback: web dashboard proxies /api/v1/* through Next.js rewrites
        // which forward all cookies — so the httpOnly access_token arrives here.
        (req: any) => req?.cookies?.['access_token'] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub || !payload.establishment_id || !payload.role) {
      throw new UnauthorizedException();
    }
    return {
      id: payload.sub,
      establishment_id: payload.establishment_id,
      role: payload.role,
      is_platform_admin: payload.is_platform_admin ?? false,
      ...(payload.courier_id ? { courier_id: payload.courier_id } : {}),
    };
  }
}
