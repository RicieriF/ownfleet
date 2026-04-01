/**
 * Embed page i18n — no external libraries needed.
 * ~25 UI strings total. Locale comes from the API snapshot (establishments.settings.locale).
 * `satisfies` guarantees all keys are present in every locale at compile time.
 */

interface Messages {
  // States
  orderAccepted: string;
  waitingForCourier: string;
  findingCourier: string;
  orderPreparing: string;
  courier: string;
  waitingForDeparture: string;
  courierEnRoute: string;
  estimatedTime: string;
  estimatedTimeNote: string;
  deliveryDeadline: string;
  delivered: string;
  thankYou: string;
  cancelled: string;
  cancelledNote: string;
  failed: string;
  failedNote: string;
  // Token expired / error
  trackingExpired: string;
  orderNotFound: string;
  orderNotFoundNote: string;
  // Minimized labels
  minState0: string;
  minState1: string;
  minState2: (name: string, etaMin: number) => string;
  minState2NoEta: (name: string) => string;
  minState3: string;
  minState4: string;
  minState5: string;
  minExpired: string;
  // Controls
  minimize: string;
  expand: string;
  // Map
  noCoords: string;
  // Loading
  loading: string;
  // ETA
  minutes: (n: number) => string;
}

export const messages = {
  uk: {
    orderAccepted: 'Замовлення прийнято',
    waitingForCourier: 'Ваше замовлення прийнято, очікуємо призначення курʼєра.',
    findingCourier: 'Підбираємо курʼєра...',
    orderPreparing: 'Ваше замовлення збирається.',
    courier: 'Курʼєр',
    waitingForDeparture: 'Очікуємо виїзду курʼєра...',
    courierEnRoute: 'їде до вас',
    estimatedTime: 'Очікуваний час',
    estimatedTimeNote: 'Орієнтовно, на основі маршруту',
    deliveryDeadline: 'Доставка до',
    delivered: 'Доставлено!',
    thankYou: 'Дякуємо що обрали',
    cancelled: 'Замовлення скасовано',
    cancelledNote: 'Зверніться до закладу для уточнення деталей.',
    failed: 'Не вдалось доставити',
    failedNote: 'Курʼєр не зміг доставити замовлення. Зверніться до закладу для уточнення деталей.',
    trackingExpired: 'Трекінг завершено',
    orderNotFound: 'Замовлення не знайдено',
    orderNotFoundNote: 'Спробуйте оновити сторінку.',
    minState0: '⏳ Замовлення прийнято',
    minState1: '⏳ Замовлення збирається',
    minState2: (name: string, etaMin: number) => `🛵 ${name} · ~${etaMin} хв`,
    minState2NoEta: (name: string) => `🛵 ${name}`,
    minState3: '✅ Доставлено!',
    minState4: '❌ Замовлення скасовано',
    minState5: '⚠️ Не вдалось доставити',
    minExpired: '⏱ Трекінг завершено',
    minimize: 'Згорнути',
    expand: 'Розгорнути',
    noCoords: 'Карта недоступна — адреса не геокодована',
    loading: 'Завантаження...',
    minutes: (n: number) => `~${n} хв`,
  },
  en: {
    orderAccepted: 'Order accepted',
    waitingForCourier: 'Your order has been accepted. Waiting for a courier to be assigned.',
    findingCourier: 'Finding a courier...',
    orderPreparing: 'Your order is being prepared.',
    courier: 'Courier',
    waitingForDeparture: 'Waiting for courier departure...',
    courierEnRoute: 'is on the way',
    estimatedTime: 'Estimated time',
    estimatedTimeNote: 'Estimated, based on route',
    deliveryDeadline: 'Deliver by',
    delivered: 'Delivered!',
    thankYou: 'Thank you for choosing',
    cancelled: 'Order cancelled',
    cancelledNote: 'Please contact the restaurant for details.',
    failed: 'Delivery failed',
    failedNote: 'The courier could not complete the delivery. Please contact the restaurant for details.',
    trackingExpired: 'Tracking ended',
    orderNotFound: 'Order not found',
    orderNotFoundNote: 'Please refresh the page.',
    minState0: '⏳ Order accepted',
    minState1: '⏳ Order is being prepared',
    minState2: (name: string, etaMin: number) => `🛵 ${name} · ~${etaMin} min`,
    minState2NoEta: (name: string) => `🛵 ${name}`,
    minState3: '✅ Delivered!',
    minState4: '❌ Order cancelled',
    minState5: '⚠️ Delivery failed',
    minExpired: '⏱ Tracking ended',
    minimize: 'Minimize',
    expand: 'Expand',
    noCoords: 'Map unavailable — address not geocoded',
    loading: 'Loading...',
    minutes: (n: number) => `~${n} min`,
  },
} satisfies Record<string, Messages>;

export type Locale = keyof typeof messages;

export function t<K extends keyof Messages>(
  key: K,
  locale: Locale,
): Messages[K] {
  return messages[locale][key];
}
