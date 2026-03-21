import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EstablishmentsModule } from './establishments/establishments.module.js';
import { CouriersModule } from './couriers/couriers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    EstablishmentsModule,
    CouriersModule,
  ],
})
export class AppModule {}
