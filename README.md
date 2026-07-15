# Shopee Railway Proxy

Railway proxy server untuk bypass Cloudflare Workers IP block saat akses Shopee API.

## Deploy ke Railway

1. Login ke https://railway.app dengan GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Pilih repo ini
4. Railway akan auto-deploy
5. Copy URL yang diberikan (contoh: `https://shopee-proxy.up.railway.app`)
6. Update Cloudflare Workers dengan URL ini

## Environment Variables

Tidak perlu environment variables. Server siap pakai langsung.

## Endpoint

### Health Check
```
GET /
```

### Check Shopee Payment
```
POST /api/shopee/check-payment
Content-Type: application/json

{
  "token": "shopee-token-here",
  "amount": 10000,
  "startTime": 1234567890000,
  "endTime": 1234567990000
}
```

## Local Testing

```bash
npm install
npm start
```

Server will run on http://localhost:4000
