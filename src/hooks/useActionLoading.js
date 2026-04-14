import { useCallback, useMemo, useState } from 'react';

/**
 * Keyed loading state for async UI actions.
 * - Use a stable key per button/action (e.g. `order:123:cancel`)
 * - Supports concurrent actions (multiple keys true at once)
 */
export default function useActionLoading() {
  const [processingMap, setProcessingMap] = useState({});

  const isProcessing = useCallback((key) => Boolean(processingMap[key]), [processingMap]);

  const setProcessing = useCallback((key, value) => {
    setProcessingMap((prev) => {
      const next = { ...prev, [key]: Boolean(value) };
      if (!next[key]) delete next[key];
      return next;
    });
  }, []);

  const withProcessing = useCallback(
    async (key, fn) => {
      setProcessing(key, true);
      try {
        return await fn();
      } finally {
        setProcessing(key, false);
      }
    },
    [setProcessing]
  );

  return useMemo(
    () => ({
      isProcessing,
      setProcessing,
      withProcessing,
    }),
    [isProcessing, setProcessing, withProcessing]
  );
}

