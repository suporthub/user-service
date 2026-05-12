// ─────────────────────────────────────────────────────────────────────────────
// utils/timeframe.ts  (user-service)
//
// Mirrors the identical helper in order-gateway so both services parse the
// timeframe query param with exactly the same boundary logic.
//
// Supported values:
//   'today'  → midnight UTC today  →  now
//   'week'   → midnight UTC last Monday  →  now
//   'month'  → midnight UTC 1st of current month  →  now
//   'all'    → no date filter  (startDate / endDate are null)
// ─────────────────────────────────────────────────────────────────────────────

export interface DateRange {
  startDate: Date | null;
  endDate:   Date | null;
}

/**
 * Parse a named timeframe string into a UTC-normalised date range.
 * Unknown values fall back to 'today' (safe default).
 */
export function parseTimeframe(timeframe: string): DateRange {
  const now = new Date();

  const todayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0,
  ));

  switch (timeframe.toLowerCase()) {
    case 'today': {
      return { startDate: todayStart, endDate: now };
    }

    case 'week': {
      const dayOfWeek = now.getUTCDay(); // 0 (Sun) – 6 (Sat)
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysSinceMonday,
        0, 0, 0, 0,
      ));
      return { startDate: weekStart, endDate: now };
    }

    case 'month': {
      const monthStart = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
        0, 0, 0, 0,
      ));
      return { startDate: monthStart, endDate: now };
    }

    case 'all': {
      return { startDate: null, endDate: null };
    }

    default: {
      return { startDate: todayStart, endDate: now };
    }
  }
}
