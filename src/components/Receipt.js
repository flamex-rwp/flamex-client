import React from 'react';

// JavaScript-controlled printing function
export const printReceipt = (orderData, printStage) => {
  return new Promise((resolve, reject) => {
    if (!orderData) {
      console.error('No order data provided for printing');
      reject(new Error('No order data provided'));
      return;
    }

    // Generate HTML receipt
    const htmlReceipt = generateHTMLReceipt(orderData, printStage);

    // Open new window and print
    const w = window.open("", "_blank");

    if (!w) {
      console.error('Failed to open print window. Please allow popups.');
      alert('Please allow popups to print receipts. Click OK to continue.');
      resolve();
      return;
    }

    // Optimized for 72mm thermal printer - FULL WIDTH with larger text
    w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Receipt - ${printStage === 'customer' ? 'Customer' : 'Kitchen'}</title>
      <style>
        /* RESET EVERYTHING FOR THERMAL PRINTING */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        @media print {
          /* ZERO MARGINS - Use full 72mm width */
          @page {
            size: 72mm auto;
            margin: 0 !important;
            padding: 0 !important;
          }
          
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 72mm !important;
            height: auto !important;
            font-family: 'Courier New', monospace !important;
            font-size: 13px !important; /* INCREASED from 11px */
            font-weight: 500 !important;
            line-height: 1.1 !important;
            -webkit-print-color-adjust: exact !important;
            color: #000000 !important;
            background: #ffffff !important;
            overflow: visible !important;
          }
          
          /* Main receipt container - FULL 72mm WIDTH */
          .receipt-container {
            width: 72mm !important;
            min-width: 72mm !important;
            max-width: 72mm !important;
            margin: 0 auto !important;
            padding: 0.5mm 1mm 2mm 1mm !important; /* Minimal top padding */
            font-family: 'Courier New', monospace !important;
            font-size: 13px !important; /* INCREASED from 11px */
            font-weight: 500 !important;
            line-height: 1.1 !important;
            color: #000000 !important;
            background: #ffffff !important;
            white-space: normal !important;
            word-wrap: break-word !important;
            display: block !important;
            box-sizing: border-box !important;
          }
          
          /* First header - no top margin */
          .receipt-container > .header-text:first-child {
            margin-top: 0 !important;
          }
          
          /* FULL WIDTH ELEMENTS */
          .full-width {
            width: 100% !important;
            max-width: 100% !important;
            display: block !important;
            margin: 0 auto !important;
            text-align: center !important;
            box-sizing: border-box !important;
          }
        
        .header-text {
          font-size: 14px !important;
          font-weight: 600 !important;
          margin: 4px 0 !important;
          text-align: center !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        
        .header-text-left {
          font-size: 14px !important;
          font-weight: 600 !important;
          margin: 4px 0 !important;
          text-align: left !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        
        .center-text {
          text-align: center !important;
          width: 100% !important;
          margin: 2px 0 !important; /* Reduced margin */
          box-sizing: border-box !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          font-size: 13px !important; /* INCREASED */
          font-weight: 500 !important;
        }
        
        /* Horizontal lines - thin style */
        hr {
          border: none !important;
          border-top: 0.5px solid #000 !important;
          margin: 5px 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        
        /* Tables - optimized for 72mm */
        table {
          width: 100% !important;
          max-width: 100% !important;
          border-collapse: collapse !important;
          margin: 4px 0 !important; /* Reduced margin */
          table-layout: fixed !important;
          box-sizing: border-box !important;
          font-size: 12px !important; /* Adjusted table font */
        }
        
        td, th {
          padding: 2px 0 !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          line-height: 1.1 !important;
          vertical-align: top !important;
          box-sizing: border-box !important;
          word-wrap: normal !important;
          overflow-wrap: normal !important;
          word-break: keep-all !important;
          hyphens: auto !important;
        }
        
        .col-item {
          width: 55% !important; /* Adjusted for better spacing */
          max-width: 55% !important;
          text-align: left !important;
          padding-left: 0 !important;
          padding-right: 1px !important;
          overflow: visible !important;
          text-overflow: clip !important;
          white-space: normal !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          box-sizing: border-box !important;
        }
        
        .col-item.address-cell {
          width: 100% !important;
          max-width: 100% !important;
          white-space: normal !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          text-overflow: clip !important;
          box-sizing: border-box !important;
        }
        
        .col-qty {
          width: 15% !important; /* Adjusted */
          max-width: 15% !important;
          text-align: center !important;
          white-space: normal !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          padding-left: 1px !important;
          padding-right: 1px !important;
          box-sizing: border-box !important;
        }
        
        .col-price {
          width: 30% !important; /* Adjusted */
          max-width: 30% !important;
          text-align: right !important;
          padding-left: 1px !important;
          padding-right: 0 !important;
          white-space: normal !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          overflow: visible !important;
          box-sizing: border-box !important;
        }
        
        /* Logo styling */
        .logo-container {
          text-align: center !important;
          width: 100% !important;
          margin: 2px 0 3px 0 !important;
          box-sizing: border-box !important;
        }
        
        .welcome-text {
          font-size: 14px !important;
          font-weight: 500 !important;
          margin: 2px 0 !important;
          text-align: center !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        
        .logo-image {
          max-width: 100% !important;
          width: auto !important;
          height: auto !important;
          max-height: 25mm !important;
          display: block !important;
          margin: 3px auto !important;
          box-sizing: border-box !important;
        }
        
        /* ASCII art - larger */
        .ascii-art {
          font-family: monospace !important;
          font-size: 11px !important; /* INCREASED from 9px */
          line-height: 1.0 !important;
          white-space: pre !important;
          margin: 4px 0 !important;
          text-align: center !important;
          width: 100% !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
        }
        
        /* Spacing - reduced */
        .spacer {
          height: 2px !important;
          display: block !important;
        }
        
        /* Order info table - special styling */
        .order-info td {
          font-size: 12px !important;
          padding: 1px 0 !important;
          font-weight: 500 !important;
        }
      }
      
      /* Screen preview */
      @media screen {
        body {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
          background: #f5f5f5;
          padding: 5px 10px;
          margin: 0;
        }
        .receipt-container {
          width: 400px;
          min-width: 400px;
          max-width: 400px;
          margin: 0 auto;
          padding: 10px 15px 20px 15px;
          background: white;
          border: 1px solid #ddd;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          font-family: 'Courier New', monospace;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.1;
          box-sizing: border-box;
          border-radius: 4px;
          color: #000000;
        }
        .receipt-container > .header-text:first-child {
          margin-top: 0 !important;
        }
        .receipt-container .header-text {
          font-size: 14px;
          font-weight: 600;
          margin: 4px 0;
          text-align: center;
          color: #000000;
        }
        .receipt-container .header-text-left {
          font-size: 14px;
          font-weight: 600;
          margin: 4px 0;
          text-align: left;
          color: #000000;
        }
        .receipt-container .center-text {
          margin: 2px 0;
          font-size: 13px;
          font-weight: 500;
          color: #000000;
        }
        .receipt-container hr {
          margin: 5px 0;
          border-top-width: 0.5px;
          border-top-color: #000000;
        }
        .receipt-container table {
          margin: 4px 0;
        }
        .receipt-container td, .receipt-container th {
          padding: 2px 0;
          font-size: 12px;
          line-height: 1.1;
          font-weight: 500;
          word-wrap: break-word;
          overflow-wrap: break-word;
          color: #000000;
        }
        .receipt-container .ascii-art {
          font-size: 11px;
          margin: 4px 0;
          color: #000000;
        }
        .receipt-container .logo-container {
          text-align: center;
          width: 100%;
          margin: 2px 0 3px 0;
        }
        .receipt-container .welcome-text {
          font-size: 14px;
          font-weight: 500;
          margin: 2px 0;
          text-align: center;
          color: #000000;
        }
        .receipt-container .logo-image {
          max-width: 100%;
          width: auto;
          height: auto;
          max-height: 60px;
          display: block;
          margin: 3px auto;
        }
        .receipt-container .spacer {
          height: 2px;
        }
      }
    </style>
  </head>
  <body>
    ${htmlReceipt}
    <script>
      window.onload = function() {
        // Wait for all images to load before printing
        var images = document.getElementsByTagName('img');
        var imagesToLoad = images.length;
        var imagesLoaded = 0;
        
        if (imagesToLoad === 0) {
          // No images, proceed with print
          printReceipt();
        } else {
          // Wait for all images to load
          for (var i = 0; i < images.length; i++) {
            if (images[i].complete) {
              imagesLoaded++;
            } else {
              images[i].onload = function() {
                imagesLoaded++;
                if (imagesLoaded === imagesToLoad) {
                  printReceipt();
                }
              };
              images[i].onerror = function() {
                imagesLoaded++;
                if (imagesLoaded === imagesToLoad) {
                  printReceipt();
                }
              };
            }
          }
          
          // If all images were already loaded
          if (imagesLoaded === imagesToLoad) {
            printReceipt();
          }
          
          // Fallback timeout in case images don't load
          setTimeout(function() {
            if (imagesLoaded < imagesToLoad) {
              printReceipt();
            }
          }, 2000);
        }
        
        function printReceipt() {
          window.focus();
          setTimeout(function() {
            window.print();
            // Listen for afterprint event to close window and resolve promise
            var printCompleted = false;
            var closeWindow = function() {
              if (!printCompleted) {
                printCompleted = true;
                setTimeout(function() {
                  window.close();
                }, 500);
              }
            };
            window.addEventListener('afterprint', closeWindow);
            // Fallback: close after timeout if afterprint doesn't fire
            setTimeout(closeWindow, 2000);
          }, 100);
        }
      };
    </script>
  </body>
  </html>
`);

    w.document.close();

    // Resolve promise after a delay to allow print dialog to open
    setTimeout(() => {
      resolve();
    }, 100);
  });
};

// Generate HTML receipt
const generateHTMLReceipt = (orderData, printStage) => {
  // Get the origin for image paths
  const origin = window.location.origin;
  const {
    items = [],
    total_amount,
    delivery_charge,
    payment_method,
    amount_taken,
    return_amount,
    order_type,
    customer_name,
    customer_phone,
    customer_address,
    order_number,
    table_number,
    special_instructions,
    delivery_notes,
    subtotal,
    discount_percent,
    discountPercent
  } = orderData || {};

  const orderId = orderData?.id || Date.now();
  const date = new Date();
  // Format time as "4:33 PM" style
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  const dateStr = date.toLocaleDateString();
  const isDelivery = order_type === 'delivery';
  const displayOrderId = order_number ? `#${order_number}` : `#${orderId}`;
  const deliveryFee = delivery_charge ? Number(delivery_charge) : 0;
  const safeItems = Array.isArray(items) ? items : [];

  // Calculate totals
  const calculatedSubtotal = safeItems.reduce((sum, item) => {
    return sum + (Number(item.price || 0) * Number(item.quantity || 0));
  }, 0);
  const subtotalBeforeDiscount = subtotal || calculatedSubtotal;
  const discountPercentValue = discount_percent || discountPercent || 0;
  const discountAmount = discountPercentValue > 0 ? (subtotalBeforeDiscount * discountPercentValue / 100) : 0;
  const subtotalAfterDiscount = subtotalBeforeDiscount - discountAmount;
  const calculatedTotal = subtotalAfterDiscount + deliveryFee;
  const apiTotalAmount = Number(total_amount) || 0;
  // Use API total_amount only if it matches our calculation (within 1 PKR tolerance), otherwise recalculate
  const total = (apiTotalAmount > 0 && Math.abs(apiTotalAmount - calculatedTotal) <= 1) ? apiTotalAmount : calculatedTotal;
  const hasCashInfo = payment_method === 'cash' && amount_taken !== undefined && amount_taken !== null;
  const hasReturnAmount = return_amount !== undefined && return_amount !== null;
  const apiReturnAmount = hasReturnAmount ? Number(return_amount) : null;
  const calculatedChange = hasCashInfo ? ((Number(amount_taken) || 0) - total) : null;
  const tolerance = 1; // 1 PKR tolerance for rounding
  const useApiReturnAmount = apiReturnAmount !== null && calculatedChange !== null
    ? Math.abs(apiReturnAmount - calculatedChange) <= tolerance
    : false;
  const effectiveReturnAmount = hasCashInfo
    ? (useApiReturnAmount && apiReturnAmount !== null ? apiReturnAmount : (calculatedChange !== null ? calculatedChange : 0))
    : null;
  const hasReturnToShow = effectiveReturnAmount !== null;
  const isReturnNegative = hasReturnToShow && effectiveReturnAmount < 0;
  const returnLabel = isReturnNegative ? 'Amount Due:' : 'Change Return:';
  const returnDisplayValue = hasReturnToShow ? Math.abs(effectiveReturnAmount) : 0;

  // Format currency
  const formatCurrency = (amount) => {
    const num = Number(amount) || 0;
    return `PKR ${num.toFixed(0)}`;
  };

  // Truncate text to fit thermal printer width - adjusted for larger font
  const truncateText = (text, maxLength) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };

  let html = '';

  if (printStage === 'customer') {
    html = `
      <div class="receipt-container">
        <!-- LOGO SECTION -->
        <div class="logo-container">
          <img src="${origin}/b-logo.png" alt="Logo" class="logo-image" />
          <div class="center-text">Shally Vallay Chock</div>
        </div>
        <div class="center-text">---------------------------------</div>
        
        <!-- RECEIPT TITLE -->
        <div class="header-text">CUSTOMER RECEIPT</div>
        <div class="center-text">---------------------------------</div>
        
        <!-- ORDER INFO - Compact layout -->
        <table class="order-info">
          ${!isDelivery && table_number ? `
          <tr>
            <td class="col-item">Table:</td>
            <td class="col-price">#${table_number}</td>
          </tr>
          ` : ''}
          <tr>
            <td class="col-item">Date:</td>
            <td class="col-price">${dateStr}</td>
          </tr>
          <tr>
            <td class="col-item">Time:</td>
            <td class="col-price">${timeStr}</td>
          </tr>
          ${payment_method ? `
          <tr>
            <td class="col-item">Payment:</td>
            <td class="col-price">${payment_method === 'cash' ? 'Cash' : payment_method === 'bank_transfer' ? 'Bank Transfer' : payment_method}</td>
          </tr>
          ` : ''}
        </table>

        ${(customer_name || customer_phone || customer_address || delivery_notes) ? `
          <!-- CUSTOMER & DELIVERY INFO - Show when available -->
          <div class="header-text-left">${isDelivery ? 'DELIVERY DETAILS' : 'CUSTOMER INFORMATION'}</div>
          <table class="order-info">
            <tbody>
              ${customer_name ? `
              <tr>
                <td class="col-item">Name:</td>
                <td class="col-price">${truncateText(customer_name, 20)}</td>
              </tr>
              ` : ''}
              ${customer_phone ? `
              <tr>
                <td class="col-item">Phone:</td>
                <td class="col-price">${customer_phone}</td>
              </tr>
              ` : ''}
              ${customer_address ? `
              <tr>
                <td colspan="2" class="col-item address-cell">Address: ${customer_address}</td>
              </tr>
              ` : ''}
              ${delivery_notes ? `
              <tr>
                <td colspan="2" class="col-item address-cell">Notes: ${delivery_notes}</td>
              </tr>
              ` : ''}
            </tbody>
          </table>
          ` : ''}
        
        <!-- ITEMS HEADER -->
        <div class="header-text-left">ORDER ITEMS</div>
        <table>
          <thead>
            <tr>
              <th class="col-item">Item</th>
              <th class="col-qty">Qty</th>
              <th class="col-price">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${safeItems.length > 0 ? safeItems.map(item => {
      const itemName = item.name || 'Unknown Item';
      const shortName = truncateText(itemName, 25); // Adjusted for larger font
      return `
              <tr>
                <td class="col-item">${shortName}</td>
                <td class="col-qty">${item.quantity || 0}</td>
                <td class="col-price">${formatCurrency((Number(item.quantity) || 0) * (Number(item.price) || 0))}</td>
              </tr>
              `;
    }).join('') : `
            <tr>
              <td colspan="3" class="center-text">No items found</td>
            </tr>
            `}
          </tbody>
        </table>
        
        <!-- TOTALS - Prominent display -->
        
        <div class="center-text">---------------------------------</div>
        <table class="order-info">
          <tr>
            <td class="col-item">Subtotal:</td>
            <td class="col-price">${formatCurrency(subtotalBeforeDiscount)}</td>
          </tr>
          ${discountPercentValue > 0 ? `
          <tr>
            <td class="col-item">Discount (${discountPercentValue}%):</td>
            <td class="col-price">-${formatCurrency(discountAmount)}</td>
          </tr>
          ` : ''}
          ${isDelivery && deliveryFee > 0 ? `
          <tr>
            <td class="col-item">Delivery:</td>
            <td class="col-price">${formatCurrency(deliveryFee)}</td>
          </tr>
          ` : ''}
          <tr>
            <td class="col-item" style="font-size: 13px !important; font-weight: 600 !important;">GRAND TOTAL:</td>
            <td class="col-price" style="font-size: 13px !important; font-weight: 600 !important;">${formatCurrency(total)}</td>
          </tr>
        </table>
        
        ${hasCashInfo && hasReturnToShow ? `
        <div class="spacer"></div>
        <table class="order-info">
          <tr>
            <td class="col-item">Cash Received:</td>
            <td class="col-price">${formatCurrency(amount_taken)}</td>
          </tr>
          <tr>
            <td class="col-item">${returnLabel}</td>
            <td class="col-price">${formatCurrency(returnDisplayValue)}</td>
          </tr>
        </table>
        ` : ''}
        
        <!-- FOOTER -->
        <div class="center-text" style="font-size: 14px !important; margin-bottom: 10px !important; margin-top: 20px !important;">          ┌─────────────────────────────┐
          │        THANK YOU !          │
          └─────────────────────────────┘</div>
        <div class="center-text" style="font-size: 14px !important;">${isDelivery ? 'We hope to serve you again !' : 'COME AGAIN SOON!'}</div>
        <div class="center-text">0330-7072222</div>
        <div class="center-text">Abdullah Saleem</div>
        
        <!-- CUT LINE -->
        <div class="spacer"></div>
        <div class="center-text">══════════════════════════════</div>
        <div class="spacer"></div>
      </div>
    `;
  } else {
    // KITCHEN RECEIPT - Optimized for clarity
    html = `
      <div class="receipt-container">
        <!-- LOGO SECTION -->
        <div class="logo-container">
 
          <img src="${origin}/b-logo.png" alt="Logo" class="logo-image" />
          <div class="center-text">Shally Vallay Chock</div>
        </div>
        <div class="center-text">---------------------------------</div>
        
        <!-- ORDER TITLE - Larger -->
        <div class="header-text" style="font-size: 15px !important;">KITCHEN ORDER</div>
        <div class="center-text">---------------------------------</div>
        
        <!-- ORDER INFO - Compact -->
        <table class="order-info">
          <tr>
            <td class="col-item">Order:</td>
            <td class="col-price">${displayOrderId}</td>
          </tr>
          ${!isDelivery && table_number ? `
          <tr>
            <td class="col-item">Table:</td>
            <td class="col-price">#${table_number}</td>
          </tr>
          ` : ''}
          <tr>
            <td class="col-item">Date:</td>
            <td class="col-price">${dateStr}</td>
          </tr>
          <tr>
            <td class="col-item">Time:</td>
            <td class="col-price">${timeStr}</td>
          </tr>
          <tr>
            <td class="col-item">Type:</td>
            <td class="col-price">${isDelivery ? 'DELIVERY' : 'DINE-IN'}</td>
          </tr>
          ${isDelivery && customer_name ? `
          <tr>
            <td class="col-item">Customer:</td>
            <td class="col-price">${truncateText(customer_name, 18)}</td>
          </tr>
          ` : ''}
        </table>
        
        <!-- ITEMS HEADER -->
        <div class="header-text-left">ORDER ITEMS</div>
        <table>
          <thead>
            <tr>
              <th class="col-item" style="width: 70% !important;">Item</th>
              <th class="col-qty" style="width: 30% !important;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${safeItems.length > 0 ? safeItems.map(item => {
      const itemName = item.name || 'Unknown Item';
      const shortName = truncateText(itemName, 28); // Adjusted for larger font
      return `
              <tr>
                <td class="col-item" style="width: 70% !important;">${shortName}</td>
                <td class="col-qty" style="width: 30% !important; font-size: 13px !important;">${item.quantity || 0}</td>
              </tr>
              `;
    }).join('') : `
            <tr>
              <td colspan="2" class="center-text">No items found</td>
            </tr>
            `}
          </tbody>
        </table>
        
        ${special_instructions ? `
        <div class="spacer"></div>
        <div class="header-text-left">SPECIAL INSTRUCTIONS</div>
        <div class="center-text" style="border: 1px solid #000; padding: 3px; margin: 3px 0; font-size: 12px !important; text-align: left !important;">
          ${truncateText(special_instructions, 32)}
        </div>
        ` : ''}
        
        <!-- FOOTER - Urgent message -->
        <div class="ascii-art" style="font-size: 12px !important;">
┌─────────────────────────────┐
│      PLEASE PREPARE         │
│       IMMEDIATELY           │
└─────────────────────────────┘
        </div>
        <div class="center-text" style="font-size: 14px !important;">THANK YOU KITCHEN TEAM!</div>
        
        <!-- CUT LINE -->
        <div class="spacer"></div>
        <div class="center-text">════════════════════════════</div>
        <div class="spacer"></div>
      </div>
    `;
  }

  return html;
};

// React component for preview
const Receipt = ({ orderData, printStage }) => {
  const {
    items = [],
    total_amount,
    delivery_charge,
    payment_method,
    amount_taken,
    return_amount,
    order_type,
    customer_name,
    customer_phone,
    customer_address,
    order_number,
    table_number,
    special_instructions,
    delivery_notes,
    subtotal,
    discount_percent,
    discountPercent
  } = orderData || {};

  const orderId = orderData?.id || Date.now();
  const date = new Date();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  const dateStr = date.toLocaleDateString();
  const isDelivery = order_type === 'delivery';
  const displayOrderId = order_number ? `#${order_number}` : `#${orderId}`;
  const deliveryFee = delivery_charge ? Number(delivery_charge) : 0;
  const safeItems = Array.isArray(items) ? items : [];

  // Calculate totals
  const calculatedSubtotal = safeItems.reduce((sum, item) => {
    return sum + (Number(item.price || 0) * Number(item.quantity || 0));
  }, 0);
  const subtotalBeforeDiscount = subtotal || calculatedSubtotal;
  const discountPercentValue = discount_percent || discountPercent || 0;
  const discountAmount = discountPercentValue > 0 ? (subtotalBeforeDiscount * discountPercentValue / 100) : 0;
  const subtotalAfterDiscount = subtotalBeforeDiscount - discountAmount;
  const calculatedTotal = subtotalAfterDiscount + deliveryFee;
  const apiTotalAmount = Number(total_amount) || 0;
  // Use API total_amount only if it matches our calculation (within 1 PKR tolerance), otherwise recalculate
  const total = (apiTotalAmount > 0 && Math.abs(apiTotalAmount - calculatedTotal) <= 1) ? apiTotalAmount : calculatedTotal;
  const hasCashInfo = payment_method === 'cash' && amount_taken !== undefined && amount_taken !== null;
  const hasReturnAmount = return_amount !== undefined && return_amount !== null;
  const apiReturnAmount = hasReturnAmount ? Number(return_amount) : null;
  const calculatedChange = hasCashInfo ? ((Number(amount_taken) || 0) - total) : null;
  const tolerance = 1; // 1 PKR tolerance for rounding
  const useApiReturnAmount = apiReturnAmount !== null && calculatedChange !== null
    ? Math.abs(apiReturnAmount - calculatedChange) <= tolerance
    : false;
  const effectiveReturnAmount = hasCashInfo
    ? (useApiReturnAmount && apiReturnAmount !== null ? apiReturnAmount : (calculatedChange !== null ? calculatedChange : 0))
    : null;
  const hasReturnToShow = effectiveReturnAmount !== null;
  const isReturnNegative = hasReturnToShow && effectiveReturnAmount < 0;
  const returnLabel = isReturnNegative ? 'Amount Due:' : 'Change Return:';
  const returnDisplayValue = hasReturnToShow ? Math.abs(effectiveReturnAmount) : 0;

  // Format currency
  const formatCurrency = (amount) => {
    const num = Number(amount) || 0;
    return `PKR ${num.toFixed(0)}`;
  };

  // Truncate text
  const truncateText = (text, maxLength) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };

  // Screen preview styles
  const receiptStyle = {
    width: '400px',
    minWidth: '400px',
    maxWidth: '400px',
    margin: '0 auto',
    padding: '10px 15px 20px 15px',
    fontFamily: "'Inter', monospace",
    fontSize: '13px',
  fontWeight: '500',
    lineHeight: '1.1',
    color: '#000000',
    backgroundColor: '#fff',
    boxSizing: 'border-box',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    border: '1px solid #ddd',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    borderRadius: '4px',
  };

  const headerStyle = {
    fontSize: '13px',
    fontWeight: '600',
    margin: '4px 0',
    textAlign: 'center',
    width: '100%',
    boxSizing: 'border-box',
    color: '#000000'
  };
  
  const headerTextLeftStyle = {
    fontSize: '13px',
    fontWeight: '600',
    margin: '4px 0',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    color: '#000000'
  };
  
  // First header style - no top margin
  const firstHeaderStyle = {
    ...headerStyle,
    marginTop: '0',
  };

  const centerTextStyle = {
    textAlign: 'center',
    margin: '2px 0',
    width: '100%',
    fontSize: '10px',
  fontWeight: '500',
    boxSizing: 'border-box',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    color: '#000000'
  };

  const hrStyle = {
    border: 'none',
    borderTop: '0.5px solid #000',
    margin: '5px 0',
    width: '100%',
    boxSizing: 'border-box'
  };

  const asciiArtStyle = {
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.0',
    whiteSpace: 'pre',
    margin: '4px 0',
    textAlign: 'center',
    width: '100%',
    color: '#000000',
    fontWeight: '500'
  };

  const tableStyle = {
    width: '100%',
    maxWidth: '100%',
    borderCollapse: 'collapse',
    margin: '4px 0',
    tableLayout: 'fixed',
    boxSizing: 'border-box',
    fontSize: '12px'
  };

  const tdLeftStyle = {
    padding: '2px 0',
    fontSize: '12px',
  fontWeight: '500',
    lineHeight: '1.1',
    textAlign: 'left',
    width: '55%',
    maxWidth: '55%',
    overflow: 'visible',
    textOverflow: 'clip',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    boxSizing: 'border-box',
    color: '#000000',
    verticalAlign: 'top'
  };

  const tdCenterStyle = {
    padding: '2px 0',
    fontSize: '12px',
  fontWeight: '500',
    lineHeight: '1.1',
    textAlign: 'center',
    width: '15%',
    maxWidth: '15%',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    boxSizing: 'border-box',
    color: '#000000',
    verticalAlign: 'top'
  };

  const tdRightStyle = {
    padding: '2px 0',
    fontSize: '12px',
  fontWeight: '500',
    lineHeight: '1.1',
    textAlign: 'right',
    width: '30%',
    maxWidth: '30%',
    overflow: 'visible',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    boxSizing: 'border-box',
    color: '#000000',
    verticalAlign: 'top'
  };

  // Order info table styles - matches print .order-info td
  const orderInfoTdStyle = {
    ...tdLeftStyle,
    padding: '1px 0',
    fontSize: '12px',
    fontWeight: '500',
    wordWrap: 'break-word',
    overflowWrap: 'break-word'
  };

  if (printStage === 'customer') {
    return (
      <div style={receiptStyle}>
        {/* LOGO SECTION */}
        <div style={{ textAlign: 'center', width: '100%', margin: '2px 0 3px 0' }}>
         
          <img 
            src={process.env.PUBLIC_URL + '/b-logo.png'} 
            alt="Logo" 
            style={{ 
              maxWidth: '100%', 
              width: 'auto', 
              height: 'auto', 
              maxHeight: '60px', 
              display: 'block', 
              margin: '3px auto',
              objectFit: 'contain'
            }} 
            onError={(e) => {
              console.error('Logo image failed to load:', e.target.src);
            }}
          />
          <div style={centerTextStyle}>Shally Vallay Chock</div>
        </div>
        <div style={centerTextStyle}>----------------------------------------</div>
        
        {/* RECEIPT TITLE */}
        <div style={headerStyle}>CUSTOMER RECEIPT</div>
        <div style={centerTextStyle}>----------------------------------------</div>

        {/* ORDER INFO */}
        <table style={tableStyle}>
          <tbody>
            {!isDelivery && table_number && (
              <tr>
                <td style={orderInfoTdStyle}>Table:</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>#{table_number}</td>
              </tr>
            )}
            <tr>
              <td style={orderInfoTdStyle}>Date:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{dateStr}</td>
            </tr>
            <tr>
              <td style={orderInfoTdStyle}>Time:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{timeStr}</td>
            </tr>
            {payment_method && (
              <tr>
                <td style={orderInfoTdStyle}>Payment:</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>
                  {payment_method === 'cash' ? 'Cash' : payment_method === 'bank_transfer' ? 'Bank Transfer' : payment_method}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {isDelivery && (
          <>
            <div style={headerTextLeftStyle}>DELIVERY DETAILS</div>
            <table style={tableStyle}>
              <tbody>
                {customer_name && (
                  <tr>
                    <td style={tdLeftStyle}>Name:</td>
                    <td style={tdRightStyle}>{truncateText(customer_name, 20)}</td>
                  </tr>
                )}
                {customer_phone && (
                  <tr>
                    <td style={tdLeftStyle}>Phone:</td>
                    <td style={tdRightStyle}>{customer_phone}</td>
                  </tr>
                )}
                {customer_address && (
                  <tr>
                    <td colSpan="2" style={{
                      ...tdLeftStyle,
                      fontWeight: '500',
                      whiteSpace: 'normal',
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      overflow: 'visible',
                      textOverflow: 'clip',
                      width: '100%'
                    }}>Address: {customer_address}</td>
                  </tr>
                )}
                {delivery_notes && (
                  <tr>
                    <td colSpan="2" style={{
                      ...tdLeftStyle,
                      fontWeight: '500',
                      whiteSpace: 'normal',
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      overflow: 'visible',
                      textOverflow: 'clip',
                      width: '100%'
                    }}>Notes: {delivery_notes}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {/* ITEMS HEADER */}
        <div style={headerTextLeftStyle}>ORDER ITEMS</div>

        {/* ITEMS TABLE */}
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={tdLeftStyle}>Item</th>
              <th style={tdCenterStyle}>Qty</th>
              <th style={tdRightStyle}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {safeItems.length > 0 ? safeItems.map((item, index) => {
              const itemName = item.name || 'Unknown Item';
              const shortName = truncateText(itemName, 25);
              return (
                <tr key={index}>
                  <td style={tdLeftStyle}>{shortName}</td>
                  <td style={tdCenterStyle}>{item.quantity || 0}</td>
                  <td style={tdRightStyle}>{formatCurrency((Number(item.quantity) || 0) * (Number(item.price) || 0))}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan="3" style={centerTextStyle}>No items found</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* TOTALS */}
        {/* <div style={headerTextLeftStyle}>TOTAL AMOUNT</div> */}
        <div class="center-text">---------------------------------</div>
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td style={orderInfoTdStyle}>Subtotal:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{formatCurrency(subtotalBeforeDiscount)}</td>
            </tr>
            {discountPercentValue > 0 && (
              <tr>
                <td style={orderInfoTdStyle}>Discount ({discountPercentValue}%):</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>-{formatCurrency(discountAmount)}</td>
              </tr>
            )}
            {isDelivery && deliveryFee > 0 && (
              <tr>
                <td style={orderInfoTdStyle}>Delivery:</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{formatCurrency(deliveryFee)}</td>
              </tr>
            )}
            <tr>
              <td style={{ ...orderInfoTdStyle, fontSize: '13px', fontWeight: '600' }}>GRAND TOTAL:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%', fontSize: '13px', fontWeight: '600' }}>{formatCurrency(total)}</td>
            </tr>
          </tbody>
        </table>

        {hasCashInfo && hasReturnToShow && (
          <>
            <div style={{ height: '2px' }}></div>
            <table style={tableStyle}>
              <tbody>
                <tr>
                  <td style={orderInfoTdStyle}>Cash Received:</td>
                  <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{formatCurrency(amount_taken)}</td>
                </tr>
                <tr>
                  <td style={orderInfoTdStyle}>{returnLabel}</td>
                  <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{formatCurrency(returnDisplayValue)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* FOOTER */}
        <div style={{ ...centerTextStyle, fontSize: '14px', marginBottom: '2px' }}>꧁𓊈𒆜 THANK YOU 𒆜𓊉꧂</div>
        <div style={{ ...centerTextStyle, fontSize: '14px' }}>{isDelivery ? 'Thank You! we hope to serve you again' : 'COME AGAIN SOON!'}</div>
        <div style={centerTextStyle}>0330-7072222</div>
        <div style={centerTextStyle}>Abdullah Saleem</div>

        {/* CUT LINE */}
        <div style={{ height: '2px' }}></div>
        <div style={centerTextStyle}>══════════════════════════════</div>
        <div style={{ height: '2px' }}></div>
      </div>
    );
  } else {
    // KITCHEN RECEIPT
    return (
      <div style={receiptStyle}>
        {/* LOGO SECTION */}
        <div style={{ textAlign: 'center', width: '100%', margin: '2px 0 3px 0' }}>
          <img 
            src={process.env.PUBLIC_URL + '/b-logo.png'} 
            alt="Logo" 
            style={{ 
              maxWidth: '100%', 
              width: 'auto', 
              height: 'auto', 
              maxHeight: '60px', 
              display: 'block', 
              margin: '3px auto',
              objectFit: 'contain'
            }} 
            onError={(e) => {
              console.error('Logo image failed to load:', e.target.src);
            }}
          />
          <div style={centerTextStyle}>Shally Vallay Chock</div>
        </div>
        <div style={centerTextStyle}>---------------------------------</div>

        {/* ORDER TITLE */}
        <div style={{ ...headerStyle, fontSize: '15px' }}>KITCHEN ORDER</div>
        <div style={centerTextStyle}>---------------------------------</div>

        {/* ORDER INFO */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td style={orderInfoTdStyle}>Order:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{displayOrderId}</td>
            </tr>
            {!isDelivery && table_number && (
              <tr>
                <td style={orderInfoTdStyle}>Table:</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>#{table_number}</td>
              </tr>
            )}
            <tr>
              <td style={orderInfoTdStyle}>Date:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{dateStr}</td>
            </tr>
            <tr>
              <td style={orderInfoTdStyle}>Time:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{timeStr}</td>
            </tr>
            <tr>
              <td style={orderInfoTdStyle}>Type:</td>
              <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{isDelivery ? 'DELIVERY' : 'DINE-IN'}</td>
            </tr>
            {isDelivery && customer_name && (
              <tr>
                <td style={orderInfoTdStyle}>Customer:</td>
                <td style={{ ...orderInfoTdStyle, textAlign: 'right', width: '30%' }}>{truncateText(customer_name, 18)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* ITEMS HEADER */}
        <div style={headerTextLeftStyle}>ORDER ITEMS</div>

        {/* ITEMS TABLE */}
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...tdLeftStyle, width: '70%' }}>Item</th>
              <th style={{ ...tdCenterStyle, width: '30%', fontSize: '13px' }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {safeItems.map((item, index) => {
              const itemName = item.name || 'Unknown Item';
              const shortName = truncateText(itemName, 28);
              return (
                <tr key={index}>
                  <td style={{ ...tdLeftStyle, width: '70%' }}>{shortName}</td>
                  <td style={{ ...tdCenterStyle, width: '30%', fontSize: '13px' }}>{item.quantity || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {special_instructions && (
          <>
            <div style={{ height: '2px' }}></div>
            <div style={headerTextLeftStyle}>SPECIAL INSTRUCTIONS</div>
            <div style={{ ...centerTextStyle, border: '1px solid #000', padding: '4px', margin: '4px 0', textAlign: 'left' }}>
              {truncateText(special_instructions, 32)}
            </div>
          </>
        )}

        {/* FOOTER */}
        <div style={asciiArtStyle}>
          ┌─────────────────────────────┐
          │      PLEASE PREPARE         │
          │       IMMEDIATELY           │
          └─────────────────────────────┘

        </div>
        <div style={{ ...centerTextStyle, fontSize: '14px' }}>THANK YOU KITCHEN TEAM!</div>

        {/* CUT LINE */}
        <div style={{ height: '2px' }}></div>
        <div style={centerTextStyle}>════════════════════════════</div>
        <div style={{ height: '2px' }}></div>
      </div>
    );
  }
};

export default Receipt;