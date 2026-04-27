import { QueryClient } from '@tanstack/react-query';

function buildQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 45 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = error?.response?.status;
          if (status === 401) return false;
          if (status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/** Singleton used by `QueryClientProvider` in the authenticated app tree. */
export const queryClient = buildQueryClient();
