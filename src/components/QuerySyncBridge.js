import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToSyncCompleted, subscribeToDataRefresh } from '../utils/multiTabSync';
import { customerKeys } from '../lib/queryKeys';

/**
 * After offline sync or cross-tab refresh, invalidate customer queries so UI matches server.
 */
function QuerySyncBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubSync = subscribeToSyncCompleted(() => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    });
    const unsubRefresh = subscribeToDataRefresh(() => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    });
    return () => {
      unsubSync();
      unsubRefresh();
    };
  }, [queryClient]);

  return null;
}

export default QuerySyncBridge;
