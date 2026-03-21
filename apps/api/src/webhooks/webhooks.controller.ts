import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { WebhooksService } from './webhooks.service.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('webhooks')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  create(@Body() dto: CreateWebhookDto, @Req() req: any) {
    return this.service.create(dto, req.user as AuthenticatedUser);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user as AuthenticatedUser);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto, @Req() req: any) {
    return this.service.update(id, dto, req.user as AuthenticatedUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user as AuthenticatedUser);
  }
}
