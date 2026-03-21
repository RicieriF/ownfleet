import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  establishment_id: string;
  role: UserRole;
  is_platform_admin: boolean;
}

export interface AuthenticatedUser {
  id: string;
  establishment_id: string;
  role: UserRole;
  is_platform_admin: boolean;
}
