# Transport implementation status

## Completed
- Additive Transport Base V1 domain schema and migration.
- Passenger safety state machine and school-trip completion guard.
- Exact check-event idempotency, including concurrent duplicate handling.
- Tenant-scoped check events and active AuthorizedPickup validation.
- Per-passenger QR policy with short-lived, context-bound, one-time tokens.
- Audited bounded QR exceptions and explicit driver override reasons.
- School drop-off geofence with explicit GPS accuracy tolerance.

## Validated
- Prisma generate and schema validation.
- API typecheck, lint, build, and 570 unit tests.
- Web typecheck, production build, and 22 unit tests.
- Mobile typecheck.

## In progress
- Protected family read model API and family access-token lifecycle.
- Persistent mobile offline outbox and server reconciliation.

## Blocked
- Full migration application requires a PostgreSQL/PostGIS `DATABASE_URL`.
- Mobile lint has no ESLint configuration in the current baseline.

## Next
- Add guardian-authorized family home read model.
- Audit active driver and vehicle assignment changes.

## Last validation
- Command: `npm test -- --runInBand` in `apps/api`.
- Result: PASS, 33 suites and 570 tests.
- Command: `npm test` and `npm run build` in `apps/web`.
- Result: PASS, 22 tests and production build.
