# Farm Automation System — Deployment Guide
# Oracle Cloud Free Tier — Ubuntu 22.04

## ─────────────────────────────────────────
## STEP 1 — Upload project to Oracle VM
## ─────────────────────────────────────────

# From your local machine:
scp -i your-key.key -r farm-automation/ ubuntu@YOUR_IP:/home/ubuntu/

# SSH into the VM:
ssh -i your-key.key ubuntu@YOUR_IP


## ─────────────────────────────────────────
## STEP 2 — Install dependencies
## ─────────────────────────────────────────

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Nginx, Mosquitto, Certbot
sudo apt install -y nginx mosquitto mosquitto-clients certbot python3-certbot-nginx

# Install PM2 (keeps Node running forever)
sudo npm install -g pm2


## ─────────────────────────────────────────
## STEP 3 — Setup DuckDNS (free domain)
## ─────────────────────────────────────────

# 1. Go to https://www.duckdns.org
# 2. Login with Google/GitHub
# 3. Create subdomain: e.g. "myfarm" → myfarm.duckdns.org
# 4. Set IP = your Oracle VM public IP
# 5. Note your token

# Auto-update IP (in case it changes):
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh << 'EOF'
echo url="https://www.duckdns.org/update?domains=YOURDOMAIN&token=YOURTOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF
chmod +x ~/duckdns/duck.sh
# Add to crontab:
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -


## ─────────────────────────────────────────
## STEP 4 — SSL Certificate
## ─────────────────────────────────────────

# Make sure port 80 is open in Oracle security list first!
sudo certbot --nginx -d myfarm.duckdns.org

# Auto-renew (add to crontab):
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl restart mosquitto nginx") | crontab -


## ─────────────────────────────────────────
## STEP 5 — Configure Mosquitto
## ─────────────────────────────────────────

sudo tee /etc/mosquitto/conf.d/farm.conf << 'EOF'
# Plain MQTT - local only (backend uses this internally)
listener 1883 localhost

# MQTT over TLS - for ESP32 devices
listener 8883
certfile /etc/letsencrypt/live/myfarm.duckdns.org/fullchain.pem
keyfile  /etc/letsencrypt/live/myfarm.duckdns.org/privkey.pem
require_certificate false

# WebSocket over TLS - for browser
listener 9001
protocol websockets
certfile /etc/letsencrypt/live/myfarm.duckdns.org/fullchain.pem
keyfile  /etc/letsencrypt/live/myfarm.duckdns.org/privkey.pem

# Authentication (required for all listeners)
password_file /etc/mosquitto/passwd
allow_anonymous false
EOF

# Create MQTT user (remember this password!)
sudo mosquitto_passwd -c /etc/mosquitto/passwd farmuser
# Enter a strong password when prompted

# Allow Mosquitto to read SSL certs
sudo chmod -R 755 /etc/letsencrypt/live/
sudo chmod -R 755 /etc/letsencrypt/archive/

sudo systemctl restart mosquitto
sudo systemctl enable mosquitto
sudo systemctl status mosquitto   # Should show: active (running)


## ─────────────────────────────────────────
## STEP 6 — Deploy the app
## ─────────────────────────────────────────

# Create web directory
sudo mkdir -p /var/www/farmcontrol
sudo chown -R ubuntu:ubuntu /var/www/farmcontrol

# Copy frontend
cp -r ~/farm-automation/frontend /var/www/farmcontrol/

# Setup backend
cd ~/farm-automation/backend
npm install

# Create .env from template
cp .env.example .env
nano .env
# Fill in:
#   JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
#   MQTT_USERNAME=farmuser
#   MQTT_PASSWORD=<your mosquitto password>
#   ADMIN_EMAIL=admin@yourdomain.com
#   ADMIN_PASSWORD=<strong password>


## ─────────────────────────────────────────
## STEP 7 — Configure Nginx
## ─────────────────────────────────────────

# Copy nginx config (replace YOUR_DOMAIN with your actual domain)
sudo cp ~/farm-automation/nginx/farmcontrol.conf /etc/nginx/sites-available/farmcontrol
sudo nano /etc/nginx/sites-available/farmcontrol
# Replace all occurrences of YOUR_DOMAIN with your actual domain

# Enable the site
sudo ln -s /etc/nginx/sites-available/farmcontrol /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx


## ─────────────────────────────────────────
## STEP 8 — Start the backend with PM2
## ─────────────────────────────────────────

cd ~/farm-automation/backend
pm2 start server.js --name farmcontrol
pm2 save
pm2 startup
# Run the command it gives you (sudo env PATH=... pm2 startup ...)

# Check it's running:
pm2 status
pm2 logs farmcontrol


## ─────────────────────────────────────────
## STEP 9 — Oracle Firewall (Security List)
## ─────────────────────────────────────────

# In Oracle Cloud Console → Networking → VCN → Security Lists
# Add these INGRESS rules:
#   Port 22   - TCP - SSH (already open)
#   Port 80   - TCP - HTTP (for redirect + certbot)
#   Port 443  - TCP - HTTPS (web app)
#   Port 8883 - TCP - MQTT TLS (ESP32)
#   Port 9001 - TCP - MQTT WSS (browser)

# Also open in Ubuntu firewall:
sudo iptables -I INPUT -p tcp --dport 443  -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8883 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 9001 -j ACCEPT
sudo apt install -y iptables-persistent
sudo netfilter-persistent save


## ─────────────────────────────────────────
## STEP 10 — Test everything
## ─────────────────────────────────────────

# Test HTTPS
curl https://myfarm.duckdns.org/api/health

# Test MQTT connection from broker machine
mosquitto_pub -h localhost -p 1883 \
  -u farmuser -P yourpassword \
  -t "farm/TEST-DEVICE-001/status" \
  -m '{"online":true,"firmware":"1.0.0"}'

# Open the web app
# https://myfarm.duckdns.org
# Login: admin@yourdomain.com / your-admin-password


## ─────────────────────────────────────────
## MQTT TOPIC REFERENCE (for firmware dev)
## ─────────────────────────────────────────
#
# OUTBOUND (server → ESP32, subscribe these on ESP32):
#   farm/{device_uid}/config/pins          → Pin configuration JSON
#   farm/{device_uid}/schedule/irrigation  → Irrigation schedules JSON
#   farm/{device_uid}/schedule/fertigation → Fertigation schedules JSON
#
# INBOUND (ESP32 → server, publish these from ESP32):
#   farm/{device_uid}/status    → {"online":true, "firmware":"1.0.0"}
#   farm/{device_uid}/notify    → {"type":"irrigation_start","message":"Valve 1 opened"}
#   farm/{device_uid}/sensors   → {"temperature":28.5,"humidity":72,"soil_moisture":45}
#
# Notification types for ESP32 to publish:
#   irrigation_start, irrigation_end
#   fertigation_start, fertigation_end
#   alert, info
#
# All outbound topics use retain=true so ESP32 gets latest config on reconnect


## ─────────────────────────────────────────
## USEFUL PM2 COMMANDS
## ─────────────────────────────────────────
# pm2 status              - check app status
# pm2 logs farmcontrol    - view logs
# pm2 restart farmcontrol - restart app
# pm2 stop farmcontrol    - stop app

## USEFUL MOSQUITTO COMMANDS
# sudo systemctl status mosquitto
# sudo journalctl -u mosquitto -f   - live logs
# mosquitto_sub -h localhost -p 1883 -u farmuser -P pass -t "farm/#" -v
