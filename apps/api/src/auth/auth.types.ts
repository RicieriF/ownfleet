import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  establishment_id: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: string;
  establishment_id: string;
  role: UserRole;
}
