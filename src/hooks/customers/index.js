export { normalizeCustomerFromResponse, normalizeAddressesFromResponse } from './normalize';
export { useCustomerListQuery } from './useCustomerListQuery';
export { useCustomerSearchQuery } from './useCustomerSearchQuery';
export { useCustomerDetailQuery } from './useCustomerDetailQuery';
export { useCustomerAddressesQuery } from './useCustomerAddressesQuery';
export { useCustomersAddressHydration } from './useCustomersAddressHydration';
export {
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
  useDeleteCustomerMutation,
  useCreateCustomerAddressMutation,
  useUpdateCustomerAddressMutation,
  useDeleteCustomerAddressMutation,
} from './useCustomerDomainMutations';
