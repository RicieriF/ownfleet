import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { ShiftsService } from '../shifts.service';
import { JwtPayload } from '../../auth/auth.types';

/**
 * Ensures the requesting courier has an active shift before accepting a delivery.
 * Apply after JwtAuthGuard on courier-facing delivery endpoints.
 */
@Injectable()
export class ShiftActiveGuard implements CanActivate {
  constructor(private readonly shiftsService: ShiftsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const { courier_id } = req.user;

    if (!courier_id) {
      throw new ForbiddenException('Only couriers can perform this action');
    }

    const hasShift = await this.shiftsService.hasActiveShift(courier_id);
    if (!hasShift) {
      throw new ForbiddenException({
        code: 'NO_ACTIVE_SHIFT',
        message: 'Courier must be on shift to accept deliveries',
      });
    }

    return true;
  }
}
