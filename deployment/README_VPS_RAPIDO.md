# VPS rapido COLMENA-SS

## 1. DNS

En IONOS:

```txt
A api IP_DEL_VPS
```

## 2. Instalar base

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/aporloptemplarios-star/colmena-ss-web.git /tmp/colmena-install
cd /tmp/colmena-install
bash deployment/install-vps.sh
```

## 3. Clonar app

```bash
cd /var/www/colmena-web
git clone https://github.com/aporloptemplarios-star/colmena-ss-web.git .
cp deployment/.env.production.example .env
nano .env
```

Rellena todos los `PENDIENTE_*`.

## 4. Arrancar API + bot

```bash
bash deployment/start-vps.sh
```

## 5. SSL

Cuando `api.colmena-ss.es` resuelva a la IP del VPS:

```bash
sudo certbot --nginx -d api.colmena-ss.es
```

## 6. Pruebas

```bash
curl https://api.colmena-ss.es/api/status
curl https://api.colmena-ss.es/api/health
npm run smoke:api
pm2 logs colmena-web
```
