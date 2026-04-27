import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerAPI } from '../../services/customerAPI';
import { customerKeys } from '../../lib/queryKeys';

function invalidateCustomerCaches(queryClient, customerId) {
  if (customerId != null) {
    queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) });
    queryClient.invalidateQueries({ queryKey: customerKeys.addresses(customerId) });
  }
  queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
  queryClient.invalidateQueries({ queryKey: customerKeys.searches() });
}

function invalidateAllCustomers(queryClient) {
  queryClient.invalidateQueries({ queryKey: customerKeys.all });
}

export function useCreateCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => customerAPI.create(data),
    onSuccess: () => {
      invalidateAllCustomers(queryClient);
    },
  });
}

export function useUpdateCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => customerAPI.update(id, data),
    onSuccess: (_res, { id }) => {
      invalidateCustomerCaches(queryClient, id);
    },
  });
}

export function useDeleteCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => customerAPI.delete(id),
    onSuccess: () => {
      invalidateAllCustomers(queryClient);
    },
  });
}

export function useCreateCustomerAddressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }) =>
      customerAPI.createAddress(customerId, data).then((r) => r.data?.data ?? r.data),
    onSuccess: (_data, { customerId }) => {
      invalidateCustomerCaches(queryClient, customerId);
    },
  });
}

export function useUpdateCustomerAddressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ addressId, data }) =>
      customerAPI.updateAddress(addressId, data).then((r) => r.data?.data ?? r.data),
    onSuccess: (_data, { customerId }) => {
      invalidateCustomerCaches(queryClient, customerId);
    },
  });
}

export function useDeleteCustomerAddressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ addressId }) => customerAPI.deleteAddress(addressId),
    onSuccess: (_data, { customerId }) => {
      invalidateCustomerCaches(queryClient, customerId);
    },
  });
}
