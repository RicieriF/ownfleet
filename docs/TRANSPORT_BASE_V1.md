# Transport Base V1 — Transformation Contract

This branch transforms OwnFleet into a universal recurring-passenger transport platform while preserving the proven infrastructure.

## V1 product rule
One recurring-passenger core. School transport, university, corporate and private transport are capability profiles over the same domain.

## Preserve
- JWT/refresh authentication and tenant isolation
- PostgreSQL/PostGIS
- Redis/WebSocket live tracking
- background GPS pipeline
- ETA/geocoding/notifications
- queues, observability, retention and backups
- existing Plan, trial, billing-event and settings infrastructure
- current web/mobile layout until the operational flow is stable

## Migration strategy
Use an additive migration first. Do not destructively rename existing OwnFleet tables in the first implementation pass.

Conceptual adaptations:
- Establishment -> Organization/Operator
- Courier -> Driver
- Delivery -> Trip
- DeliveryProof -> auditable CheckEvent

Existing models remain available during migration so the current applications and tests can keep running.

## New core domain
- Vehicle
- Passenger
- Guardian
- PassengerGuardian
- Route
- RouteStop
- Trip
- TripPassenger
- CheckEvent
- AuthorizedPickup

## TripPassenger states
WAITING -> BOARDED -> IN_TRANSIT -> DROPPED_OFF

Exception states:
- ABSENT
- INCIDENT

Critical invariant: a school-capability trip must never silently complete while a passenger remains BOARDED or IN_TRANSIT.

## Safety contract
A vehicle GPS position is never proof that a passenger is onboard.

Passenger state changes require a validated event. Online QR validation should bind the token to passenger, trip, action, driver/vehicle context, timestamp and nonce. Tokens are short-lived and one-time.

For young passengers, drop-off may require an authorized guardian handoff event.

## Offline/resilience contract
OwnFleet currently treats tracking pings as fire-and-forget on network failure. Transport Base V1 must instead support:
- persistent local event/location queue
- unique event IDs / idempotency
- captured timestamp and GPS accuracy
- retry after connectivity returns
- explicit stale-location age
- provisional offline passenger events pending server reconciliation
- ordered sync without duplicate events

## Financial V1
The operator defines the recurring price per passenger/group.

Base dashboard distinguishes:
- projected revenue
- received
- pending
- overdue
- expenses
- estimated profit
- occupied / available seats

Reuse existing plan/trial/billing infrastructure. Do not create a second subscription system.

## Family Safety surface
Free guardian-facing surface:
- vehicle position and freshness
- confirmed driver identity (name + photo when available)
- confirmed vehicle identity (plate + model/color when available)
- explicit alert when the assigned driver or vehicle changes
- ETA
- passenger state
- event history
- approach/boarding/arrival/drop-off alerts
- authorized guardian management

No public child location.

### Driver/vehicle identity invariant
A family must be able to identify the assigned driver and vehicle before handoff. The trip is the authority for the assigned driver and vehicle; live GPS alone is not identity proof.

A driver or vehicle reassignment during an active trip is a security-significant event. It must be explicit, tenant-scoped, auditable, and trigger a guardian-facing notification before the new assignment is treated as normal. The family surface must visibly show the current driver identity and vehicle plate, with model/color/photo when available.

## Future-ready but hidden
Prepare schema seams/capabilities only; do not build these V1 interfaces:
- marketplace
- advanced fleet plans
- integrated payment automation
- institutional/public-sector dashboards
- partner services
- regulated financial products

## First implementation gate
Before replacing the existing UI:
1. existing baseline remains runnable;
2. additive Prisma migration is valid;
3. tenant isolation is maintained;
4. passenger state-machine tests exist;
5. school-trip completion invariant is tested;
6. offline event idempotency is tested.

The existing OwnFleet UI remains the temporary shell while the domain is transformed underneath it.


## Family journey UX contract

### Morning pickup
1. Guardian sees scheduled pickup time.
2. Guardian can confirm **Passenger ready**.
3. Home shows live ETA, remaining distance, assigned driver name/photo, vehicle plate/model/color and live vehicle map.
4. Guardian receives an approaching-vehicle alert before arrival.
5. For a child with pickup QR enabled, the child's QR becomes available for the driver to scan when the vehicle arrives.
6. GPS proximity alone never proves boarding.
7. A validated boarding event changes the passenger to BOARDED and the family receives the boarding timestamp.
8. Family continues following the vehicle on the map while the child is in transit.

### School arrival
School arrival is not a guardian handoff. The driver records the child's drop-off only while the device is inside the configured school geofence. The event stores captured time and location. After validation, the family receives **Arrived at school** and the trip no longer waits for a parent QR at the school.

### Guardian QR policy
QR requirements are configured per passenger rather than hard-coded by age.
- Guardian can require QR for pickup/handoff.
- Guardian can authorize a no-QR exception for one trip or a bounded set of trips.
- Driver emergency override requires an explicit reason and creates an auditable exception event.
- The product must not create a deadlock when a guardian cannot physically present a QR.

### Authorized alternate pickup
A parent/guardian can authorize another trusted adult (for example a grandparent) to receive the child.
- Authorization is passenger-scoped and time-bounded or explicitly persistent.
- The receiving adult must be identifiable in the authorization record.
- When guardian handoff verification is enabled, the handoff event must reference an active AuthorizedPickup.
- Expired/revoked authorization cannot complete the handoff.
- Family receives the identity of the authorized receiver, handoff time, driver and vehicle in the event history.

### Codex implementation order
Codex should organize implementation without redesigning the proven OwnFleet infrastructure:
1. validate Prisma schema and generate an additive migration;
2. run API build and existing tests;
3. add service/controller tests for tenant isolation, event idempotency, guardian authorization, provisional offline events and school completion guard;
4. model QR policy and per-trip/bounded exceptions explicitly rather than hiding them in UI-only state;
5. implement school geofence validation for school drop-off;
6. implement family read model/API containing ETA, location freshness, driver identity, vehicle identity and passenger state;
7. implement assignment-change audit + guardian notification;
8. preserve current UI shell until backend gates pass;
9. do not merge to main until build/tests/migration validation pass.
