import { useQuery } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';
import { normalizeCustomerFromResponse } from './normalize';

/**
 * Full customer by id (includes `addresses` when API provides them).
 * Use only under `OfflineProvider` with `enabled` tied to online when appropriate.
 */
export function useCustomerDetailQuery(customerId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: customerKeys.detail(customerId),
    queryFn: async () => {
      const res = await customerAPI.getById(customerId);
      const c = normalizeCustomerFromResponse(res);
      if (!c) throw new Error('Customer not found');
      return c;
    },
    enabled: Boolean(customerId) && enabled,
    ...rest,
  });
}
