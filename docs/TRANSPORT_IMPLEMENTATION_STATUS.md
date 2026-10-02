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
- Guardian-managed, bounded QR exception issuance and revocation.
- Family device registration and safety-event push notifications.
- Deduplicated vehicle-approach notifications for waiting passengers.
- Provider-neutral offline route-pack manifest and mobile preparation seam.
- Driver trip read model, explicit trip start, and audited departure transition.
- Mobile driver transport workflow with QR scanning and offline event queue.
- Automatic offline operational-manifest caching before trip start.

## Validated
- Prisma generate and schema validation.
- API typecheck, lint, build, and 609 unit tests.
- Web typecheck, production build, and 22 unit tests.
- Mobile typecheck.

## In progress
- Family transport user interface.
- Driver flows for guardian handoff, audited override, absence, and incident.

## Blocked
- Full migration application requires a PostgreSQL/PostGIS `DATABASE_URL`.
- Mobile lint has no ESLint configuration in the current baseline.

## Next
- Add family home UI backed by the protected aggregate endpoint.
- Complete exceptional driver controls without adding silent bypasses.

## Last validation
- Command: `npm test -- --runInBand` in `apps/api`.
- Result: PASS, 40 suites and 609 tests.
- Command: `npm test` and `npm run build` in `apps/web`.
- Result: PASS, 22 tests and production build.
- Command: `npx tsc --noEmit -p tsconfig.json` in `apps/mobile`.
- Result: PASS.
