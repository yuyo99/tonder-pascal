export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export function parseDateRange(input: string): DateRange {
  const now = new Date();
  const text = input.toLowerCase().trim();

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // Simple keywords
  if (text === "today" || text === "hoy") {
    return { start: todayStart, end: todayEnd, label: "Today" };
  }

  if (text === "yesterday" || text === "ayer") {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - 1);
    return { start: d, end: startOfDay(now), label: "Yesterday" };
  }

  if (text === "this week" || text === "esta semana") {
    const monday = getMonday(now);
    return { start: monday, end: todayEnd, label: "This week" };
  }

  if (text === "last week" || text === "semana pasada") {
    const thisMonday = getMonday(now);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(lastMonday.getDate() - 7);
    return { start: lastMonday, end: thisMonday, label: "Last week" };
  }

  if (text === "this month" || text === "este mes") {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: firstOfMonth, end: todayEnd, label: "This month" };
  }

  if (text === "last month" || text === "mes pasado") {
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: firstLastMonth, end: firstThisMonth, label: "Last month" };
  }

  // Weekend support
  if (text === "this weekend" || text === "este fin de semana") {
    const friday = getMostRecentFriday(now);
    const sundayEnd = new Date(friday);
    sundayEnd.setDate(sundayEnd.getDate() + 2);
    sundayEnd.setHours(23, 59, 59, 999);
    return { start: friday, end: sundayEnd, label: "This weekend (Fri-Sun)" };
  }

  if (
    text === "last weekend" ||
    text === "previous weekend" ||
    text === "fin de semana pasado"
  ) {
    const friday = getMostRecentFriday(now);
    const prevFriday = new Date(friday);
    prevFriday.setDate(prevFriday.getDate() - 7);
    const prevSundayEnd = new Date(prevFriday);
    prevSundayEnd.setDate(prevSundayEnd.getDate() + 2);
    prevSundayEnd.setHours(23, 59, 59, 999);
    return {
      start: prevFriday,
      end: prevSundayEnd,
      label: "Last weekend (Fri-Sun)",
    };
  }

  // "last N days"
  const lastNDays = text.match(/last (\d+) days?|últimos (\d+) días?/);
  if (lastNDays) {
    const n = parseInt(lastNDays[1] || lastNDays[2], 10);
    const start = new Date(todayStart);
    start.setDate(start.getDate() - n);
    return { start, end: todayEnd, label: `Last ${n} days` };
  }

  // "last N hours"
  const lastNHours = text.match(/last (\d+) hours?|últimas (\d+) horas?/);
  if (lastNHours) {
    const n = parseInt(lastNHours[1] || lastNHours[2], 10);
    const start = new Date(now.getTime() - n * 60 * 60 * 1000);
    return { start, end: now, label: `Last ${n} hours` };
  }

  // ISO date range: "2026-02-07 to 2026-02-09"
  const isoRange = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|hasta|-)\s*(\d{4}-\d{2}-\d{2})/
  );
  if (isoRange) {
    const start = new Date(isoRange[1] + "T00:00:00");
    const end = new Date(isoRange[2] + "T23:59:59.999");
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return { start, end, label: `${isoRange[1]} to ${isoRange[2]}` };
    }
  }

  // Single ISO date: "2026-02-07"
  const isoSingle = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (isoSingle) {
    const d = new Date(isoSingle[1] + "T00:00:00");
    if (!isNaN(d.getTime())) {
      return { start: startOfDay(d), end: endOfDay(d), label: isoSingle[1] };
    }
  }

  // Default: today (with warning label so Claude knows it fell through)
  return {
    start: todayStart,
    end: todayEnd,
    label: `Today (unrecognized input: "${input}")`,
  };
}

/**
 * Build a DateRange from explicit ISO start/end strings.
 * Used when Claude passes start_date/end_date instead of a date_range keyword.
 */
export function buildDateRange(startIso: string, endIso: string): DateRange {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(
      `Invalid ISO dates: start="${startIso}", end="${endIso}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format.`
    );
  }
  // If only date provided (no time component), set end to end of day
  if (endIso.length === 10) {
    end.setHours(23, 59, 59, 999);
  }
  const label = `${startIso.slice(0, 10)} to ${endIso.slice(0, 10)}`;
  return { start, end, label };
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function getMonday(d: Date): Date {
  const date = startOfDay(d);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

function getMostRecentFriday(d: Date): Date {
  const date = startOfDay(d);
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  let daysBack: number;
  if (day === 5) {
    daysBack = 0; // today is Friday
  } else if (day === 6) {
    daysBack = 1; // Saturday → go back 1
  } else if (day === 0) {
    daysBack = 2; // Sunday → go back 2
  } else {
    // Mon-Thu: go back to previous Friday
    daysBack = day + 2;
  }
  date.setDate(date.getDate() - daysBack);
  return date;
}
