import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';

@Module({
  imports: [EstablishmentsModule, JwtModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
