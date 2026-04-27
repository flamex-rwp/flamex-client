export function dateRangeFromFilter(filter) {
  const today = new Date();
  const toYMD = (d) => d.toISOString().split('T')[0];

  if (!filter || typeof filter !== 'string') return null;

  if (filter === 'today') {
    const ymd = toYMD(today);
    return { startDate: ymd, endDate: ymd };
  }

  if (filter === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    const ymd = toYMD(d);
    return { startDate: ymd, endDate: ymd };
  }

  if (filter === 'this_week') {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    return { startDate: toYMD(weekStart), endDate: toYMD(today) };
  }

  if (filter === 'this_month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toYMD(monthStart), endDate: toYMD(today) };
  }

  return null;
}
