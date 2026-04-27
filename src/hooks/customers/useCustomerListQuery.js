import { useQuery } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';

function normalizeListResponse(response) {
  const root = response?.data ?? {};
  const data = root?.data ?? root;

  // Expected backend shape:
  // { success: true, data: { customers: [...], pagination: {...} } }
  if (Array.isArray(data?.customers)) return data.customers;

  // Backward-compat (older shapes)
  if (Array.isArray(root?.customers)) return root.customers;
  if (Array.isArray(data)) return data;
  return [];
}

export function useCustomerListQuery(page = 1, limit = 1000, { enabled = true } = {}) {
  return useQuery({
    queryKey: customerKeys.list(page, limit),
    queryFn: async () => {
      const res = await customerAPI.list(page, limit);
      return normalizeListResponse(res);
    },
    enabled,
    staleTime: 30 * 1000,
  });
}
