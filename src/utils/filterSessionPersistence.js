/**
 * Persist list/report filter UI in sessionStorage so choices survive route changes
 * (same browser tab until cleared or session ends).
 */

export const FILTER_STORAGE_KEYS = {
  dineInOrders: 'flamex:screenFilters:dineInOrders',
  deliveryOrders: 'flamex:screenFilters:deliveryOrders',
  dailySalesSummary: 'flamex:screenFilters:dailySalesSummary',
  deliveryReports: 'flamex:screenFilters:deliveryReports',
  expenseHistory: 'flamex:screenFilters:expenseHistory',
  itemsSalesReport: 'flamex:screenFilters:itemsSalesReport',
  orderHistory: 'flamex:screenFilters:orderHistory'
};

export function readFilterSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFilterSession(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota or private mode — ignore
  }
}

const DATE_FILTERS = new Set(['today', 'yesterday', 'this_week', 'this_month', 'custom']);

export function sanitizeDateFilter(value) {
  return DATE_FILTERS.has(value) ? value : 'today';
}

const DELIVERY_REPORT_TABS = new Set(['overview', 'areas', 'cod']);

export function sanitizeDeliveryReportTab(value) {
  return DELIVERY_REPORT_TABS.has(value) ? value : 'overview';
}

const COD_STATUSES = new Set(['pending', 'completed', 'all']);

export function sanitizeCodStatus(value) {
  return COD_STATUSES.has(value) ? value : 'pending';
}

const ORDER_HISTORY_ORDER_TYPE = new Set(['all', 'dine_in', 'delivery']);
const ORDER_HISTORY_PAYMENT_STATUS = new Set(['all', 'pending', 'completed', 'cancelled']);
const ORDER_HISTORY_PAYMENT_METHOD = new Set(['all', 'cash', 'bank_transfer']);
const ORDER_HISTORY_ORDER_STATUS = new Set([
  'all',
  'pending',
  'preparing',
  'ready',
  'delivered',
  'completed',
  'cancelled'
]);
const ORDER_HISTORY_SORT = new Set([
  'date_desc',
  'date_asc',
  'order_number_asc',
  'order_number_desc',
  'amount_asc',
  'amount_desc'
]);

export function sanitizeOrderHistoryOrderType(value) {
  return ORDER_HISTORY_ORDER_TYPE.has(value) ? value : 'all';
}

export function sanitizeOrderHistoryPaymentStatus(value) {
  return ORDER_HISTORY_PAYMENT_STATUS.has(value) ? value : 'all';
}

export function sanitizeOrderHistoryPaymentMethod(value) {
  return ORDER_HISTORY_PAYMENT_METHOD.has(value) ? value : 'all';
}

export function sanitizeOrderHistoryOrderStatus(value) {
  return ORDER_HISTORY_ORDER_STATUS.has(value) ? value : 'all';
}

export function sanitizeOrderHistorySortBy(value) {
  return ORDER_HISTORY_SORT.has(value) ? value : 'date_desc';
}

export function sanitizeOrderHistorySearch(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 500);
}
