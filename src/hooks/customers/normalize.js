export function normalizeCustomerFromResponse(res) {
  return res?.data?.data ?? res?.data ?? null;
}

export function normalizeAddressesFromResponse(res) {
  const d = res?.data?.data ?? res?.data;
  if (Array.isArray(d)) return d;
  return [];
}
