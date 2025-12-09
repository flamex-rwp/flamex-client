import React from 'react';

const ExpenseTablePrint = ({ expenses, startDate, endDate, total }) => {
  return (
    <div className="print-container" id="expense-print-table">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-container, .print-container * {
            visibility: visible;
          }
          .print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
          }
          .no-print {
            display: none !important;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }
          tfoot {
            display: table-footer-group;
          }
        }

        .print-container {
          background: white;
          padding: 40px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .print-header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 3px solid #333;
          padding-bottom: 20px;
        }

        .print-header h1 {
          margin: 0;
          font-size: 28px;
          color: #333;
          font-weight: bold;
        }

        .print-header .subtitle {
          margin: 10px 0;
          font-size: 16px;
          color: #666;
        }

        .print-header .date-range {
          margin: 5px 0;
          font-size: 14px;
          color: #888;
        }

        .print-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 16px;
        }

        .print-table th {
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          padding: 16px 12px;
          text-align: left;
          font-weight: bold;
          color: #333;
          font-size: 18px;
        }

        .print-table td {
          border: 1px solid #ddd;
          padding: 14px 12px;
          color: #555;
          font-size: 16px;
        }

        .print-table tbody tr:nth-child(even) {
          background-color: #fafafa;
        }

        .print-table tbody tr:hover {
          background-color: #f0f0f0;
        }

        .text-right {
          text-align: right;
        }

        .text-center {
          text-align: center;
        }

        .print-footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 3px solid #333;
        }

        .print-footer .summary {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-size: 16px;
        }

        .print-footer .total-row {
          background-color: #f5f5f5;
          padding: 15px;
          border-radius: 8px;
          margin: 10px 0;
        }

        .print-footer .total-row h3 {
          margin: 0;
          font-size: 24px;
          color: #333;
        }

        .print-footer .generated-info {
          margin-top: 20px;
          text-align: center;
          font-size: 14px;
          color: #999;
        }

        .amount-cell {
          font-weight: 600;
          color: #d32f2f;
          font-size: 17px;
        }

        .no-data {
          text-align: center;
          padding: 40px;
          color: #999;
          font-size: 16px;
        }
      `}</style>

      <div className="print-header">
        <h1>EXPENSE HISTORY REPORT</h1>
        <div className="subtitle">Detailed Expense Records</div>
        {(startDate || endDate) && (
          <div className="date-range">
            Date Range: {startDate || 'All'} to {endDate || 'All'}
          </div>
        )}
        <div className="date-range">
          Generated on: {new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="no-data">
          No expenses found for the selected period
        </div>
      ) : (
        <>
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '10%' }}>Date</th>
                <th style={{ width: '30%' }}>Description</th>
                <th style={{ width: '12%' }}>Category</th>
                <th style={{ width: '8%' }} className="text-right">Qty</th>
                <th style={{ width: '8%' }}>Unit</th>
                <th style={{ width: '12%' }} className="text-right">Unit Price</th>
                <th style={{ width: '15%' }} className="text-right">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense, index) => (
                <tr key={expense.id}>
                  <td className="text-center">{index + 1}</td>
                  <td>{new Date(expense.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}</td>
                  <td>{expense.description}</td>
                  <td>{expense.category || 'Uncategorized'}</td>
                  <td className="text-right">{parseFloat(expense.quantity || 1).toFixed(2)}</td>
                  <td>{expense.unit || 'PCS'}</td>
                  <td className="text-right">
                    {parseFloat(expense.unit_price || expense.amount).toFixed(2)}
                  </td>
                  <td className="text-right amount-cell">
                    {parseFloat(expense.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f5f5f5', fontWeight: 'bold' }}>
                <td colSpan="7" className="text-right" style={{ fontSize: '18px', padding: '18px' }}>
                  TOTAL EXPENSES:
                </td>
                <td className="text-right" style={{ fontSize: '20px', padding: '18px', color: '#d32f2f', fontWeight: 'bold' }}>
                  PKR {total.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="print-footer">
            <div className="summary">
              <div>
                <strong>Total Records:</strong> {expenses.length} expense{expenses.length !== 1 ? 's' : ''}
              </div>
              <div>
                <strong>Report ID:</strong> EXP-{new Date().getTime()}
              </div>
            </div>

            <div className="total-row">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Grand Total:</h3>
                <h3 style={{ color: '#d32f2f' }}>PKR {total.toFixed(2)}</h3>
              </div>
            </div>

            <div className="generated-info">
              <p>This is a computer-generated report. No signature required.</p>
              <p>Generated by Flamex - Expense Management Module</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ExpenseTablePrint;
