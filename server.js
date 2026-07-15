const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// Environment variables
const shopeeToken = process.env.SHOPEE_TOKEN || '';
const apiKey = process.env.API_KEY || '';
const qrisStatic = process.env.QRIS_STATIC || '';

// Store for QRIS and transactions
const qrisStore = new Map();

// User agents for rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function randomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// API Key middleware
function apiKeyMiddleware(req, res, next) {
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!providedKey || providedKey !== apiKey) {
    console.warn('[AUTH] Unauthorized API access attempt');
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing API key'
    });
  }
  
  next();
}

// Format transaction data
function formatTransaction(transaction) {
  const createdAt = new Date(transaction.created_time * 1000);
  const timezoneOffset = 7 * 60; // 7 hours for WIB
  const localTime = new Date(createdAt.getTime() + (timezoneOffset * 60 * 1000));
  
  const pad = (num) => String(num).padStart(2, '0');
  const formattedTime = `${localTime.getUTCFullYear()}-${pad(localTime.getUTCMonth() + 1)}-${pad(localTime.getUTCDate())} ${pad(localTime.getUTCHours())}:${pad(localTime.getUTCMinutes())}:${pad(localTime.getUTCSeconds())}`;
  
  let amountStr = String(transaction.amount || '0').replace(/\./g, '').replace(/,/g, '');
  const amount = parseInt(amountStr, 10) || 0;
  
  const statusMap = { 1: 'PENDING', 2: 'PROCESSING', 3: 'COMPLETED', 4: 'CANCELLED', 5: 'REFUNDED' };
  const status = statusMap[transaction.status] || `UNKNOWN_${transaction.status}`;
  
  return { amount, status, time: formattedTime };
}

// Call Shopee API for transaction list
async function callShopeeAPI(startTime, endTime, pageSize, nextPosition) {
  const requestBody = {
    data: {
      metadata: {
        token: shopeeToken,
        language: 'id',
        timezone: 'Asia/Jakarta'
      },
      pageSize: pageSize,
      filter: {
        startTime: startTime,
        endTime: endTime,
        serviceList: [1, 3]
      },
      sorter: {
        field: 'created_time',
        order: 'descend'
      },
      next_position: nextPosition || ''
    }
  };
  
  const headers = {
    'Content-Type': 'application/json',
    'Origin': 'https://shopee.co.id',
    'Referer': 'https://shopee.co.id/buyer/payment',
    'User-Agent': randomUA(),
    'X-Timestamp-Ms': String(Date.now())
  };
  
  const response = await axios.post(
    'https://shopee.co.id/api/v4/wallet/get_transaction_history',
    requestBody,
    { headers, timeout: 20000 }
  );
  
  return response.data;
}

// CRC16-CCITT checksum
function crc16CCITT(data) {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  crc = crc & 0xFFFF;
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Parse TLV
function parseTLV(qrisData) {
  const result = [];
  let position = 0;
  while (position < qrisData.length) {
    if (position + 4 > qrisData.length) break;
    const tag = qrisData.slice(position, position + 2);
    const lengthStr = qrisData.slice(position + 2, position + 4);
    const length = parseInt(lengthStr, 10);
    if (isNaN(length)) break;
    position += 4;
    if (position + length > qrisData.length) break;
    const value = qrisData.slice(position, position + length);
    position += length;
    result.push([tag, value]);
  }
  return result;
}

// Build TLV
function buildTLV(tlvArray) {
  let result = '';
  for (const [tag, value] of tlvArray) {
    result += tag + String(value.length).padStart(2, '0') + value;
  }
  return result;
}

// Generate dynamic QRIS
function generateDynamicQRIS(staticQris, amount) {
  if (!staticQris) throw new Error('Static QRIS not configured');
  const tlvData = parseTLV(staticQris.slice(0, -4));
  let amountUpdated = false;
  for (let i = 0; i < tlvData.length; i++) {
    if (tlvData[i][0] === '54') {
      tlvData[i][1] = String(amount);
      amountUpdated = true;
      break;
    }
  }
  if (!amountUpdated) {
    tlvData.push(['54', String(amount)]);
  }
  const qrisWithoutCrc = buildTLV(tlvData);
  const crcData = qrisWithoutCrc + '6304';
  const crc = crc16CCITT(crcData);
  return qrisWithoutCrc + '6304' + crc;
}

// ============================================
// API ENDPOINTS (matching deobfuscated server)
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Shopee Payment Gateway Proxy (Render)',
    version: '1.0.0',
    uptime: process.uptime(),
    config: {
      shopee_token: shopeeToken ? '✓ Configured' : '✗ Not set',
      api_key: apiKey ? '✓ Configured' : '✗ Not set',
      qris_static: qrisStatic ? '✓ Configured' : '✗ Not set'
    }
  });
});

// Generate QRIS
app.post('/qris/generate', apiKeyMiddleware, async (req, res) => {
  try {
    const { amount, order_id } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }
    
    if (!order_id) {
      return res.status(400).json({ success: false, error: 'Order ID required' });
    }
    
    const dynamicQris = generateDynamicQRIS(qrisStatic, amount);
    const qrisId = crypto.randomBytes(16).toString('hex');
    
    qrisStore.set(qrisId, {
      amount,
      order_id,
      qris: dynamicQris,
      created_at: Date.now(),
      status: 'pending'
    });
    
    console.log(`[QRIS] Generated for order ${order_id}, amount: ${amount}`);
    
    res.json({
      success: true,
      qris_id: qrisId,
      qris_string: dynamicQris,
      amount,
      order_id
    });
    
  } catch (error) {
    console.error('[QRIS] Generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check payment status
app.post('/payment/check', apiKeyMiddleware, async (req, res) => {
  try {
    const { qris_id, order_id } = req.body;
    
    if (!qris_id && !order_id) {
      return res.status(400).json({ success: false, error: 'QRIS ID or Order ID required' });
    }
    
    let qrisData = null;
    
    if (qris_id) {
      qrisData = qrisStore.get(qris_id);
    } else {
      for (const [key, value] of qrisStore.entries()) {
        if (value.order_id === order_id) {
          qrisData = value;
          break;
        }
      }
    }
    
    if (!qrisData) {
      return res.status(404).json({ success: false, error: 'QRIS not found' });
    }
    
    const endTime = Date.now();
    const startTime = qrisData.created_at;
    
    const result = await callShopeeAPI(startTime, endTime, 20, '');
    
    if (result.error === 0 && result.data && result.data.list) {
      const transactions = result.data.list;
      
      for (const tx of transactions) {
        const formatted = formatTransaction(tx);
        
        if (formatted.amount === qrisData.amount && formatted.status === 'COMPLETED') {
          qrisData.status = 'paid';
          qrisData.transaction_id = tx.transaction_id;
          qrisData.paid_at = Date.now();
          
          console.log(`[PAYMENT] Confirmed for order ${qrisData.order_id}`);
          
          return res.json({
            success: true,
            status: 'paid',
            amount: formatted.amount,
            order_id: qrisData.order_id,
            paid_at: qrisData.paid_at,
            transaction_id: tx.transaction_id
          });
        }
      }
    }
    
    res.json({
      success: true,
      status: 'pending',
      amount: qrisData.amount,
      order_id: qrisData.order_id
    });
    
  } catch (error) {
    console.error('[PAYMENT] Check error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get transactions
app.get('/transactions', apiKeyMiddleware, async (req, res) => {
  try {
    const { start_date, end_date, limit = 20 } = req.query;
    
    let startTime, endTime;
    
    if (start_date) {
      startTime = new Date(start_date).getTime();
    } else {
      startTime = Date.now() - (24 * 60 * 60 * 1000);
    }
    
    if (end_date) {
      endTime = new Date(end_date).getTime();
    } else {
      endTime = Date.now();
    }
    
    const result = await callShopeeAPI(startTime, endTime, parseInt(limit), '');
    
    if (result.error === 0 && result.data) {
      const transactions = result.data.list.map(tx => ({
        transaction_id: tx.transaction_id,
        ...formatTransaction(tx),
        description: tx.description || '',
        order_sn: tx.order_sn || ''
      }));
      
      res.json({
        success: true,
        count: transactions.length,
        transactions
      });
    } else {
      throw new Error('Failed to fetch transactions from Shopee');
    }
    
  } catch (error) {
    console.error('[TRANSACTIONS] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Shopee Payment Gateway Proxy`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🔑 API Key: ${apiKey ? '✓ Configured' : '✗ Not set'}`);
  console.log(`💳 Shopee Token: ${shopeeToken ? '✓ Configured' : '✗ Not set'}`);
  console.log(`🔲 QRIS Static: ${qrisStatic ? '✓ Configured' : '✗ Not set'}\n`);
});
