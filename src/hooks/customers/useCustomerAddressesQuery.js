import { useQuery } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';
import { normalizeAddressesFromResponse } from './normalize';

/**
 * GET /customers/:id/addresses — use for modals/selectors; invalidation is separate from detail.
 */
export function useCustomerAddressesQuery(customerId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: customerKeys.addresses(customerId),
    queryFn: async () => {
      const res = await customerAPI.getAddresses(customerId);
      return normalizeAddressesFromResponse(res);
    },
    enabled: Boolean(customerId) && enabled,
    staleTime: 30 * 1000,
    ...rest,
  });
}
