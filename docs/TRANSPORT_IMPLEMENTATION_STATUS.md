# Transport implementation status

## Completed
- Additive Transport Base V1 domain schema and migration.
- Passenger safety state machine and school-trip completion guard.
- Exact check-event idempotency, including concurrent duplicate handling.
- Tenant-scoped check events and active AuthorizedPickup validation.
- Per-passenger QR policy with short-lived, context-bound, one-time tokens.
- Audited bounded QR exceptions and explicit driver override reasons.
- School drop-off geofence with explicit GPS accuracy tolerance.
- Protected family home read model and revocable family access tokens.
- Audited driver and vehicle reassignment for active trips.
- Tenant-scoped AuthorizedPickup creation, history, and revocation.
- Idempotent location ingestion with monotonic live-position cache.
- Persistent mobile outbox with ordered retry and authoritative reconciliation.

## Validated
- Prisma generate and schema validation.
- API typecheck, lint, build, and 591 unit tests.
- Web typecheck, production build, and 22 unit tests.
- Mobile typecheck.

## In progress
- Guardian-managed QR exception lifecycle.
- Automatic offline route-pack provider abstraction.
- Transport-specific family and driver user interfaces.

## Blocked
- Full migration application requires a PostgreSQL/PostGIS `DATABASE_URL`.
- Mobile lint has no ESLint configuration in the current baseline.

## Next
- Add guardian-managed QR exception issuance and revocation endpoints.
- Add approach, boarding, arrival, and assignment-change notification triggers.
- Add offline route-pack orchestration without selecting a commercial provider.

## Last validation
- Command: `npm test -- --runInBand` in `apps/api`.
- Result: PASS, 37 suites and 591 tests.
- Command: `npm test` and `npm run build` in `apps/web`.
- Result: PASS, 22 tests and production build.
- Command: `npx tsc --noEmit -p tsconfig.json` in `apps/mobile`.
- Result: PASS.
