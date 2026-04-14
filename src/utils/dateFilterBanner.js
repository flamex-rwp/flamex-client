/**
 * Date filter banner: only show when a custom range was applied (Custom + start + end).
 */

export function isCustomDateRangeApplied(dateFilter, startDate, endDate) {
  return dateFilter === 'custom' && Boolean(startDate && endDate);
}

const PRESET_LABELS = {
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
  today: 'Today'
};

/**
 * @param {string} dateFilter
 * @param {string|null} startDate
 * @param {string|null} endDate
 * @param {typeof import('dayjs')} dayjsLib
 */
export function getDateFilterBannerLabel(dateFilter, startDate, endDate, dayjsLib) {
  if (dateFilter === 'custom' && startDate && endDate) {
    return `Dates: ${dayjsLib(startDate).format('MMM D, YYYY')} – ${dayjsLib(endDate).format('MMM D, YYYY')}`;
  }
  return `Dates: ${PRESET_LABELS[dateFilter] || String(dateFilter).replace(/_/g, ' ')}`;
}
