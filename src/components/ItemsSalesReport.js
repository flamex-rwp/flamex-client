import { useState, useEffect, useCallback } from 'react';
import { ordersAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const ItemsSalesReport = () => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const [itemsSales, setItemsSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);

  const fetchItemsSales = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { filter: dateFilter };
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }

      const response = await ordersAPI.getItemsSales(params);

      // Handle wrapped response format {success: true, data: [...]}
      const salesData = response.data.data || response.data;

      // Ensure we have an array
      const salesArray = Array.isArray(salesData) ? salesData : [];

      setItemsSales(salesArray);
    } catch (err) {
      console.error('Failed to load items sales', err);
      // Don't show error toast for network errors when offline - cache will handle it
      if (err.response) {
        setError(err.formattedMessage || err.response?.data?.error || 'Failed to load items sales');
      } else {
        // Network error - try to use cached data silently
        setItemsSales([]);
        setError(''); // Clear error for network issues
      }
    } finally {
      setLoading(false);
    }
  }, [dateFilter, startDate, endDate]);

  useEffect(() => {
    fetchItemsSales();
  }, [fetchItemsSales]);

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

  const aggregateItemsSales = () => {
    const itemsMap = {};

    itemsSales.forEach(item => {
      // Backend returns camelCase: itemName, totalRevenue, quantity
      const itemName = item.itemName || item.item_name;
      const quantity = parseFloat(item.quantity) || 0;
      const revenue = parseFloat(item.totalRevenue || item.total_revenue) || 0;
      const price = quantity > 0 ? revenue / quantity : 0;

      if (itemsMap[itemName]) {
        itemsMap[itemName].quantity += quantity;
        itemsMap[itemName].total_revenue += revenue;
        // Recalculate average price
        itemsMap[itemName].price = itemsMap[itemName].quantity > 0
          ? itemsMap[itemName].total_revenue / itemsMap[itemName].quantity
          : 0;
      } else {
        itemsMap[itemName] = {
          item_name: itemName,
          quantity: quantity,
          total_revenue: revenue,
          price: price
        };
      }
    });

    return Object.values(itemsMap).sort((a, b) => b.quantity - a.quantity);
  };

  const aggregatedItems = aggregateItemsSales();
  const totalQuantity = aggregatedItems.reduce((total, item) => total + (parseFloat(item.quantity) || 0), 0);
  const totalRevenue = aggregatedItems.reduce((total, item) => total + (parseFloat(item.total_revenue) || 0), 0);
  const uniqueItems = aggregatedItems.length;
  const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;

  // Export PDF function
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;
      const margin = 15;
      const lineHeight = 7;
      const sectionSpacing = 10;

      const checkPageBreak = (requiredSpace = 20) => {
        if (yPosition + requiredSpace > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
      };

      // Header
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('ITEMS SALES REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Flamex', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight * 2;

      // Date Range
      doc.setFontSize(10);
      let filterText = `Date: ${dateFilter}`;
      if (dateFilter === 'custom' && startDate && endDate) {
        filterText = `Date Range: ${dayjs(startDate).format('MMM D, YYYY')} - ${dayjs(endDate).format('MMM D, YYYY')}`;
      } else if (dateFilter === 'today') {
        filterText = `Date: ${dayjs().format('MMM D, YYYY')}`;
      }
      doc.text(filterText, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Summary
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SUMMARY', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Items Sold: ${totalQuantity}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Total Revenue: ${formatCurrency(totalRevenue)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Unique Items: ${uniqueItems}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Average Price: ${formatCurrency(averagePrice)}`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Items List
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('ITEMS', margin, yPosition);
      yPosition += lineHeight * 2;

      if (aggregatedItems.length === 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('No items sold for the selected date range.', margin, yPosition);
      } else {
        aggregatedItems.forEach((item, index) => {
          checkPageBreak(30);

          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(String(item.item_name || 'Unknown Item'), margin, yPosition);
          yPosition += lineHeight;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.text(`Quantity: ${item.quantity || 0}`, margin + 5, yPosition);
          yPosition += lineHeight;
          doc.text(`Price: ${formatCurrency(item.price || 0)}`, margin + 5, yPosition);
          yPosition += lineHeight;
          doc.setFont('helvetica', 'bold');
          doc.text(`Revenue: ${formatCurrency(item.total_revenue || 0)}`, margin + 5, yPosition);
          yPosition += sectionSpacing;

          if (index < aggregatedItems.length - 1) {
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

      const dateRange = dateFilter === 'custom' && startDate && endDate
        ? `${dayjs(startDate).format('YYYY-MM-DD')}_to_${dayjs(endDate).format('YYYY-MM-DD')}`
        : dateFilter;
      const filename = `Items_Sales_${dateRange}_${dayjs().format('YYYY-MM-DD')}.pdf`;

      doc.save(filename);
      showSuccess(`PDF exported successfully with ${aggregatedItems.length} items`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showError('Failed to export PDF. Please try again.');
    }
  };

  // Show offline modal if offline
  if (!online) {
    return <OfflineModal title="Items Sales Report - Offline" />;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold' }}>📦 Items Sales Report</h1>

        {/* Summary Cards */}
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
          {/* Total Items Sold */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Items Sold</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{totalQuantity}</div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{uniqueItems} unique items</div>
          </div>

          {/* Total Revenue */}
          <div style={{
            background: 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)',
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
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{formatCurrency(totalRevenue)}</div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{aggregatedItems.length} items</div>
          </div>

          {/* Average Price */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Average Price</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{formatCurrency(averagePrice)}</div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>Per item</div>
          </div>
        </div>

        {/* Date Filters */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#2d3748', fontSize: '1.2rem', fontWeight: '600' }}>Date Filters</h3>

            {/* Quick Filters */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {['today', 'yesterday', 'this_week', 'this_month', 'custom'].map(filter => (
                <button
                  key={filter}
                  onClick={() => handleQuickFilter(filter)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: `2px solid ${dateFilter === filter ? 'var(--color-primary)' : '#e2e8f0'}`,
                    background: dateFilter === filter ? 'var(--color-primary)' : 'white',
                    color: dateFilter === filter ? 'white' : '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    textTransform: 'capitalize'
                  }}
                >
                  {filter.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Custom Date Range */}
            {showCustomRange && (
              <div style={{
                padding: '1rem',
                background: '#f8f9fa',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate || ''}
                      onChange={(e) => setStartDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '2px solid #e2e8f0',
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
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '2px solid #e2e8f0',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>
                  <button
                    onClick={() => handleDateFilterChange(startDate, endDate)}
                    disabled={!startDate || !endDate}
                    style={{
                      padding: '0.5rem 1.5rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: (!startDate || !endDate) ? '#6c757d' : 'var(--color-primary)',
                      color: 'white',
                      fontWeight: '600',
                      cursor: (!startDate || !endDate) ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem',
                      opacity: (!startDate || !endDate) ? 0.5 : 1
                    }}
                  >
                    Apply
                  </button>
                </div>
                {(startDate && endDate) && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#6c757d' }}>
                    Active Range: {dayjs(startDate).format('MMM D, YYYY')} - {dayjs(endDate).format('MMM D, YYYY')}
                  </div>
                )}
              </div>
            )}

            {/* Export PDF Button */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                onClick={handleExportPDF}
                disabled={aggregatedItems.length === 0}
                style={{
                  padding: '0.5rem 1rem',
                  border: '2px solid #28a745',
                  borderRadius: '8px',
                  background: aggregatedItems.length === 0 ? '#6c757d' : '#28a745',
                  color: 'white',
                  fontWeight: '600',
                  cursor: aggregatedItems.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: aggregatedItems.length === 0 ? 0.5 : 1
                }}
              >
                📄 Export PDF ({aggregatedItems.length} items)
              </button>
            </div>
          </div>
        </div>

        {/* Items Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6c757d' }}>
            Loading items sales...
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
        ) : aggregatedItems.length === 0 ? (
          <div style={{
            background: 'white',
            padding: '3rem',
            borderRadius: '12px',
            textAlign: 'center',
            color: '#6c757d'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
            <h3>No items sold</h3>
            <p>Try adjusting your date filters</p>
          </div>
        ) : (
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '1rem', fontWeight: '600', color: '#495057' }}>Item Name</th>
                  <th style={{ textAlign: 'center', padding: '1rem', fontWeight: '600', color: '#495057' }}>Quantity</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#495057' }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#495057' }}>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {aggregatedItems.map((item, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '1rem', fontWeight: '600', color: '#2d3748' }}>{item.item_name}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#495057' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'right', padding: '1rem', color: '#495057' }}>{formatCurrency(item.price)}</td>
                    <td style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#2d3748' }}>{formatCurrency(item.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8f9fa', fontWeight: 'bold' }}>
                  <td style={{ padding: '1rem', color: '#2d3748' }}>TOTAL</td>
                  <td style={{ textAlign: 'center', padding: '1rem', color: '#2d3748' }}>{totalQuantity}</td>
                  <td style={{ textAlign: 'right', padding: '1rem', color: '#6c757d' }}>-</td>
                  <td style={{ textAlign: 'right', padding: '1rem', color: '#2d3748' }}>{formatCurrency(totalRevenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemsSalesReport;
