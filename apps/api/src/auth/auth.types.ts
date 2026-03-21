import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  establishment_id: string;
  role: UserRole;
  is_platform_admin: boolean;
  /** Set only for users linked to a courier (courier mobile app accounts) */
  courier_id?: string;
}

export interface AuthenticatedUser {
  id: string;
  establishment_id: string;
  role: UserRole;
  is_platform_admin: boolean;
  /** Set only for courier-linked users */
  courier_id?: string;
}
