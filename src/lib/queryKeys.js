/**
 * TanStack Query key factories — keep invalidation and hooks aligned.
 */
export const customerKeys = {
  all: ['customers'],
  lists: () => [...customerKeys.all, 'list'],
  list: (page, limit) => [...customerKeys.lists(), { page, limit }],
  searches: () => [...customerKeys.all, 'search'],
  search: (q) => [...customerKeys.searches(), q],
  details: () => [...customerKeys.all, 'detail'],
  detail: (id) => [...customerKeys.details(), id],
  addressesRoot: () => [...customerKeys.all, 'addresses'],
  addresses: (id) => [...customerKeys.addressesRoot(), id],
};
