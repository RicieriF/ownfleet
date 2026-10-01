import {
  assertPassengerTransition,
  assertTripCanComplete,
  canTransitionPassenger,
  eventGrantsConfirmedPassengerState,
} from './trip-state';

describe('Transport Base V1 passenger safety state machine', () => {
  it('allows waiting -> boarded', () => {
    expect(canTransitionPassenger('waiting', 'boarded')).toBe(true);
  });

  it('rejects waiting -> dropped_off', () => {
    expect(() => assertPassengerTransition('waiting', 'dropped_off')).toThrow(
      'Invalid passenger transition',
    );
  });

  it('rejects boarding a passenger twice', () => {
    expect(canTransitionPassenger('boarded', 'boarded')).toBe(false);
  });

  it('blocks school trip completion while a passenger is boarded', () => {
    expect(() =>
      assertTripCanComplete(true, ['dropped_off', 'boarded']),
    ).toThrow('cannot complete');
  });

  it('blocks school trip completion while a passenger is in transit', () => {
    expect(() =>
      assertTripCanComplete(true, ['in_transit']),
    ).toThrow('cannot complete');
  });

  it('allows school trip completion after explicit resolution', () => {
    expect(() =>
      assertTripCanComplete(true, ['dropped_off', 'absent']),
    ).not.toThrow();
  });

  it('does not treat provisional offline events as confirmed state', () => {
    expect(eventGrantsConfirmedPassengerState('provisional_offline')).toBe(false);
    expect(eventGrantsConfirmedPassengerState('validated_online')).toBe(true);
    expect(eventGrantsConfirmedPassengerState('reconciled')).toBe(true);
    expect(eventGrantsConfirmedPassengerState('rejected')).toBe(false);
  });

  it('allows incident resolution only through explicit dropoff', () => {
    expect(canTransitionPassenger('incident', 'dropped_off')).toBe(true);
    expect(canTransitionPassenger('incident', 'boarded')).toBe(false);
  });

  it('does not apply the school onboard completion guard to non-school trips', () => {
    expect(() => assertTripCanComplete(false, ['boarded', 'in_transit'])).not.toThrow();
  });
});
