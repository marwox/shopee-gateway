# Quick Deploy ke Railway

## Cara 1: Lewat GitHub (Recommended)

1. Push folder ini ke GitHub repo Anda
2. Login https://railway.app
3. Click "New Project" → "Deploy from GitHub repo"
4. Pilih repo `shopee-railway-proxy`
5. Railway auto-deploy
6. Copy URL deployment

## Cara 2: Railway CLI (Termudah!)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Deploy
railway up

# Get URL
railway domain
```

## Setelah Deploy

Copy URL Railway (contoh: `https://shopee-proxy-production.up.railway.app`)

Lalu beritahu saya URL tersebut, saya akan update Cloudflare Workers!
