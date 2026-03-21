import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

const DEFAULT_DAYS = 30;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Overall delivery statistics for the establishment.
   *
   * Query strategy:
   *   - Single pass over orders + LEFT JOIN deliveries using FILTER aggregates
   *   - Filtered on (establishment_id, created_at) — covered by existing composite index
   *   - NULLIF prevents division-by-zero in ratio calculations
   */
  async getSummary(user: AuthenticatedUser, from?: string, to?: string) {
    const { start, end } = this.dateRange(from, to);

    const rows = await this.prisma.$queryRaw<
      {
        total: bigint;
        completed: bigint;
        failed: bigint;
        cancelled: bigint;
        in_progress: bigint;
        pending: bigint;
        assigned: bigint;
        avg_delivery_minutes: number | null;
        completion_rate: number | null;
        geo_match_rate: number | null;
      }[]
    >`
      SELECT
        COUNT(o.id)                                                               AS total,
        COUNT(o.id) FILTER (WHERE o.status = 'completed')                         AS completed,
        COUNT(o.id) FILTER (WHERE o.status = 'failed')                            AS failed,
        COUNT(o.id) FILTER (WHERE o.status = 'cancelled')                         AS cancelled,
        COUNT(o.id) FILTER (WHERE o.status = 'in_progress')                       AS in_progress,
        COUNT(o.id) FILTER (WHERE o.status = 'pending')                           AS pending,
        COUNT(o.id) FILTER (WHERE o.status = 'assigned')                          AS assigned,

        -- Average delivery duration in minutes (started_at → completed_at)
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (d.completed_at - d.started_at)) / 60.0
          ) FILTER (WHERE d.status = 'completed' AND d.started_at IS NOT NULL)
        ::numeric, 1)                                                             AS avg_delivery_minutes,

        -- Completion rate %
        ROUND(
          100.0
          * COUNT(o.id) FILTER (WHERE o.status = 'completed')
          / NULLIF(COUNT(o.id) FILTER (WHERE o.status IN ('completed','failed')), 0)
        ::numeric, 1)                                                             AS completion_rate,

        -- Geo-match rate % (proofs that passed 300m check)
        ROUND(
          100.0
          * COUNT(p.id) FILTER (WHERE p.geo_match = true)
          / NULLIF(COUNT(p.id), 0)
        ::numeric, 1)                                                             AS geo_match_rate

      FROM orders o
      LEFT JOIN deliveries  d ON d.order_id = o.id
      LEFT JOIN delivery_proofs p ON p.delivery_id = d.id
      WHERE o.establishment_id = ${user.establishment_id}
        AND o.created_at >= ${start}
        AND o.created_at <  ${end}
    `;

    const r = rows[0];
    return {
      period: { from: start, to: end },
      totals: {
        total: Number(r.total),
        completed: Number(r.completed),
        failed: Number(r.failed),
        cancelled: Number(r.cancelled),
        in_progress: Number(r.in_progress),
        pending: Number(r.pending),
        assigned: Number(r.assigned),
      },
      metrics: {
        avg_delivery_minutes: r.avg_delivery_minutes,
        completion_rate: r.completion_rate,
        geo_match_rate: r.geo_match_rate,
      },
    };
  }

  /**
   * Per-courier efficiency breakdown.
   *
   * Query strategy:
   *   - GROUP BY courier — one row per courier, avoids N+1
   *   - Filters orders by date range via JOIN, couriers without deliveries in range
   *     are excluded (INNER JOIN semantics from the WHERE clause)
   *   - NULLIF prevents division-by-zero in completion_rate
   */
  async getCourierStats(user: AuthenticatedUser, from?: string, to?: string) {
    const { start, end } = this.dateRange(from, to);

    const rows = await this.prisma.$queryRaw<
      {
        courier_id: string;
        courier_name: string;
        total: bigint;
        completed: bigint;
        failed: bigint;
        avg_delivery_minutes: number | null;
        completion_rate: number | null;
      }[]
    >`
      SELECT
        c.id                                                                      AS courier_id,
        c.name                                                                    AS courier_name,
        COUNT(d.id)                                                               AS total,
        COUNT(d.id) FILTER (WHERE d.status = 'completed')                         AS completed,
        COUNT(d.id) FILTER (WHERE d.status = 'failed')                            AS failed,

        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (d.completed_at - d.started_at)) / 60.0
          ) FILTER (WHERE d.status = 'completed' AND d.started_at IS NOT NULL)
        ::numeric, 1)                                                             AS avg_delivery_minutes,

        ROUND(
          100.0
          * COUNT(d.id) FILTER (WHERE d.status = 'completed')
          / NULLIF(COUNT(d.id) FILTER (WHERE d.status IN ('completed','failed')), 0)
        ::numeric, 1)                                                             AS completion_rate

      FROM couriers c
      INNER JOIN deliveries d  ON d.courier_id  = c.id
      INNER JOIN orders     o  ON o.id          = d.order_id
      WHERE c.establishment_id = ${user.establishment_id}
        AND o.created_at >= ${start}
        AND o.created_at <  ${end}
      GROUP BY c.id, c.name
      ORDER BY completed DESC, total DESC
    `;

    return rows.map((r) => ({
      courier_id: r.courier_id,
      courier_name: r.courier_name,
      total: Number(r.total),
      completed: Number(r.completed),
      failed: Number(r.failed),
      avg_delivery_minutes: r.avg_delivery_minutes,
      completion_rate: r.completion_rate,
    }));
  }

  /**
   * Time-series orders count (day / week / month granularity).
   *
   * Query strategy:
   *   - date_trunc groups by period — single table scan with index on created_at
   *   - FILTER aggregates compute status breakdown in one pass
   */
  async getTimeline(
    user: AuthenticatedUser,
    from?: string,
    to?: string,
    granularity: 'day' | 'week' | 'month' = 'day',
  ) {
    const { start, end } = this.dateRange(from, to);

    // granularity is validated by DTO — safe to interpolate as identifier
    const rows = await this.prisma.$queryRaw<
      { period: Date; total: bigint; completed: bigint; failed: bigint }[]
    >`
      SELECT
        date_trunc(${granularity}, o.created_at AT TIME ZONE 'UTC') AS period,
        COUNT(*)                                                      AS total,
        COUNT(*) FILTER (WHERE o.status = 'completed')               AS completed,
        COUNT(*) FILTER (WHERE o.status = 'failed')                  AS failed
      FROM orders o
      WHERE o.establishment_id = ${user.establishment_id}
        AND o.created_at >= ${start}
        AND o.created_at <  ${end}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((r) => ({
      period: r.period,
      total: Number(r.total),
      completed: Number(r.completed),
      failed: Number(r.failed),
    }));
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private dateRange(from?: string, to?: string): { start: Date; end: Date } {
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    return { start, end };
  }
}
