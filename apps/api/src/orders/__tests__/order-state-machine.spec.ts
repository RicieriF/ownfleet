import { BadRequestException } from '@nestjs/common';
import {
  assertOrderTransition,
  assertDeliveryTransition,
} from '../order-state-machine.js';

describe('Order State Machine', () => {
  describe('valid transitions', () => {
    it('pending → assigned', () =>
      expect(() => assertOrderTransition('pending', 'assigned')).not.toThrow());
    it('pending → cancelled', () =>
      expect(() =>
        assertOrderTransition('pending', 'cancelled'),
      ).not.toThrow());
    it('assigned → in_progress', () =>
      expect(() =>
        assertOrderTransition('assigned', 'in_progress'),
      ).not.toThrow());
    it('assigned → cancelled', () =>
      expect(() =>
        assertOrderTransition('assigned', 'cancelled'),
      ).not.toThrow());
    it('in_progress → completed', () =>
      expect(() =>
        assertOrderTransition('in_progress', 'completed'),
      ).not.toThrow());
    it('in_progress → failed', () =>
      expect(() =>
        assertOrderTransition('in_progress', 'failed'),
      ).not.toThrow());
  });

  describe('invalid transitions', () => {
    it('pending → completed', () =>
      expect(() => assertOrderTransition('pending', 'completed')).toThrow(
        BadRequestException,
      ));
    it('pending → in_progress', () =>
      expect(() => assertOrderTransition('pending', 'in_progress')).toThrow(
        BadRequestException,
      ));
    it('pending → failed', () =>
      expect(() => assertOrderTransition('pending', 'failed')).toThrow(
        BadRequestException,
      ));
    it('assigned → completed', () =>
      expect(() => assertOrderTransition('assigned', 'completed')).toThrow(
        BadRequestException,
      ));
    it('completed → anything', () => {
      expect(() => assertOrderTransition('completed', 'pending')).toThrow(
        BadRequestException,
      );
      expect(() => assertOrderTransition('completed', 'cancelled')).toThrow(
        BadRequestException,
      );
    });
    it('cancelled → anything', () =>
      expect(() => assertOrderTransition('cancelled', 'assigned')).toThrow(
        BadRequestException,
      ));
    it('failed → anything', () =>
      expect(() => assertOrderTransition('failed', 'in_progress')).toThrow(
        BadRequestException,
      ));
  });
});

describe('Delivery State Machine', () => {
  describe('valid transitions', () => {
    it('assigned → in_progress', () =>
      expect(() =>
        assertDeliveryTransition('assigned', 'in_progress'),
      ).not.toThrow());
    it('in_progress → completed', () =>
      expect(() =>
        assertDeliveryTransition('in_progress', 'completed'),
      ).not.toThrow());
    it('in_progress → failed', () =>
      expect(() =>
        assertDeliveryTransition('in_progress', 'failed'),
      ).not.toThrow());
  });

  describe('invalid transitions', () => {
    it('assigned → completed', () =>
      expect(() => assertDeliveryTransition('assigned', 'completed')).toThrow(
        BadRequestException,
      ));
    it('assigned → failed', () =>
      expect(() => assertDeliveryTransition('assigned', 'failed')).toThrow(
        BadRequestException,
      ));
    it('completed → anything', () =>
      expect(() =>
        assertDeliveryTransition('completed', 'in_progress'),
      ).toThrow(BadRequestException));
    it('failed → anything', () =>
      expect(() => assertDeliveryTransition('failed', 'in_progress')).toThrow(
        BadRequestException,
      ));
  });
});
