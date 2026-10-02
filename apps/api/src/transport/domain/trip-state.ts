export type PassengerTripState =
  | 'waiting'
  | 'boarded'
  | 'in_transit'
  | 'dropped_off'
  | 'absent'
  | 'incident';

export type CheckValidationState =
  | 'validated_online'
  | 'provisional_offline'
  | 'reconciled'
  | 'rejected';

const passengerTransitions: Record<
  PassengerTripState,
  readonly PassengerTripState[]
> = {
  waiting: ['boarded', 'absent', 'incident'],
  boarded: ['in_transit', 'dropped_off', 'incident'],
  in_transit: ['dropped_off', 'incident'],
  dropped_off: [],
  absent: [],
  incident: ['dropped_off'],
};

export function canTransitionPassenger(
  from: PassengerTripState,
  to: PassengerTripState,
): boolean {
  return passengerTransitions[from].includes(to);
}

export function assertPassengerTransition(
  from: PassengerTripState,
  to: PassengerTripState,
): void {
  if (!canTransitionPassenger(from, to)) {
    throw new Error(`Invalid passenger transition: ${from} -> ${to}`);
  }
}

export function assertTripCanComplete(
  schoolSafety: boolean,
  passengerStates: readonly PassengerTripState[],
): void {
  if (!schoolSafety) return;

  const onboard = passengerStates.filter(
    (state) => state === 'boarded' || state === 'in_transit',
  );

  if (onboard.length > 0) {
    throw new Error(
      `School-safety trip cannot complete with ${onboard.length} passenger(s) onboard`,
    );
  }
}

export function eventGrantsConfirmedPassengerState(
  validation: CheckValidationState,
): boolean {
  return validation === 'validated_online' || validation === 'reconciled';
}
