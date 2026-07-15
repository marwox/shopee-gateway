const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Shopee Railway Proxy',
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Shopee API proxy endpoint
app.post('/api/shopee/check-payment', async (req, res) => {
  try {
    const { token, amount, startTime, endTime } = req.body;

    if (!token || !amount || !startTime || !endTime) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['token', 'amount', 'startTime', 'endTime']
      });
    }

    const startTimeSec = Math.floor(startTime / 1000);
    const endTimeSec = Math.floor(endTime / 1000);

    const requestBody = {
      data: {
        metadata: {
          token: token,
          language: 'id',
          timezone: 'Asia/Jakarta'
        },
        pageSize: 50,
        filter: {
          startTime: startTimeSec,
          endTime: endTimeSec,
          serviceList: [1, 3] // 1 = ShopeePay, 3 = QRIS
        },
        sorter: {
          field: 'created_time',
          order: 'descend'
        },
        next_position: ''
      }
    };

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9',
      'Content-Type': 'application/json',
      'Origin': 'https://shopee.co.id',
      'Referer': 'https://shopee.co.id/buyer/payment',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Timestamp-Ms': String(Date.now())
    };

    console.log('[PROXY] Forwarding request to Shopee API - Amount:', amount);

    const response = await axios.post(
      'https://shopee.co.id/api/v4/wallet/get_transaction_history',
      requestBody,
      { headers, timeout: 20000 }
    );

    console.log('[PROXY] Shopee API response:', response.status);

    // Return full response to Cloudflare Workers
    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('[PROXY] Error:', error.message);
    
    if (error.response) {
      // Shopee API returned error
      res.status(error.response.status).json({
        success: false,
        error: error.response.data || error.message
      });
    } else {
      // Network or other error
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Shopee Railway Proxy running on port ${PORT}`);
});
