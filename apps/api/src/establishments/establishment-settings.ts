/**
 * Typed interface for the JSONB `establishments.settings` column.
 *
 * Single source of truth — import `parseEstablishmentSettings` instead of
 * casting `settings as Record<string, unknown>` in every service.
 */
export interface EstablishmentSettings {
  /** Days to keep terminal orders (completed/cancelled/failed). Default: 90 */
  retention_orders_days: number;
  /** Days to keep location_pings. Default: 3 */
  retention_pings_days: number;
  /** Minutes of silence before a "courier not responding" alert fires. Default: 15 */
  courier_not_responding_min: number;
  /** Show delivery SLA countdown on the manager dashboard. Default: false */
  show_sla_on_dashboard: boolean;
  /** Enable Telegram alert when a delivery exceeds its ETA. Default: false */
  eta_alert_enabled: boolean;
  /** Extra minutes past ETA before the overdue alert fires. Default: 10 */
  eta_alert_delay_minutes: number;
  /** Minutes a `recommend`-mode recommendation stays active before re-dispatch. null = disabled */
  dispatch_recommend_timeout_minutes: number | null;
  /** Radius (km) used as the outer courier-candidate zone in dispatch. Default: 1 */
  dispatch_recommend_radius_km: number;
  /** Minutes above average per-delivery time before a shift anomaly alert fires. Default: 30 */
  dispatch_anomaly_threshold_minutes: number;
  /** Minimum completed deliveries in the current shift before anomaly detection runs. Default: 5 */
  dispatch_anomaly_min_deliveries: number;
  /** Minutes without a courier assignment before the no-courier escalation alert fires. Default: 10 */
  dispatch_no_courier_escalation_minutes: number;
  /** Locale for the customer-facing tracking widget ('uk' | 'en'). Default: 'uk' */
  locale: string;
}

export const ESTABLISHMENT_SETTINGS_DEFAULTS: Readonly<EstablishmentSettings> =
  {
    retention_orders_days: 90,
    retention_pings_days: 3,
    courier_not_responding_min: 15,
    show_sla_on_dashboard: false,
    eta_alert_enabled: false,
    eta_alert_delay_minutes: 10,
    dispatch_recommend_timeout_minutes: null,
    dispatch_recommend_radius_km: 1,
    dispatch_anomaly_threshold_minutes: 30,
    dispatch_anomaly_min_deliveries: 5,
    dispatch_no_courier_escalation_minutes: 10,
    locale: 'uk',
  };

/**
 * Parses the raw JSONB `settings` value from the DB into a fully-typed object.
 * Missing or invalid keys fall back to ESTABLISHMENT_SETTINGS_DEFAULTS.
 *
 * NOTE: `retention_orders_days` also checks the legacy key `retention_days`
 * (used before the column was renamed) for backward compatibility with existing rows.
 */
export function parseEstablishmentSettings(
  raw: unknown,
): EstablishmentSettings {
  const d = ESTABLISHMENT_SETTINGS_DEFAULTS;
  if (raw === null || typeof raw !== 'object') return { ...d };
  const s = raw as Record<string, unknown>;

  return {
    retention_orders_days:
      typeof s['retention_orders_days'] === 'number' &&
      s['retention_orders_days'] > 0
        ? s['retention_orders_days']
        : // legacy key written before the field was renamed — keep reading for backward compat
          typeof s['retention_days'] === 'number' && s['retention_days'] > 0
          ? s['retention_days']
          : d.retention_orders_days,

    retention_pings_days:
      typeof s['retention_pings_days'] === 'number' &&
      s['retention_pings_days'] > 0
        ? s['retention_pings_days']
        : d.retention_pings_days,

    courier_not_responding_min:
      typeof s['courier_not_responding_min'] === 'number' &&
      s['courier_not_responding_min'] > 0
        ? s['courier_not_responding_min']
        : d.courier_not_responding_min,

    show_sla_on_dashboard: s['show_sla_on_dashboard'] === true,

    eta_alert_enabled: s['eta_alert_enabled'] === true,

    eta_alert_delay_minutes:
      typeof s['eta_alert_delay_minutes'] === 'number' &&
      s['eta_alert_delay_minutes'] > 0
        ? s['eta_alert_delay_minutes']
        : d.eta_alert_delay_minutes,

    dispatch_recommend_timeout_minutes:
      typeof s['dispatch_recommend_timeout_minutes'] === 'number'
        ? s['dispatch_recommend_timeout_minutes']
        : d.dispatch_recommend_timeout_minutes,

    dispatch_recommend_radius_km:
      typeof s['dispatch_recommend_radius_km'] === 'number' &&
      s['dispatch_recommend_radius_km'] > 0
        ? s['dispatch_recommend_radius_km']
        : d.dispatch_recommend_radius_km,

    dispatch_anomaly_threshold_minutes:
      typeof s['dispatch_anomaly_threshold_minutes'] === 'number' &&
      s['dispatch_anomaly_threshold_minutes'] > 0
        ? s['dispatch_anomaly_threshold_minutes']
        : d.dispatch_anomaly_threshold_minutes,

    dispatch_anomaly_min_deliveries:
      typeof s['dispatch_anomaly_min_deliveries'] === 'number' &&
      s['dispatch_anomaly_min_deliveries'] > 0
        ? s['dispatch_anomaly_min_deliveries']
        : d.dispatch_anomaly_min_deliveries,

    dispatch_no_courier_escalation_minutes:
      typeof s['dispatch_no_courier_escalation_minutes'] === 'number' &&
      s['dispatch_no_courier_escalation_minutes'] > 0
        ? s['dispatch_no_courier_escalation_minutes']
        : d.dispatch_no_courier_escalation_minutes,

    locale: typeof s['locale'] === 'string' ? s['locale'] : d.locale,
  };
}
