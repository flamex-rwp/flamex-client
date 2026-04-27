import { useQuery } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';

function normalizeSearchResponse(response) {
  const root = response?.data ?? [];
  const data = root?.data ?? root;

  // Common backend shapes:
  // - { success: true, data: [...] }
  // - { success: true, data: { customers: [...] } }
  // - legacy: [...] or { data: [...] }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.customers)) return data.customers;
  if (Array.isArray(root?.customers)) return root.customers;
  if (Array.isArray(root?.data)) return root.data;
  return [];
}

export function useCustomerSearchQuery(searchQuery, { enabled = true } = {}) {
  const q = searchQuery.trim();
  return useQuery({
    queryKey: customerKeys.search(q),
    queryFn: async () => {
      const res = await customerAPI.search(q);
      return normalizeSearchResponse(res);
    },
    enabled: enabled && q.length >= 2,
    staleTime: 30 * 1000,
  });
}
