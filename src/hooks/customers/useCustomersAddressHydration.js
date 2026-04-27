import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';
import { normalizeCustomerFromResponse } from './normalize';

/**
 * For list rows missing `addresses`, fetch detail using the same key as `useCustomerDetailQuery`.
 */
export function useCustomersAddressHydration(customersList, { enabled = true } = {}) {
  const idsNeedingHydration = useMemo(() => {
    if (!enabled || !Array.isArray(customersList)) return [];
    return customersList
      .filter((c) => c?.id != null && (!c.addresses || c.addresses.length === 0))
      .map((c) => c.id);
  }, [customersList, enabled]);

  const detailQueries = useQueries({
    queries: idsNeedingHydration.map((id) => ({
      queryKey: customerKeys.detail(id),
      queryFn: async () => {
        const res = await customerAPI.getById(id);
        const full = normalizeCustomerFromResponse(res);
        if (!full) throw new Error('Customer not found');
        return full;
      },
      enabled: enabled && idsNeedingHydration.length > 0,
      staleTime: 60 * 1000,
    })),
  });

  const detailById = useMemo(() => {
    const map = new Map();
    idsNeedingHydration.forEach((id, i) => {
      const row = detailQueries[i];
      if (row?.data) map.set(id, row.data);
    });
    return map;
  }, [idsNeedingHydration, detailQueries]);

  const customers = useMemo(() => {
    if (!Array.isArray(customersList)) return [];
    return customersList.map((customer) => {
      if (customer?.addresses?.length) return customer;
      const full = detailById.get(customer.id);
      if (full) {
        return { ...customer, addresses: full.addresses || [] };
      }
      return customer;
    });
  }, [customersList, detailById]);

  return { customers };
}
