# Transport implementation status

## Completed
- Additive Transport Base V1 domain schema and migration.
- Passenger safety state machine and school-trip completion guard.
- Exact check-event idempotency, including concurrent duplicate handling.
- Tenant-scoped check events and active AuthorizedPickup validation.

## Validated
- Prisma generate and schema validation.
- API typecheck, lint, build, and 552 unit tests.
- Web typecheck, production build, and 22 unit tests.
- Mobile typecheck.

## In progress
- QR policy, short-lived one-time tokens, and audited emergency overrides.
- School geofence validation and family read model.
- Persistent mobile offline outbox and server reconciliation.

## Blocked
- Full migration application requires a PostgreSQL/PostGIS `DATABASE_URL`.
- Mobile lint has no ESLint configuration in the current baseline.

## Next
- Model and test per-passenger QR policy and bounded exceptions.
- Enforce school drop-off geofence and GPS accuracy policy.
- Add guardian-authorized family home read model.

## Last validation
- Command: `npm test -- --runInBand` in `apps/api`.
- Result: PASS, 33 suites and 552 tests.
- Command: `npm test` and `npm run build` in `apps/web`.
- Result: PASS, 22 tests and production build.
