#!/usr/bin/env node
/* eslint-disable no-console */

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const BCRYPT_ROUNDS = 12;

const EST = {
  name: 'Test Kitchen Kyiv',
  slug: 'test-kitchen-kyiv',
  timezone: 'Europe/Kyiv',
  plan: 'starter',
  dispatch_mode: 'recommend',
  onboarding_status: 'completed',
  delivery_sla_minutes: 45,
  lat: 50.4501,
  lng: 30.5234,
  hosted_tracking_enabled: true,
  settings: {
    locale: 'uk',
    website_url: 'https://test-kitchen-kyiv.example',
    show_sla_on_dashboard: true,
    dispatch_no_courier_escalation_minutes: 5,
    tracking_widget_primary_color: '#111827',
    tracking_widget_accent_color: '#f59e0b',
  },
};

const USERS = {
  owner: {
    email: 'owner-test-kitchen-kyiv@weego.app',
    password: 'Owner123!Test',
    role: 'owner',
    is_platform_admin: true,
  },
  manager: {
    email: 'manager-test-kitchen-kyiv@weego.app',
    password: 'Manager123!Test',
    role: 'manager',
    is_platform_admin: false,
  },
  dispatcher: {
    email: 'dispatcher-test-kitchen-kyiv@weego.app',
    password: 'Dispatcher123!Test',
    role: 'dispatcher',
    is_platform_admin: false,
  },
};

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Run with env loaded from apps/api/.env');
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const [ownerHash, managerHash, dispatcherHash] = await Promise.all([
      bcrypt.hash(USERS.owner.password, BCRYPT_ROUNDS),
      bcrypt.hash(USERS.manager.password, BCRYPT_ROUNDS),
      bcrypt.hash(USERS.dispatcher.password, BCRYPT_ROUNDS),
    ]);

    const trialEndsAt = daysFromNow(14);

    const establishment = await prisma.establishment.upsert({
      where: { slug: EST.slug },
      update: {
        name: EST.name,
        timezone: EST.timezone,
        plan: EST.plan,
        dispatch_mode: EST.dispatch_mode,
        onboarding_status: EST.onboarding_status,
        delivery_sla_minutes: EST.delivery_sla_minutes,
        lat: EST.lat,
        lng: EST.lng,
        hosted_tracking_enabled: EST.hosted_tracking_enabled,
        trial_ends_at: trialEndsAt,
        settings: EST.settings,
      },
      create: {
        name: EST.name,
        slug: EST.slug,
        timezone: EST.timezone,
        plan: EST.plan,
        dispatch_mode: EST.dispatch_mode,
        onboarding_status: EST.onboarding_status,
        delivery_sla_minutes: EST.delivery_sla_minutes,
        lat: EST.lat,
        lng: EST.lng,
        hosted_tracking_enabled: EST.hosted_tracking_enabled,
        trial_ends_at: trialEndsAt,
        settings: EST.settings,
      },
    });

    await prisma.user.upsert({
      where: { email: USERS.owner.email },
      update: {
        establishment_id: establishment.id,
        role: USERS.owner.role,
        password_hash: ownerHash,
        is_platform_admin: true,
        courier_id: null,
      },
      create: {
        establishment_id: establishment.id,
        role: USERS.owner.role,
        email: USERS.owner.email,
        password_hash: ownerHash,
        is_platform_admin: true,
      },
    });

    await prisma.user.upsert({
      where: { email: USERS.manager.email },
      update: {
        establishment_id: establishment.id,
        role: USERS.manager.role,
        password_hash: managerHash,
        is_platform_admin: USERS.manager.is_platform_admin,
        courier_id: null,
      },
      create: {
        establishment_id: establishment.id,
        role: USERS.manager.role,
        email: USERS.manager.email,
        password_hash: managerHash,
        is_platform_admin: USERS.manager.is_platform_admin,
      },
    });

    await prisma.user.upsert({
      where: { email: USERS.dispatcher.email },
      update: {
        establishment_id: establishment.id,
        role: USERS.dispatcher.role,
        password_hash: dispatcherHash,
        is_platform_admin: USERS.dispatcher.is_platform_admin,
        courier_id: null,
      },
      create: {
        establishment_id: establishment.id,
        role: USERS.dispatcher.role,
        email: USERS.dispatcher.email,
        password_hash: dispatcherHash,
        is_platform_admin: USERS.dispatcher.is_platform_admin,
      },
    });

    // Cleanup previous seeded data for deterministic reruns
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({
        where: {
          user: {
            establishment_id: establishment.id,
          },
        },
      });

      await tx.webhook.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.integration.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.apiKey.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.inviteToken.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.order.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.shift.deleteMany({ where: { establishment_id: establishment.id } });
      await tx.courier.deleteMany({ where: { establishment_id: establishment.id } });
    });

    const couriers = await prisma.courier.createManyAndReturn({
      data: [
        {
          establishment_id: establishment.id,
          name: 'Андрій',
          phone: '+380671110001',
          transport_mode: 'car',
          active: true,
          battery_optimization_exempt: true,
          reminder_count: 2,
          last_reminder_sent_at: minutesAgo(30),
        },
        {
          establishment_id: establishment.id,
          name: 'Олена',
          phone: '+380671110002',
          transport_mode: 'moto_gas',
          active: true,
          reminder_count: 1,
          last_reminder_sent_at: minutesAgo(95),
        },
        {
          establishment_id: establishment.id,
          name: 'Максим',
          phone: '+380671110003',
          transport_mode: 'bicycle',
          active: true,
        },
        {
          establishment_id: establishment.id,
          name: 'Ірина',
          phone: '+380671110004',
          transport_mode: 'walking',
          active: true,
        },
      ],
    });

    const courierByName = new Map(couriers.map((c) => [c.name, c]));

    const cAndrii = courierByName.get('Андрій');
    const cOlena = courierByName.get('Олена');
    const cMaksym = courierByName.get('Максим');
    const cIryna = courierByName.get('Ірина');

    if (!cAndrii || !cOlena || !cMaksym || !cIryna) {
      throw new Error('Courier creation failed');
    }

    await prisma.shift.createMany({
      data: [
        {
          courier_id: cAndrii.id,
          establishment_id: establishment.id,
          started_at: hoursAgo(3),
          planned_end_at: hoursAgo(-5),
        },
        {
          courier_id: cOlena.id,
          establishment_id: establishment.id,
          started_at: hoursAgo(2),
          planned_end_at: hoursAgo(-6),
        },
        {
          courier_id: cMaksym.id,
          establishment_id: establishment.id,
          started_at: hoursAgo(1),
          planned_end_at: hoursAgo(-7),
        },
        {
          courier_id: cIryna.id,
          establishment_id: establishment.id,
          started_at: daysAgo(1),
          ended_at: hoursAgo(12),
          ended_by: 'courier',
        },
      ],
    });

    const orders = await prisma.order.createManyAndReturn({
      data: [
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1001',
          address: 'вул. Саксаганського, 55, Київ',
          lat: 50.4383,
          lng: 30.5132,
          status: 'pending',
          source: 'manual',
          notes: 'Клієнт просив подзвонити перед прибуттям',
          ready_at: minutesAgo(25),
          created_at: minutesAgo(30),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1002',
          address: 'вул. Антоновича, 80, Київ',
          lat: 50.4269,
          lng: 30.5156,
          status: 'assigned',
          source: 'manual',
          notes: 'Дверний код: 2458',
          ready_at: minutesAgo(20),
          created_at: minutesAgo(28),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1003',
          address: 'вул. Жилянська, 75, Київ',
          lat: 50.4366,
          lng: 30.498,
          status: 'in_progress',
          source: 'poster',
          notes: 'Безконтактна доставка',
          ready_at: minutesAgo(35),
          created_at: minutesAgo(40),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1004',
          address: 'б-р Лесі Українки, 19, Київ',
          lat: 50.4297,
          lng: 30.5413,
          status: 'completed',
          source: 'manual',
          ready_at: hoursAgo(2),
          created_at: hoursAgo(3),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1005',
          address: 'вул. Ділова, 2Б, Київ',
          lat: 50.429,
          lng: 30.5176,
          status: 'failed',
          source: 'manual',
          notes: 'Клієнт не відповідав',
          ready_at: hoursAgo(4),
          created_at: hoursAgo(5),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1006',
          address: 'вул. Лабораторна, 15, Київ',
          lat: 50.4253,
          lng: 30.5259,
          status: 'cancelled',
          source: 'webhook',
          notes: 'Скасовано клієнтом',
          ready_at: hoursAgo(1),
          created_at: hoursAgo(1),
        },
        {
          establishment_id: establishment.id,
          external_id: 'TEST-1007',
          address: 'вул. Ярославів Вал, 21Г, Київ',
          lat: 50.4549,
          lng: 30.5139,
          status: 'completed',
          source: 'iiko',
          ready_at: daysAgo(1),
          created_at: daysAgo(1),
        },
      ],
    });

    const orderByExternalId = new Map(orders.map((o) => [o.external_id, o]));

    const o1002 = orderByExternalId.get('TEST-1002');
    const o1003 = orderByExternalId.get('TEST-1003');
    const o1004 = orderByExternalId.get('TEST-1004');
    const o1005 = orderByExternalId.get('TEST-1005');
    const o1007 = orderByExternalId.get('TEST-1007');

    if (!o1002 || !o1003 || !o1004 || !o1005 || !o1007) {
      throw new Error('Order creation failed');
    }

    const deliveries = await prisma.delivery.createManyAndReturn({
      data: [
        {
          order_id: o1002.id,
          courier_id: cOlena.id,
          status: 'assigned',
          eta_seconds: 18 * 60,
          assigned_at: minutesAgo(15),
          created_at: minutesAgo(15),
        },
        {
          order_id: o1003.id,
          courier_id: cAndrii.id,
          status: 'in_progress',
          eta_seconds: 12 * 60,
          eta_started_at: minutesAgo(20),
          assigned_at: minutesAgo(22),
          started_at: minutesAgo(18),
          created_at: minutesAgo(22),
        },
        {
          order_id: o1004.id,
          courier_id: cAndrii.id,
          status: 'completed',
          eta_seconds: 16 * 60,
          eta_started_at: hoursAgo(2),
          assigned_at: hoursAgo(2),
          started_at: hoursAgo(2),
          completed_at: minutesAgo(62),
          order_closed_at: minutesAgo(61),
          created_at: hoursAgo(2),
        },
        {
          order_id: o1005.id,
          courier_id: cMaksym.id,
          status: 'failed',
          eta_seconds: 20 * 60,
          eta_started_at: hoursAgo(4),
          assigned_at: hoursAgo(4),
          started_at: hoursAgo(4),
          completed_at: hoursAgo(3),
          order_closed_at: hoursAgo(3),
          created_at: hoursAgo(4),
        },
        {
          order_id: o1007.id,
          courier_id: cOlena.id,
          status: 'completed',
          eta_seconds: 15 * 60,
          eta_started_at: daysAgo(1),
          assigned_at: daysAgo(1),
          started_at: daysAgo(1),
          completed_at: hoursAgo(20),
          order_closed_at: hoursAgo(20),
          created_at: daysAgo(1),
        },
      ],
    });

    const deliveryByOrder = new Map(deliveries.map((d) => [d.order_id, d]));

    await prisma.deliveryProof.createMany({
      data: [
        {
          delivery_id: deliveryByOrder.get(o1004.id).id,
          lat: 50.4297,
          lng: 30.5413,
          captured_at: minutesAgo(61),
          order_closed_at: minutesAgo(61),
          photo_key: 'proofs/test-1004.jpg',
          geo_match: true,
          accuracy: 14,
          geo_flags: { within_300m: true, seeded: true },
        },
        {
          delivery_id: deliveryByOrder.get(o1007.id).id,
          lat: 50.4548,
          lng: 30.514,
          captured_at: hoursAgo(20),
          order_closed_at: hoursAgo(20),
          photo_key: 'proofs/test-1007.jpg',
          geo_match: true,
          accuracy: 10,
          geo_flags: { within_300m: true, seeded: true },
        },
      ],
    });

    await prisma.trackingToken.createMany({
      data: [
        {
          order_id: o1003.id,
          token: crypto.randomUUID(),
          expires_at: daysFromNow(3),
          created_at: minutesAgo(18),
        },
        {
          order_id: o1004.id,
          token: crypto.randomUUID(),
          expires_at: daysFromNow(2),
          created_at: hoursAgo(2),
        },
      ],
    });

    await prisma.inviteToken.createMany({
      data: [
        {
          establishment_id: establishment.id,
          token: crypto.randomBytes(32).toString('hex'),
          courier_id: cIryna.id,
          expires_at: daysFromNow(5),
        },
        {
          establishment_id: establishment.id,
          token: crypto.randomBytes(32).toString('hex'),
          courier_id: cMaksym.id,
          expires_at: daysFromNow(1),
          used_at: hoursAgo(6),
        },
      ],
    });

    await prisma.integration.createMany({
      data: [
        {
          establishment_id: establishment.id,
          type: 'poster',
          active: true,
          config: {
            token: 'poster_test_token_123',
            spot_id: '1',
            endpoint: 'https://joinposter.com/api',
          },
        },
        {
          establishment_id: establishment.id,
          type: 'iiko',
          active: false,
          config: {
            api_key: 'iiko_test_key_123',
            organization_id: 'org_test_1',
          },
        },
      ],
    });

    await prisma.webhook.createMany({
      data: [
        {
          establishment_id: establishment.id,
          url: 'https://webhook.site/00000000-0000-4000-8000-000000000001',
          secret: 'webhook_secret_test_1',
          events: ['order.created', 'order.assigned', 'delivery.completed'],
          active: true,
        },
        {
          establishment_id: establishment.id,
          url: 'https://webhook.site/00000000-0000-4000-8000-000000000002',
          secret: 'webhook_secret_test_2',
          events: ['delivery.failed'],
          active: false,
        },
      ],
    });

    const apiKeySecret = process.env.API_KEY_SECRET || 'local-dev-api-key-secret';
    const rawApiKey = 'weego_test_key_for_local_preview_2026';
    const keyPrefix = rawApiKey.slice(0, 8);
    const keyHash = crypto
      .createHmac('sha256', apiKeySecret)
      .update(rawApiKey)
      .digest('hex');

    await prisma.apiKey.create({
      data: {
        establishment_id: establishment.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: 'Seeded Default Key',
        is_active: true,
        allowed_domains: ['test-kitchen-kyiv.example', 'www.test-kitchen-kyiv.example'],
        last_used_at: minutesAgo(10),
        last_used_domain: 'test-kitchen-kyiv.example',
      },
    });

    const pingRows = [
      {
        courierId: cAndrii.id,
        lat: 50.4445,
        lng: 30.5171,
        battery: 82,
        at: minutesAgo(1),
      },
      {
        courierId: cOlena.id,
        lat: 50.4312,
        lng: 30.5129,
        battery: 67,
        at: minutesAgo(3),
      },
      {
        courierId: cMaksym.id,
        lat: 50.4494,
        lng: 30.5282,
        battery: 55,
        at: minutesAgo(12),
      },
    ];

    for (const ping of pingRows) {
      await prisma.$executeRaw`
        INSERT INTO location_pings (id, courier_id, location, battery, created_at)
        VALUES (
          ${crypto.randomUUID()},
          ${ping.courierId},
          ST_SetSRID(ST_MakePoint(${ping.lng}, ${ping.lat}), 4326),
          ${ping.battery},
          ${ping.at}
        )
      `;
    }

    console.log('\nSeed completed successfully.\n');
    console.log('Tenant:', EST.name, `(${EST.slug})`);
    console.log('Owner login:', USERS.owner.email);
    console.log('Owner password:', USERS.owner.password);
    console.log('Manager login:', USERS.manager.email);
    console.log('Manager password:', USERS.manager.password);
    console.log('Dispatcher login:', USERS.dispatcher.email);
    console.log('Dispatcher password:', USERS.dispatcher.password);
    console.log('API key (plaintext, seeded):', rawApiKey);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nSeed failed:\n', err);
  process.exit(1);
});
