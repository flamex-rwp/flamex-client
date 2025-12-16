import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import jsPDF from 'jspdf';
import { printReceipt } from './Receipt';

dayjs.extend(relativeTime);

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const OrderHistory = () => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [generatingReceiptId, setGeneratingReceiptId] = useState(null);
  // New filters
  const [orderTypeFilter, setOrderTypeFilter] = useState('all'); // 'all', 'dine_in', 'delivery'
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all'); // 'all', 'pending', 'completed'
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all'); // 'all', 'cash', 'bank_transfer'
  const [orderStatusFilter, setOrderStatusFilter] = useState('all'); // 'all', 'pending', 'preparing', 'ready', 'delivered', 'completed'
  const [sortBy, setSortBy] = useState('date_desc'); // 'date_desc', 'date_asc', 'amount_asc', 'amount_desc', 'order_number_asc', 'order_number_desc'
  const [searchDebounce, setSearchDebounce] = useState(null);
  const [stats, setStats] = useState({
    dine_in: {
      total_orders: 0,
      total_revenue: 0,
      avg_order_value: 0,
      completed_orders: 0,
      completed_revenue: 0,
      cash_orders: 0,
      cash_revenue: 0,
      bank_orders: 0,
      bank_revenue: 0
    },
    delivery: {
      total_orders: 0,
      total_revenue: 0,
      avg_order_value: 0,
      completed_orders: 0,
      completed_revenue: 0,
      cash_orders: 0,
      cash_revenue: 0,
      bank_orders: 0,
      bank_revenue: 0
    },
    combined: {
      total_orders: 0,
      total_revenue: 0,
      avg_order_value: 0,
      cash_orders: 0,
      cash_revenue: 0,
      bank_orders: 0,
      bank_revenue: 0
    }
  });

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Prepare params for GET /api/orders (List)
      const listParams = {
        filter: dateFilter,
        // Backend expects startDate/endDate for list filtering
        startDate: startDate,
        endDate: endDate
      };

      if (orderTypeFilter !== 'all') listParams.orderType = orderTypeFilter;
      if (searchTerm.trim()) listParams.search = searchTerm.trim();
      if (paymentStatusFilter !== 'all') listParams.paymentStatus = paymentStatusFilter;
      if (paymentMethodFilter !== 'all') listParams.paymentMethod = paymentMethodFilter;
      if (orderStatusFilter !== 'all') listParams.orderStatus = orderStatusFilter;
      if (sortBy) listParams.sort_by = sortBy;

      // 2. Prepare params for GET /api/orders/statistics/summary (Stats)
      // Backend expects start/end for stats if custom range, or filter string
      const statsParams = {
        filter: dateFilter,
        start: startDate,
        end: endDate
      };

      // Execute both requests in parallel
      const [listResponse, statsResponse] = await Promise.all([
        ordersAPI.getAll(listParams),
        ordersAPI.getOrderStatistics(statsParams)
      ]);

      // Handle List Response
      const listData = listResponse.data.data || listResponse.data;
      const filteredOrders = (listData.orders || listData || []).filter(
        order => order.payment_status !== 'pending'
      );
      setOrders(filteredOrders);

      // Handle Stats Response
      const statsData = statsResponse.data.data || statsResponse.data || {};

      // Transform flat stats to nested structure expected by rendering
      // Backend returns: { totalOrders, totalRevenue, dineInOrders, deliveryOrders, cashRevenue, bankRevenue, pendingOrders }
      setStats({
        dine_in: {
          total_orders: statsData.dineInOrders || 0,
          total_revenue: statsData.dineInRevenue || 0,
          avg_order_value: statsData.dineInOrders ? (statsData.dineInRevenue / statsData.dineInOrders) : 0,
        },
        delivery: {
          total_orders: statsData.deliveryOrders || 0,
          total_revenue: statsData.deliveryRevenue || 0,
          avg_order_value: statsData.deliveryOrders ? (statsData.deliveryRevenue / statsData.deliveryOrders) : 0,
        },
        combined: {
          total_orders: statsData.totalOrders || 0,
          total_revenue: statsData.totalRevenue || 0,
          avg_order_value: statsData.totalOrders ? (statsData.totalRevenue / statsData.totalOrders) : 0,
          cash_orders: statsData.cashOrdersCount || 0,
          cash_revenue: statsData.cashRevenue || 0,
          bank_orders: statsData.bankOrdersCount || 0,
          bank_revenue: statsData.bankRevenue || 0
        }
      });

    } catch (err) {
      console.error('Failed to load order history', err);
      // Don't show error for network errors when offline - cache should handle it
      if (err.response) {
        setError(err.response?.data?.error || 'Failed to load orders');
      } else {
        // Network error - cache should have handled it, set empty data gracefully
        setOrders([]);
        setStats({
          dine_in: { total_orders: 0, total_revenue: 0, avg_order_value: 0, completed_orders: 0, completed_revenue: 0, cash_orders: 0, cash_revenue: 0, bank_orders: 0, bank_revenue: 0 },
          delivery: { total_orders: 0, total_revenue: 0, avg_order_value: 0, completed_orders: 0, completed_revenue: 0, cash_orders: 0, cash_revenue: 0, bank_orders: 0, bank_revenue: 0 },
          combined: { total_orders: 0, total_revenue: 0, avg_order_value: 0, cash_orders: 0, cash_revenue: 0, bank_orders: 0, bank_revenue: 0 }
        });
        setError(''); // Clear error for network issues
      }
    } finally {
      setLoading(false);
    }
  }, [dateFilter, startDate, endDate, orderTypeFilter, searchTerm, paymentStatusFilter, paymentMethodFilter, orderStatusFilter, sortBy]);

  // Fetch orders when filters change (except searchTerm which is debounced)
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, dateFilter, startDate, endDate, orderTypeFilter, paymentStatusFilter, paymentMethodFilter, orderStatusFilter, sortBy]);

  // Debounce search term to avoid excessive API calls
  useEffect(() => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }
    const timer = setTimeout(() => {
      fetchOrders();
    }, 500); // Wait 500ms after user stops typing
    setSearchDebounce(timer);
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const handleQuickFilter = (filter) => {
    if (filter === 'custom') {
      setShowCustomRange(!showCustomRange);
      if (!showCustomRange) {
        setDateFilter('custom');
      } else {
        setDateFilter('today');
        setStartDate(null);
        setEndDate(null);
      }
    } else {
      setDateFilter(filter);
      setStartDate(null);
      setEndDate(null);
      setShowCustomRange(false);
    }
  };

  const handleDateFilterChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setDateFilter('custom');
    setShowCustomRange(false);
  };

  const fetchOrderDetails = async (orderId) => {
    if (expandedOrderId === orderId && orderDetails) {
      setExpandedOrderId(null);
      setOrderDetails(null);
      return;
    }

    setLoadingDetails(true);
    try {
      const [orderResponse, itemsResponse] = await Promise.all([
        ordersAPI.getById(orderId),
        ordersAPI.getOrderItems(orderId)
      ]);

      // Handle wrapped response formats
      const orderData = orderResponse.data.data || orderResponse.data;
      const itemsData = itemsResponse.data.data || itemsResponse.data || [];
      const itemsArray = Array.isArray(itemsData) ? itemsData : [];

      setOrderDetails({
        order: orderData,
        items: itemsArray
      });
      setExpandedOrderId(orderId);
    } catch (err) {
      console.error('Failed to load order details', err);
      showError('Failed to load order details');
    } finally {
      setLoadingDetails(false);
    }
  };

  const getOrderStatusColor = (status) => {
    const colors = {
      pending: { background: '#e2e3e5', color: '#383d41' },
      preparing: { background: '#fff3cd', color: '#856404' },
      ready: { background: '#cfe2ff', color: '#084298' },
      out_for_delivery: { background: '#cfe2ff', color: '#084298' },
      delivered: { background: '#d4edda', color: '#155724' },
      completed: { background: '#d4edda', color: '#155724' },
      cancelled: { background: '#f8d7da', color: '#721c24' }
    };
    return colors[status] || colors.pending;
  };

  const getPaymentStatusColor = (status) => {
    return status === 'completed'
      ? { background: '#e6ffed', color: '#198754' }
      : { background: '#fff4d8', color: '#7c2d12' };
  };

  // Generate receipt for individual order
  const handleGenerateReceipt = async (order) => {
    setGeneratingReceiptId(order.id);
    try {
      // Fetch full order details and items
      const [orderResponse, itemsResponse] = await Promise.all([
        ordersAPI.getById(order.id),
        ordersAPI.getOrderItems(order.id)
      ]);

      // Handle wrapped response formats
      const fullOrder = orderResponse.data.data || orderResponse.data;
      let orderItems = itemsResponse.data.data || itemsResponse.data || [];

      // Ensure orderItems is an array
      orderItems = Array.isArray(orderItems) ? orderItems : [];

      // If no items from API, try to parse from order.items string
      if (!orderItems || orderItems.length === 0) {
        console.warn('No items from API, trying to parse from order.items');
        if (order.items) {
          // Try to parse the items string (format: "Item Name (x2), Another Item (x1)")
          try {
            const itemsString = order.items;
            const itemMatches = itemsString.match(/([^(]+)\s*\(x(\d+)\)/g);
            if (itemMatches) {
              orderItems = itemMatches.map(match => {
                const parts = match.match(/([^(]+)\s*\(x(\d+)\)/);
                if (parts) {
                  return {
                    name: parts[1].trim(),
                    quantity: parseInt(parts[2]),
                    price: 0 // We don't have price from the string
                  };
                }
                return null;
              }).filter(Boolean);
            }
          } catch (parseError) {
            console.error('Failed to parse items string:', parseError);
          }
        }
      }

      if (!orderItems || orderItems.length === 0) {
        showError('No items found for this order. Cannot generate receipt.');
        setGeneratingReceiptId(null);
        return;
      }

      // Calculate subtotal from items
      const subtotal = orderItems.reduce((sum, item) => {
        const itemPrice = parseFloat(item.price || item.item_price || 0);
        const itemQty = parseInt(item.quantity || 0);
        return sum + (itemPrice * itemQty);
      }, 0);

      const deliveryCharge = parseFloat(fullOrder.delivery_charge || 0);

      // Get discount percentage from order - check multiple possible field names
      let discountPercent = parseFloat(
        fullOrder.discount_percent ||
        fullOrder.discountPercent ||
        fullOrder.discount_percentage ||
        order.discount_percent ||
        order.discountPercent ||
        order.discount_percentage ||
        0
      );

      // If discount_percent is not available but total_amount suggests a discount, calculate it
      const apiTotalAmount = parseFloat(fullOrder.total_amount || fullOrder.totalAmount || 0);
      const expectedTotalWithoutDiscount = subtotal + deliveryCharge;

      if (discountPercent === 0 && apiTotalAmount > 0 && apiTotalAmount < expectedTotalWithoutDiscount) {
        // Calculate discount percentage from the difference
        const actualDiscount = expectedTotalWithoutDiscount - apiTotalAmount;
        if (actualDiscount > 0 && subtotal > 0) {
          discountPercent = (actualDiscount / subtotal) * 100;
        }
      }

      // Calculate discount amount and subtotal after discount
      const discountAmount = discountPercent > 0 ? (subtotal * discountPercent / 100) : 0;
      const subtotalAfterDiscount = subtotal - discountAmount;

      // Recalculate total amount: subtotal after discount + delivery charge
      // Use API total_amount only if it matches our calculation (within 1 PKR tolerance)
      const calculatedTotal = subtotalAfterDiscount + deliveryCharge;
      const totalAmount = (Math.abs(apiTotalAmount - calculatedTotal) <= 1) ? apiTotalAmount : calculatedTotal;

      // Payment amounts (support partial payments/negatives)
      const amountTaken = fullOrder.amount_taken !== undefined && fullOrder.amount_taken !== null
        ? parseFloat(fullOrder.amount_taken)
        : fullOrder.amountTaken !== undefined && fullOrder.amountTaken !== null
          ? parseFloat(fullOrder.amountTaken)
          : undefined;
      const returnAmount = fullOrder.return_amount !== undefined && fullOrder.return_amount !== null
        ? parseFloat(fullOrder.return_amount)
        : fullOrder.returnAmount !== undefined && fullOrder.returnAmount !== null
          ? parseFloat(fullOrder.returnAmount)
          : (amountTaken !== undefined ? amountTaken - totalAmount : undefined);

      // Debug: Log API values to help identify if discount_percent is missing from API
      if (discountPercent > 0 || apiTotalAmount !== calculatedTotal) {
        console.log('[Receipt Debug] Order values from API:', {
          orderId: fullOrder.id,
          orderNumber: fullOrder.order_number,
          apiTotalAmount,
          calculatedTotal,
          subtotal,
          deliveryCharge,
          discountPercent,
          discountAmount,
          'fullOrder.discount_percent': fullOrder.discount_percent,
          'fullOrder.discountPercent': fullOrder.discountPercent,
          'fullOrder.discount_percentage': fullOrder.discount_percentage,
          'order.discount_percent': order.discount_percent,
          'order.discountPercent': order.discountPercent
        });
      }

      // Extract customer information from nested customer object or order fields
      const customer = fullOrder.customer || null;
      const customerName = customer?.name || fullOrder.customer_name || order.customer_name || null;
      const customerPhone = customer?.phone || fullOrder.customer_phone || order.customer_phone || null;

      // Extract delivery address - check both camelCase and snake_case
      const deliveryAddress = fullOrder.deliveryAddress || fullOrder.delivery_address || order.delivery_address || order.deliveryAddress || null;
      const deliveryNotes = fullOrder.deliveryNotes || fullOrder.delivery_notes || order.delivery_notes || order.deliveryNotes || null;

      // Prepare receipt data - ensure all required fields are present
      const receiptDataForPrint = {
        id: fullOrder.id,
        order_number: fullOrder.order_number || order.order_number,
        table_number: fullOrder.table_number || order.table_number,
        items: orderItems.map(item => ({
          name: item.menuItem?.name || item.item_name || item.name || 'Unknown Item',
          quantity: parseInt(item.quantity || 0),
          price: parseFloat(item.price || item.item_price || 0)
        })).filter(item => item.name && item.name !== 'Unknown Item' && item.quantity > 0),
        subtotal: subtotal,
        total_amount: totalAmount,
        discount_percent: discountPercent,
        discountPercent: discountPercent,
        delivery_charge: deliveryCharge,
        payment_method: fullOrder.payment_method || order.payment_method || 'cash',
        amount_taken: amountTaken !== undefined ? amountTaken : null,
        return_amount: returnAmount !== undefined ? returnAmount : null,
        payment_status: fullOrder.payment_status || order.payment_status || 'completed',
        order_type: fullOrder.order_type || order.order_type,
        special_instructions: fullOrder.special_instructions || order.special_instructions || null,
        cashier_name: fullOrder.cashier_name || 'Cashier',
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_address: deliveryAddress,
        delivery_notes: deliveryNotes,
        customer: customer || null // Include customer object for notes fallback
      };

      // Validate receipt data
      if (!receiptDataForPrint.items || receiptDataForPrint.items.length === 0) {
        showError('No items found in order. Cannot generate receipt.');
        setGeneratingReceiptId(null);
        return;
      }

      // Validate items array one more time
      if (!receiptDataForPrint.items || receiptDataForPrint.items.length === 0) {
        console.error('Items array is empty after mapping!');
        showError('No items found in order. Cannot generate receipt.');
        setGeneratingReceiptId(null);
        return;
      }

      // Print customer receipt using JavaScript-controlled printing
      printReceipt(receiptDataForPrint, 'customer');

      showSuccess(`Receipt generated for Order #${fullOrder.order_number || fullOrder.id}`);
    } catch (err) {
      console.error('Failed to generate receipt', err);
      showError('Failed to generate receipt. Please try again.');
    } finally {
      setGeneratingReceiptId(null);
    }
  };

  // Export all filtered orders to PDF
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;
      const margin = 15;
      const lineHeight = 7;
      const sectionSpacing = 10;

      // Helper function to add a new page if needed
      const checkPageBreak = (requiredSpace = 20) => {
        if (yPosition + requiredSpace > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
      };

      // Header
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('ORDER HISTORY REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Flamex', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight * 2;

      // Date Range and Filters
      doc.setFontSize(10);
      let filterText = `Date: ${dateFilter}`;
      if (dateFilter === 'custom' && startDate && endDate) {
        filterText = `Date Range: ${dayjs(startDate).format('MMM D, YYYY')} - ${dayjs(endDate).format('MMM D, YYYY')}`;
      } else if (dateFilter === 'today') {
        filterText = `Date: ${dayjs().format('MMM D, YYYY')}`;
      }
      doc.text(filterText, margin, yPosition);
      yPosition += lineHeight;

      if (orderTypeFilter !== 'all') {
        doc.text(`Order Type: ${orderTypeFilter === 'dine_in' ? 'Dine-In' : 'Delivery'}`, margin, yPosition);
        yPosition += lineHeight;
      }
      if (paymentStatusFilter !== 'all') {
        doc.text(`Payment Status: ${paymentStatusFilter}`, margin, yPosition);
        yPosition += lineHeight;
      }
      if (paymentMethodFilter !== 'all') {
        doc.text(`Payment Method: ${paymentMethodFilter === 'cash' ? 'Cash' : 'Bank Transfer'}`, margin, yPosition);
        yPosition += lineHeight;
      }
      if (orderStatusFilter !== 'all') {
        doc.text(`Order Status: ${orderStatusFilter}`, margin, yPosition);
        yPosition += lineHeight;
      }
      if (searchTerm) {
        doc.text(`Search: ${searchTerm}`, margin, yPosition);
        yPosition += lineHeight;
      }

      doc.text(`Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Summary Stats
      checkPageBreak(40);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SUMMARY', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Orders: ${orders.length}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Total Revenue: ${formatCurrency(stats.combined.total_revenue || 0)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Dine-In Orders: ${stats.dine_in.total_orders || 0} (${formatCurrency(stats.dine_in.total_revenue || 0)})`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Delivery Orders: ${stats.delivery.total_orders || 0} (${formatCurrency(stats.delivery.total_revenue || 0)})`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Orders List
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('ORDERS', margin, yPosition);
      yPosition += lineHeight * 2;

      if (orders.length === 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('No orders found for the selected filters.', margin, yPosition);
      } else {
        orders.forEach((order, index) => {
          checkPageBreak(50);

          // Order Header
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(`Order #${order.order_number || order.id} - ${order.order_type === 'delivery' ? 'Delivery' : 'Dine-In'}`, margin, yPosition);
          yPosition += lineHeight;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.text(`Date: ${dayjs(order.created_at).format('MMM D, YYYY h:mm A')}`, margin, yPosition);
          yPosition += lineHeight;

          if (order.table_number) {
            doc.text(`Table: #${order.table_number}`, margin, yPosition);
            yPosition += lineHeight;
          }

          if (order.customer_name) {
            doc.text(`Customer: ${order.customer_name}`, margin, yPosition);
            yPosition += lineHeight;
          }

          if (order.customer_phone) {
            doc.text(`Phone: ${order.customer_phone}`, margin, yPosition);
            yPosition += lineHeight;
          }

          if (order.delivery_address) {
            doc.text(`Address: ${order.delivery_address}`, margin, yPosition);
            yPosition += lineHeight;
          }

          // Items
          if (order.items) {
            doc.text(`Items: ${order.items}`, margin, yPosition);
            yPosition += lineHeight;
          }

          // Amount and Status
          doc.setFont('helvetica', 'bold');
          doc.text(`Total: ${formatCurrency(order.total_amount)}`, margin, yPosition);
          yPosition += lineHeight;
          doc.setFont('helvetica', 'normal');
          doc.text(`Payment: ${order.payment_status === 'completed' ? 'Paid' : 'Pending'} (${order.payment_method === 'cash' ? 'Cash' : 'Bank Transfer'})`, margin, yPosition);
          yPosition += lineHeight;
          doc.text(`Status: ${order.order_status || 'N/A'}`, margin, yPosition);
          yPosition += sectionSpacing;

          // Separator line
          if (index < orders.length - 1) {
            doc.setLineWidth(0.3);
            doc.line(margin, yPosition, pageWidth - margin, yPosition);
            yPosition += sectionSpacing;
          }
        });
      }

      // Footer
      checkPageBreak(20);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Easypaisa: 03307072222', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
      doc.text('Abdullah Saleem', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
      doc.setFont('helvetica', 'bold');
      doc.text('THANK YOU!', pageWidth / 2, yPosition, { align: 'center' });

      // Generate filename
      const dateRange = dateFilter === 'custom' && startDate && endDate
        ? `${dayjs(startDate).format('YYYY-MM-DD')}_to_${dayjs(endDate).format('YYYY-MM-DD')}`
        : dateFilter;
      const filename = `Order_History_${dateRange}_${dayjs().format('YYYY-MM-DD')}.pdf`;

      // Save the PDF
      doc.save(filename);
      showSuccess(`PDF exported successfully with ${orders.length} orders`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showError('Failed to export PDF. Please try again.');
    }
  };

  // Show offline modal if offline
  if (!online) {
    return <OfflineModal title="Order History - Offline" />;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold' }}>📋 Order History</h1>

        {/* Summary Cards - Comparison */}
        <style>{`
          .summary-cards-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
          }
          @media (min-width: 1200px) {
            .summary-cards-grid {
              grid-template-columns: repeat(6, 1fr);
            }
          }
          @media (max-width: 768px) {
            .summary-cards-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          @media (max-width: 480px) {
            .summary-cards-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
        <div className="summary-cards-grid">
          {/* Total Orders - Combined */}
          <div style={{
            background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Orders</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.combined.total_orders || stats.combined.totalOrders || 0}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Avg: {formatCurrency(stats.combined.avg_order_value || stats.combined.avgOrderValue || 0)}
            </div>
          </div>

          {/* Total Revenue - Combined */}
          <div style={{
            background: 'linear-gradient(135deg, #6f42c1 0%, #5a32a3 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Revenue</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {formatCurrency(stats.combined.total_revenue || stats.combined.totalRevenue || 0)}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Based on filter
            </div>
          </div>

          {/* Dine-In Orders */}
          <div style={{
            background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🍽️ Dine-In Orders</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.dine_in.total_orders || stats.dine_in.totalOrders || 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.dine_in.total_revenue || stats.dine_in.totalRevenue || 0)}
            </div>
          </div>

          {/* Delivery Orders */}
          <div style={{
            background: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🚚 Delivery Orders</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.delivery.total_orders || stats.delivery.totalOrders || 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.delivery.total_revenue || stats.delivery.totalRevenue || 0)}
            </div>
          </div>

          {/* Cash Payments */}
          <div style={{
            background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>💵 Cash Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.combined.cash_orders || stats.combined.cashOrders || 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.combined.cash_revenue || stats.combined.cashRevenue || 0)}
            </div>
          </div>

          {/* Bank Payments */}
          <div style={{
            background: 'linear-gradient(135deg, #fd7e14 0%, #e8590c 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🏦 Bank Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.combined.bank_orders || stats.combined.bankOrders || 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.combined.bank_revenue || stats.combined.bankRevenue || 0)}
            </div>
          </div>
        </div>

        {/* Date Filters */}
        <div style={{
          background: 'white',
          padding: '1rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ marginBottom: '0.75rem', fontWeight: '600', color: '#495057' }}>
            Filter by Date
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: showCustomRange ? '1rem' : 0 }}>
            <button
              onClick={() => handleQuickFilter('today')}
              style={{
                padding: '0.5rem 1rem',
                border: dateFilter === 'today' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                borderRadius: '8px',
                background: dateFilter === 'today' ? 'var(--gradient-primary)' : 'white',
                color: dateFilter === 'today' ? 'white' : '#495057',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Today
            </button>
            <button
              onClick={() => handleQuickFilter('yesterday')}
              style={{
                padding: '0.5rem 1rem',
                border: dateFilter === 'yesterday' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                borderRadius: '8px',
                background: dateFilter === 'yesterday' ? 'var(--gradient-primary)' : 'white',
                color: dateFilter === 'yesterday' ? 'white' : '#495057',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Yesterday
            </button>
            <button
              onClick={() => handleQuickFilter('this_week')}
              style={{
                padding: '0.5rem 1rem',
                border: dateFilter === 'this_week' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                borderRadius: '8px',
                background: dateFilter === 'this_week' ? 'var(--gradient-primary)' : 'white',
                color: dateFilter === 'this_week' ? 'white' : '#495057',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              This Week
            </button>
            <button
              onClick={() => handleQuickFilter('this_month')}
              style={{
                padding: '0.5rem 1rem',
                border: dateFilter === 'this_month' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                borderRadius: '8px',
                background: dateFilter === 'this_month' ? 'var(--gradient-primary)' : 'white',
                color: dateFilter === 'this_month' ? 'white' : '#495057',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              This Month
            </button>
            <button
              onClick={() => handleQuickFilter('custom')}
              style={{
                padding: '0.5rem 1rem',
                border: (dateFilter === 'custom' || showCustomRange) ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                borderRadius: '8px',
                background: (dateFilter === 'custom' || showCustomRange) ? 'var(--gradient-primary)' : 'white',
                color: (dateFilter === 'custom' || showCustomRange) ? 'white' : '#495057',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Custom
            </button>
          </div>
          {/* Custom Date Range Input */}
          {showCustomRange && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '8px',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-end',
              flexWrap: 'wrap'
            }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate || ''}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || dayjs().format('YYYY-MM-DD')}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate || ''}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={dayjs().format('YYYY-MM-DD')}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
              <button
                onClick={() => {
                  if (startDate && endDate && dayjs(startDate).isBefore(dayjs(endDate).add(1, 'day'))) {
                    handleDateFilterChange(startDate, endDate);
                  }
                }}
                disabled={!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))}
                style={{
                  padding: '0.5rem 1.5rem',
                  border: 'none',
                  borderRadius: '6px',
                  background: 'var(--gradient-primary)',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: (!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))) ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: (!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))) ? 0.5 : 1
                }}
              >
                Apply
              </button>
            </div>
          )}
          {/* Active Range Display */}
          {(dateFilter === 'custom' && startDate && endDate) && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: '#fff4d8',
              borderRadius: '6px',
              fontSize: '0.85rem',
              color: '#856404',
              fontWeight: '600'
            }}>
              📅 Active Range: {dayjs(startDate).format('MMM D, YYYY')} - {dayjs(endDate).format('MMM D, YYYY')}
            </div>
          )}
        </div>

        {/* Additional Filters */}
        <div style={{
          background: 'white',
          padding: '1rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ marginBottom: '0.75rem', fontWeight: '600', color: '#495057' }}>
            Additional Filters
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            {/* Order Type Filter */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
                Order Type
              </label>
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Orders</option>
                <option value="dine_in">🍽️ Dine-In</option>
                <option value="delivery">🚚 Delivery</option>
              </select>
            </div>

            {/* Payment Status Filter */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
                Payment Status
              </label>
              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="completed">Paid</option>
              </select>
            </div>

            {/* Payment Method Filter */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
                Payment Method
              </label>
              <select
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All</option>
                <option value="cash">💵 Cash</option>
                <option value="bank_transfer">🏦 Bank Transfer</option>
              </select>
            </div>

            {/* Order Status Filter */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
                Order Status
              </label>
              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="preparing">Preparing</option>
                <option value="ready">Ready</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Sort By */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="date_desc">Date (Newest First)</option>
                <option value="date_asc">Date (Oldest First)</option>
                <option value="order_number_desc">Order # (High to Low)</option>
                <option value="order_number_asc">Order # (Low to High)</option>
                <option value="amount_desc">Amount (High to Low)</option>
                <option value="amount_asc">Amount (Low to High)</option>
              </select>
            </div>
          </div>

          {/* Search Bar */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#495057' }}>
              🔍 Search (Order #, Table #, Customer Name/Phone, Address)
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by order number, table number, customer name, phone, or address..."
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '2px solid #e2e8f0',
                fontSize: '0.9rem',
                fontWeight: '500'
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleExportPDF}
              disabled={orders.length === 0}
              style={{
                padding: '0.5rem 1rem',
                border: '2px solid #28a745',
                borderRadius: '8px',
                background: orders.length === 0 ? '#6c757d' : '#28a745',
                color: 'white',
                fontWeight: '600',
                cursor: orders.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '0.9rem',
                opacity: orders.length === 0 ? 0.5 : 1
              }}
            >
              📄 Export PDF ({orders.length} orders)
            </button>
            {(orderTypeFilter !== 'all' || searchTerm || paymentStatusFilter !== 'all' || paymentMethodFilter !== 'all' || orderStatusFilter !== 'all' || sortBy !== 'date_desc') && (
              <button
                onClick={() => {
                  setOrderTypeFilter('all');
                  setSearchTerm('');
                  setPaymentStatusFilter('all');
                  setPaymentMethodFilter('all');
                  setOrderStatusFilter('all');
                  setSortBy('date_desc');
                }}
                style={{
                  padding: '0.5rem 1rem',
                  border: '2px solid #dc3545',
                  borderRadius: '8px',
                  background: 'white',
                  color: '#dc3545',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                🗑️ Clear All Filters
              </button>
            )}
          </div>
        </div>

        {/* Orders List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6c757d' }}>
            Loading orders...
          </div>
        ) : error ? (
          <div style={{
            background: '#fff5f5',
            border: '1px solid #ffc9c9',
            color: '#c92a2a',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1rem'
          }}>
            {error}
          </div>
        ) : orders.length === 0 ? (
          <div style={{
            background: 'white',
            padding: '3rem',
            borderRadius: '12px',
            textAlign: 'center',
            color: '#6c757d'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
            <h3>No orders found</h3>
            <p>Try adjusting your date filters</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gap: '1rem'
          }}>
            {orders.map(order => (
              <div
                key={order.id}
                style={{
                  background: 'white',
                  padding: '1.5rem',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  border: (order.order_type || order.orderType) === 'delivery' ? '2px solid #dc3545' : '2px solid #28a745'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '1rem'
                }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, color: '#2d3748' }}>
                      Order #{order.order_number || order.orderNumber || order.id}
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', fontWeight: 'normal', color: '#6c757d' }}>
                        ({(order.order_type || order.orderType) === 'delivery' ? '🚚 Delivery' : '🍽️ Dine-In'})
                      </span>
                    </h3>
                    <p style={{ margin: '0.5rem 0 0 0', color: '#6c757d', fontSize: '0.9rem' }}>
                      {dayjs(order.created_at || order.createdAt).format('MMM D, YYYY h:mm A')}
                    </p>

                    {/* Order Type Specific Info */}
                    {(order.order_type || order.orderType) === 'dine_in' && (order.table_number || order.tableNumber) && (
                      <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', fontWeight: '600', color: '#2d3748' }}>
                        🪑 Table: #{order.table_number || order.tableNumber}
                      </p>
                    )}

                    {(order.order_type || order.orderType) === 'delivery' && (
                      <div style={{ marginTop: '0.5rem' }}>
                        {(() => {
                          const orderType = order.orderType || order.order_type;
                          if (orderType !== 'delivery') return null;

                          const customer = order.customer;
                          const customerName = customer?.name || order.customer_name || order.customerName;
                          const customerPhone = customer?.phone || order.customer_phone || order.customerPhone;
                          const deliveryAddress = order.delivery_address || order.deliveryAddress;

                          if (!customerName && !customerPhone && !deliveryAddress) return null;

                          return (
                            <>
                              {customerName && (
                                <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', fontWeight: '600', color: '#2d3748' }}>
                                  👤 {customerName}
                                </p>
                              )}
                              {(() => {
                                const deliveryAddress = order.deliveryAddress || order.delivery_address;
                                // Try to get notes and Google Maps link from order first, then fallback to customer's address
                                let notes = order.deliveryNotes || order.delivery_notes || order.notes || '';
                                let googleLink = order.googleMapsLink || order.google_maps_link || '';

                                // If order doesn't have notes/googleLink, try to get from customer's address
                                if ((!notes || !googleLink) && order.customer?.addresses && Array.isArray(order.customer.addresses)) {
                                  const matchingAddress = order.customer.addresses.find(addr =>
                                    addr.address === deliveryAddress || addr.address?.toLowerCase() === deliveryAddress?.toLowerCase()
                                  );
                                  if (matchingAddress) {
                                    if (!notes && matchingAddress.notes) notes = matchingAddress.notes;
                                    if (!googleLink && matchingAddress.googleMapsLink) googleLink = matchingAddress.googleMapsLink;
                                  }
                                }

                                const copyContainerId = `copy-container-${order.id || order.order_number || Math.random()}`;

                                const handleCopy = async () => {
                                  // Get fresh values from order object to ensure we have the latest data
                                  let currentNotes = order.deliveryNotes || order.delivery_notes || order.notes || '';
                                  let currentGoogleLink = order.googleMapsLink || order.google_maps_link || '';

                                  // Fallback to customer's address if order doesn't have it
                                  if ((!currentNotes || !currentGoogleLink) && order.customer?.addresses && Array.isArray(order.customer.addresses)) {
                                    const matchingAddress = order.customer.addresses.find(addr =>
                                      addr.address === deliveryAddress || addr.address?.toLowerCase() === deliveryAddress?.toLowerCase()
                                    );
                                    if (matchingAddress) {
                                      if (!currentNotes && matchingAddress.notes) currentNotes = matchingAddress.notes;
                                      if (!currentGoogleLink && matchingAddress.googleMapsLink) currentGoogleLink = matchingAddress.googleMapsLink;
                                    }
                                  }

                                  let copyText = '';
                                  if (customerPhone) copyText += `Phone: ${customerPhone}`;
                                  if (deliveryAddress) {
                                    if (copyText) copyText += '\n';
                                    copyText += `Address: ${deliveryAddress}`;
                                  }
                                  if (currentNotes && currentNotes.trim()) {
                                    if (copyText) copyText += '\n\n';
                                    copyText += `Notes: ${currentNotes}`;
                                  }
                                  if (currentGoogleLink && currentGoogleLink.trim()) {
                                    if (copyText) copyText += '\n\n';
                                    copyText += `Google Maps: ${currentGoogleLink}`;
                                  }

                                  try {
                                    await navigator.clipboard.writeText(copyText);
                                    showSuccess('Phone, address, notes, and Google Maps link copied to clipboard!');
                                  } catch (err) {
                                    // Fallback for older browsers
                                    const textArea = document.createElement('textarea');
                                    textArea.value = copyText;
                                    document.body.appendChild(textArea);
                                    textArea.select();
                                    document.execCommand('copy');
                                    document.body.removeChild(textArea);
                                    showSuccess('Phone, address, notes, and Google Maps link copied to clipboard!');
                                  }
                                };

                                return (
                                  <div
                                    id={copyContainerId}
                                    style={{ position: 'relative' }}
                                    onMouseEnter={(e) => {
                                      const container = e.currentTarget;
                                      const phoneEl = container.querySelector('.copy-highlight-phone');
                                      const addressEl = container.querySelector('.copy-highlight-address');
                                      if (phoneEl) {
                                        phoneEl.style.backgroundColor = '#fff3cd';
                                      }
                                      if (addressEl) {
                                        addressEl.style.backgroundColor = '#fff3cd';
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      const container = e.currentTarget;
                                      const phoneEl = container.querySelector('.copy-highlight-phone');
                                      const addressEl = container.querySelector('.copy-highlight-address');
                                      if (phoneEl) {
                                        phoneEl.style.backgroundColor = 'transparent';
                                      }
                                      if (addressEl) {
                                        addressEl.style.backgroundColor = 'transparent';
                                      }
                                    }}
                                  >
                                    {customerPhone && (
                                      <p
                                        className="copy-highlight-phone"
                                        style={{
                                          margin: '0.25rem 0',
                                          fontSize: '0.85rem',
                                          color: '#6c757d',
                                          padding: '0.25rem',
                                          borderRadius: '4px',
                                          transition: 'background-color 0.2s ease'
                                        }}
                                      >
                                        📞 {customerPhone}
                                      </p>
                                    )}
                                    {deliveryAddress && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
                                        <p
                                          className="copy-highlight-address"
                                          style={{
                                            margin: 0,
                                            fontSize: '0.85rem',
                                            color: '#6c757d',
                                            flex: 1,
                                            padding: '0.25rem',
                                            borderRadius: '4px',
                                            transition: 'background-color 0.2s ease'
                                          }}
                                        >
                                          📍 {deliveryAddress}
                                        </p>
                                        <button
                                          onClick={handleCopy}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '0.25rem',
                                            fontSize: '1rem',
                                            color: '#495057',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'transform 0.2s ease'
                                          }}
                                          title="Copy phone number, address, notes, and Google Maps link"
                                        >
                                          📋
                                        </button>
                                      </div>
                                    )}
                                    {notes && (
                                      <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6c757d' }}>
                                        <strong>Notes:</strong> {notes}
                                      </div>
                                    )}
                                    {googleLink && (
                                      <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6c757d' }}>
                                        <strong>Google Maps:</strong>{' '}
                                        <a
                                          href={googleLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                                        >
                                          {googleLink}
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Status Badges */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {(() => {
                        // For dine-in orders: if payment is completed, show order status as completed
                        // For delivery orders: show actual order_status
                        const orderType = order.order_type || order.orderType;
                        const paymentStatus = order.payment_status || order.paymentStatus;
                        let displayOrderStatus = order.order_status || order.orderStatus;

                        // If payment is completed and order is dine-in, ensure status shows as completed
                        if (orderType === 'dine_in' && paymentStatus === 'completed') {
                          displayOrderStatus = 'completed';
                        }

                        return displayOrderStatus ? (
                          <div style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '20px',
                            background: getOrderStatusColor(displayOrderStatus).background,
                            color: getOrderStatusColor(displayOrderStatus).color,
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            textTransform: 'capitalize'
                          }}>
                            Order: {displayOrderStatus.replace(/_/g, ' ')}
                          </div>
                        ) : null;
                      })()}
                      {(order.delivery_status || order.deliveryStatus) && (
                        <div style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '20px',
                          background: getOrderStatusColor(order.delivery_status || order.deliveryStatus).background,
                          color: getOrderStatusColor(order.delivery_status || order.deliveryStatus).color,
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          textTransform: 'capitalize'
                        }}>
                          Delivery: {(order.delivery_status || order.deliveryStatus).replace(/_/g, ' ')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: 'var(--color-primary)'
                    }}>
                      {formatCurrency(order.total_amount || order.totalAmount)}
                    </div>
                    {(order.delivery_charge || order.deliveryCharge) > 0 && (
                      <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '0.25rem' }}>
                        Delivery: {formatCurrency(order.delivery_charge || order.deliveryCharge)}
                      </div>
                    )}
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '20px',
                      ...getPaymentStatusColor(order.payment_status || order.paymentStatus)
                    }}>
                      {(order.payment_status || order.paymentStatus) === 'completed' ? 'Paid' : 'Pending Payment'}
                    </div>
                    {(order.payment_method || order.paymentMethod) && (
                      <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '0.25rem' }}>
                        {(order.payment_method || order.paymentMethod) === 'cash' ? '💵 Cash' : '🏦 Bank Transfer'}
                      </div>
                    )}
                    {/* Display return amount if not zero */}
                    {(() => {
                      const returnAmt = order.return_amount || order.returnAmount || 0;
                      if (returnAmt !== 0) {
                        const isNegative = returnAmt < 0;
                        return (
                          <div style={{
                            marginTop: '0.5rem',
                            padding: '0.4rem 0.75rem',
                            borderRadius: '6px',
                            background: isNegative ? '#fee2e2' : '#d1fae5',
                            border: `1px solid ${isNegative ? '#dc2626' : '#10b981'}`,
                            color: isNegative ? '#dc2626' : '#10b981',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            display: 'inline-block'
                          }}>
                            {isNegative ? '⚠️ Restaurant Owed: ' : '💰 Change Given: '}
                            {formatCurrency(Math.abs(returnAmt))}
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {/* Items Preview */}
                <div style={{
                  background: '#f8f9fa',
                  padding: '1rem',
                  borderRadius: '8px',
                  marginBottom: '1rem'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#495057' }}>
                    Items:
                  </div>
                  <div style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                    {(() => {
                      const items = order.items || order.orderItems || order.order_items;
                      if (Array.isArray(items) && items.length > 0) {
                        return items.map(item => {
                          const name = item.menuItem?.name || item.name || item.item_name || 'Item';
                          const qty = item.quantity || 1;
                          return `${name} (x${qty})`;
                        }).join(', ');
                      } else if (typeof items === 'string') {
                        return items;
                      }
                      return 'No items';
                    })()}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    onClick={() => fetchOrderDetails(order.id)}
                    disabled={loadingDetails}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: '2px solid var(--color-primary)',
                      borderRadius: '8px',
                      background: 'white',
                      color: 'var(--color-primary)',
                      fontWeight: 'bold',
                      cursor: loadingDetails ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem'
                    }}
                  >
                    {loadingDetails && expandedOrderId === order.id ? 'Loading...' : expandedOrderId === order.id ? '▼ Hide Details' : '▶ View Details'}
                  </button>
                  <button
                    onClick={() => handleGenerateReceipt(order)}
                    disabled={generatingReceiptId === order.id}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: '2px solid #17a2b8',
                      borderRadius: '8px',
                      background: '#17a2b8',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: generatingReceiptId === order.id ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem',
                      opacity: generatingReceiptId === order.id ? 0.6 : 1
                    }}
                  >
                    {generatingReceiptId === order.id ? 'Generating...' : '🧾 Generate Receipt'}
                  </button>
                </div>

                {/* Expanded Order Details */}
                {expandedOrderId === order.id && orderDetails && (
                  <div style={{
                    marginTop: '1rem',
                    padding: '1.5rem',
                    background: '#f8f9fa',
                    borderRadius: '8px',
                    border: '1px solid #dee2e6'
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: '1rem', color: '#2d3748' }}>Full Order Details</h4>

                    {/* Order Information */}
                    <div style={{ marginBottom: '1rem' }}>
                      <strong>Order Information:</strong>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#495057' }}>
                        <div>Order ID: #{orderDetails.order.id}</div>
                        <div>Order Number: #{orderDetails.order.order_number || orderDetails.order.id}</div>
                        <div>Date & Time: {dayjs(orderDetails.order.created_at).format('MMM D, YYYY h:mm:ss A')}</div>
                        {orderDetails.order.table_number && (
                          <div>Table Number: #{orderDetails.order.table_number}</div>
                        )}
                      </div>
                    </div>

                    {/* Delivery Information (if delivery order) */}
                    {(() => {
                      const orderType = orderDetails.order.orderType || orderDetails.order.order_type;
                      if (orderType !== 'delivery') return null;

                      const customer = orderDetails.order.customer;
                      const customerName = customer?.name || orderDetails.order.customer_name || orderDetails.order.customerName;
                      const customerPhone = customer?.phone || orderDetails.order.customer_phone || orderDetails.order.customerPhone;
                      const deliveryAddress = orderDetails.order.deliveryAddress || orderDetails.order.delivery_address;
                      let deliveryNotes = orderDetails.order.deliveryNotes || orderDetails.order.delivery_notes;
                      const deliveryCharge = orderDetails.order.deliveryCharge || orderDetails.order.delivery_charge || 0;
                      const deliveryStatus = orderDetails.order.deliveryStatus || orderDetails.order.delivery_status;
                      let googleMapsLink = orderDetails.order.googleMapsLink || orderDetails.order.google_maps_link;

                      // If order doesn't have notes/googleLink, try to get from customer's address
                      if ((!deliveryNotes || !googleMapsLink) && orderDetails.order.customer?.addresses && Array.isArray(orderDetails.order.customer.addresses)) {
                        const matchingAddress = orderDetails.order.customer.addresses.find(addr =>
                          addr.address === deliveryAddress || addr.address?.toLowerCase() === deliveryAddress?.toLowerCase()
                        );
                        if (matchingAddress) {
                          if (!deliveryNotes && matchingAddress.notes) deliveryNotes = matchingAddress.notes;
                          if (!googleMapsLink && matchingAddress.googleMapsLink) googleMapsLink = matchingAddress.googleMapsLink;
                        }
                      }

                      return (
                        <div style={{ marginBottom: '1rem' }}>
                          <strong>Customer & Delivery Information:</strong>
                          <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#495057' }}>
                            {customerName && <div>Customer: {customerName}</div>}
                            {(() => {
                              // Use the already computed googleMapsLink (which includes fallback from customer address)
                              const googleLink = googleMapsLink || '';
                              const copyContainerId = `copy-container-details-${orderDetails.order.id || orderDetails.order.order_number || Math.random()}`;

                              const handleCopy = async () => {
                                // Use the already computed deliveryNotes and googleMapsLink (which includes fallback from customer address)
                                let copyText = '';
                                if (customerPhone) copyText += `Phone: ${customerPhone}`;
                                if (deliveryAddress) {
                                  if (copyText) copyText += '\n';
                                  copyText += `Address: ${deliveryAddress}`;
                                }
                                if (deliveryNotes && deliveryNotes.trim()) {
                                  if (copyText) copyText += '\n\n';
                                  copyText += `Notes: ${deliveryNotes}`;
                                }
                                if (googleMapsLink && googleMapsLink.trim()) {
                                  if (copyText) copyText += '\n\n';
                                  copyText += `Google Maps: ${googleMapsLink}`;
                                }

                                try {
                                  await navigator.clipboard.writeText(copyText);
                                  showSuccess('Phone, address, notes, and Google Maps link copied to clipboard!');
                                } catch (err) {
                                  // Fallback for older browsers
                                  const textArea = document.createElement('textarea');
                                  textArea.value = copyText;
                                  document.body.appendChild(textArea);
                                  textArea.select();
                                  document.execCommand('copy');
                                  document.body.removeChild(textArea);
                                  showSuccess('Phone, address, notes, and Google Maps link copied to clipboard!');
                                }
                              };

                              return (
                                <div
                                  id={copyContainerId}
                                  style={{ position: 'relative' }}
                                  onMouseEnter={(e) => {
                                    const container = e.currentTarget;
                                    const phoneEl = container.querySelector('.copy-highlight-phone');
                                    const addressEl = container.querySelector('.copy-highlight-address');
                                    if (phoneEl) {
                                      phoneEl.style.backgroundColor = '#fff3cd';
                                    }
                                    if (addressEl) {
                                      addressEl.style.backgroundColor = '#fff3cd';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    const container = e.currentTarget;
                                    const phoneEl = container.querySelector('.copy-highlight-phone');
                                    const addressEl = container.querySelector('.copy-highlight-address');
                                    if (phoneEl) {
                                      phoneEl.style.backgroundColor = 'transparent';
                                    }
                                    if (addressEl) {
                                      addressEl.style.backgroundColor = 'transparent';
                                    }
                                  }}
                                >
                                  {customerPhone && (
                                    <div
                                      className="copy-highlight-phone"
                                      style={{
                                        padding: '0.25rem',
                                        borderRadius: '4px',
                                        transition: 'background-color 0.2s ease'
                                      }}
                                    >
                                      Phone: {customerPhone}
                                    </div>
                                  )}
                                  {deliveryAddress && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <div
                                        className="copy-highlight-address"
                                        style={{
                                          padding: '0.25rem',
                                          borderRadius: '4px',
                                          transition: 'background-color 0.2s ease',
                                          flex: 1
                                        }}
                                      >
                                        Address: {deliveryAddress}
                                      </div>
                                      <button
                                        onClick={handleCopy}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          cursor: 'pointer',
                                          padding: '0.25rem',
                                          fontSize: '1rem',
                                          color: '#495057',
                                          transition: 'transform 0.2s ease'
                                        }}
                                        title="Copy phone number, address, notes, and Google Maps link"
                                      >
                                        📋
                                      </button>
                                    </div>
                                  )}
                                  {deliveryNotes && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                      <strong>Notes:</strong> {deliveryNotes}
                                    </div>
                                  )}
                                  {googleMapsLink && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                      <strong>Google Maps:</strong>{' '}
                                      <a
                                        href={googleMapsLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                                      >
                                        {googleMapsLink}
                                      </a>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {deliveryCharge > 0 && (
                              <div>Delivery Charge: {formatCurrency(deliveryCharge)}</div>
                            )}
                            {deliveryStatus && (
                              <div>Delivery Status: <span style={{ textTransform: 'capitalize' }}>{deliveryStatus}</span></div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Items */}
                    <div style={{ marginBottom: '1rem' }}>
                      <strong>Items ({orderDetails.items.length}):</strong>
                      <div style={{ marginTop: '0.5rem' }}>
                        {orderDetails.items.map((item, index) => (
                          <div key={index} style={{
                            padding: '0.5rem',
                            background: 'white',
                            borderRadius: '4px',
                            marginBottom: '0.25rem',
                            fontSize: '0.9rem'
                          }}>
                            {item.item_name || item.name} × {item.quantity} @ {formatCurrency(item.price)} = {formatCurrency(item.price * item.quantity)}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Payment Information */}
                    <div style={{ marginBottom: '1rem' }}>
                      <strong>Payment Information:</strong>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#495057' }}>
                        {(() => {
                          const paymentMethod = orderDetails.order.paymentMethod || orderDetails.order.payment_method || 'cash';
                          const paymentStatus = orderDetails.order.paymentStatus || orderDetails.order.payment_status || 'pending';
                          const amountTaken = orderDetails.order.amountTaken || orderDetails.order.amount_taken;
                          const returnAmount = orderDetails.order.returnAmount || orderDetails.order.return_amount;
                          const totalAmount = orderDetails.order.totalAmount || orderDetails.order.total_amount || 0;
                          const subtotalAmount = orderDetails.order.subtotal || 0;
                          const discountPercent =
                            orderDetails.order.discount_percent ||
                            orderDetails.order.discountPercent ||
                            0;
                          const discountAmount = discountPercent > 0 ? (subtotalAmount * discountPercent / 100) : 0;
                          const deliveryCharge =
                            orderDetails.order.deliveryCharge ||
                            orderDetails.order.delivery_charge ||
                            0;
                          const calculatedTotal = (subtotalAmount - discountAmount) + Number(deliveryCharge || 0);
                          const displayTotal = totalAmount || calculatedTotal;

                          return (
                            <>
                              <div>Payment Method: {paymentMethod === 'cash' ? '💵 Cash' : '🏦 Bank Transfer'}</div>
                              <div>Payment Status: <span style={{ textTransform: 'capitalize', fontWeight: '600' }}>{paymentStatus}</span></div>
                              {amountTaken && (
                                <div>Amount Taken: {formatCurrency(amountTaken)}</div>
                              )}
                              {returnAmount && (
                                <div>Return Amount: {formatCurrency(returnAmount)}</div>
                              )}
                              <div>Discount: {discountPercent}% ({formatCurrency(discountAmount)})</div>
                              <div>Delivery Charge: {formatCurrency(deliveryCharge)}</div>
                              <div>Subtotal: {formatCurrency(subtotalAmount)}</div>
                              <div>Total Amount: {formatCurrency(displayTotal)}</div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Special Instructions */}
                    {orderDetails.order.special_instructions && (
                      <div style={{
                        marginTop: '1rem',
                        padding: '0.75rem',
                        background: '#fff3cd',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        color: '#856404',
                        fontWeight: '600'
                      }}>
                        ⚠️ <strong>Special Instructions:</strong> {orderDetails.order.special_instructions}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default OrderHistory;
