# Kế hoạch triển khai dự án Livestream lên VPS sử dụng CI/CD

## 📋 Tổng quan dự án

Dự án của bạn bao gồm các thành phần chính:

1. **Backend**: Spring Boot 3.2.0 (Java 17) - Port 8080, Context Path: `/api`
2. **Frontend**: React 18 + TypeScript (build với Vite) - Port 3000 (Nginx trong container)
3. **Database**: PostgreSQL 15
4. **Cache**: Redis 7
5. **Streaming Server**: SRS (Simple Realtime Server) v6 - Port 1935 (RTMP)
6. **Web Server**: Nginx (reverse proxy) - Port 80/443
7. **HLS Server**: Nginx - Port 8081

## 🏗️ Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────┐
│                    Internet Users                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │   Nginx (Port 80/443)  │  ← SSL/TLS Termination
         │   Reverse Proxy       │
         └───┬───────────┬───────┘
             │           │
    ┌────────┘           └────────┐
    │                            │
    ▼                            ▼
┌──────────┐            ┌──────────────┐
│ Frontend │            │   Backend    │
│ :3000    │            │   :8080      │
└──────────┘            └───┬──────┬───┘
                            │      │
                    ┌───────┘      └───────┐
                    │                      │
                    ▼                      ▼
            ┌──────────────┐      ┌──────────────┐
            │  PostgreSQL  │      │    Redis     │
            │   :5432      │      │   :6379      │
            └──────────────┘      └──────────────┘
                     
                     ▼
            ┌──────────────┐
            │     SRS      │  ← RTMP Stream Input
            │   :1935      │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │  HLS Server  │  ← HLS Stream Output
            │   :8081      │
            └──────────────┘
```

## 📦 Cấu trúc thư mục trên VPS

```
/var/www/livestream/
├── .env                          # Biến môi trường
├── docker-compose.prod.yml       # Docker Compose config
├── srs.conf                      # SRS streaming config
└── nginx-hls.conf                # Nginx HLS server config
```

## 🔑 Thông tin quan trọng

- **VPS IP**: `76.13.212.30`
- **Domain**: `gachoichu5.com`
- **GitHub Repository**: Cần thay `YOUR_USERNAME` trong các lệnh
- **Docker Registry**: `ghcr.io/YOUR_USERNAME/livestream`

## ⚠️ BƯỚC 0: XÓA HẾT DỮ LIỆU CŨ VÀ CHUẨN BỊ LẠI TỪ ĐẦU

**QUAN TRỌNG**: Thực hiện các bước sau để xóa sạch mọi dữ liệu cũ trước khi setup lại:

```bash
# Kết nối SSH vào server
ssh root@76.13.212.30

# 1. Dừng tất cả các container đang chạy
cd /var/www/livestream
docker-compose -f docker-compose.prod.yml down -v 2>/dev/null || true

# 2. Xóa tất cả các container liên quan đến livestream
docker ps -a | grep livestream | awk '{print $1}' | xargs -r docker rm -f

# 3. Xóa tất cả các image liên quan đến livestream
docker images | grep livestream | awk '{print $3}' | xargs -r docker rmi -f
docker images | grep ghcr.io | awk '{print $3}' | xargs -r docker rmi -f

# 4. Xóa tất cả các volume liên quan đến livestream
docker volume ls | grep livestream | awk '{print $2}' | xargs -r docker volume rm
docker volume ls | grep postgres_data | awk '{print $2}' | xargs -r docker volume rm
docker volume ls | grep redis_data | awk '{print $2}' | xargs -r docker volume rm
docker volume ls | grep srs_data | awk '{print $2}' | xargs -r docker volume rm
docker volume ls | grep recordings_data | awk '{print $2}' | xargs -r docker volume rm
docker volume ls | grep videos_data | awk '{print $2}' | xargs -r docker volume rm

# 5. Xóa tất cả các network liên quan
docker network ls | grep livestream | awk '{print $1}' | xargs -r docker network rm

# 6. Dọn dẹp toàn bộ (cẩn thận - lệnh này xóa TẤT CẢ unused resources)
docker system prune -a --volumes -f

# 7. Xóa thư mục dự án cũ (nếu muốn bắt đầu hoàn toàn mới)
# CẢNH BÁO: Lệnh này sẽ xóa TẤT CẢ file trong /var/www/livestream
rm -rf /var/www/livestream/*

# 8. Tạo lại thư mục dự án
mkdir -p /var/www/livestream
cd /var/www/livestream
```

## Bước 1: Chuẩn bị server VPS

```bash
# Kết nối SSH vào server
ssh root@76.13.212.30

# Cập nhật hệ thống
apt update && apt upgrade -y

# Cài đặt các công cụ cần thiết


apt install -y git docker.io docker-compose nginx certbot python3-certbot-nginx ufw

# Cấu hình tường lửa
ufw allow ssh
ufw allow http
ufw allow https
ufw allow 1935/tcp  # RTMP port
ufw enable
```

## Bước 2: Cấu hình domain và SSL

```bash
# Cấu hình Nginx
cat > /etc/nginx/sites-available/gachoichu5.com << 'EOF'
server {
    listen 80;
    server_name gachoichu5.com www.gachoichu5.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /api {
        proxy_pass http://localhost:8080/api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /ws {
        proxy_pass http://localhost:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    
    location /live {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control no-cache;
    }
    
    location /videos {
        proxy_pass http://localhost:8081/videos;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=3600";
        add_header Access-Control-Allow-Origin *;
    }
}
EOF

# Kích hoạt cấu hình
ln -sf /etc/nginx/sites-available/gachoichu5.com /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

# Cài đặt SSL với Let's Encrypt
certbot --nginx -d gachoichu5.com -d www.gachoichu5.com --non-interactive --agree-tos --email caoleanhcuong78@gmail.com
```

## Bước 3: Thiết lập CI/CD với GitHub Actions

1. Tạo thư mục dự án trên server:

```bash
mkdir -p /var/www/livestream
cd /var/www/livestream
```

2. Tạo file `.env` cho các biến môi trường:

```bash
cat > .env << 'EOL'
# Database
POSTGRES_DB=livestream_db
POSTGRES_USER=livestream_user
POSTGRES_PASSWORD=livestream_pass

# Backend
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/livestream_db
SPRING_DATASOURCE_USERNAME=livestream_user
SPRING_DATASOURCE_PASSWORD=livestream_pass
SPRING_REDIS_HOST=redis
SPRING_REDIS_PORT=6379
SPRING_REDIS_PASSWORD=
JWT_SECRET=3P0wg+kpO4PDbSP/DtcuFouxOjpKcCkVs5X1sbo8hXArKrsMURsN9FvSOIrokjlgGYDg3N8S0HoG4R9CesRQBA==
JWT_EXPIRATION=86400000
JWT_REFRESH_EXPIRATION=604800000
CORS_ALLOWED_ORIGINS=https://gachoichu5.com

# Stream Configuration
STREAM_RTMP_URL=rtmp://srs:1935/live
STREAM_HLS_BASE_URL=https://gachoichu5.com

# Recording Configuration
RECORDING_BASE_PATH=/recordings
RECORDING_OUTPUT_PATH=/videos
RECORDING_VIDEO_URL_BASE=https://gachoichu5.com/videos
RECORDING_THUMBNAIL_URL_BASE=https://gachoichu5.com/videos/thumbnails
RECORDING_RETENTION_DAYS=3

# Frontend Build Args 
VITE_API_URL=https://gachoichu5.com/api
VITE_WS_URL=wss://gachoichu5.com/ws/chat
VITE_HLS_BASE_URL=https://gachoichu5.com/live
EOL
```

3. Tạo file `docker-compose.prod.yml`:

```bash
cat > docker-compose.prod.yml << 'EOL'
services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: livestream-postgres
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - livestream-network
    restart: always

  # Redis
  redis:
    image: redis:7-alpine
    container_name: livestream-redis
    volumes:
      - redis_data:/data
    networks:
      - livestream-network
    restart: always

  # RTMP Server (SRS - Simple Realtime Server) v6
  srs:
    image: ossrs/srs:6
    container_name: livestream-srs
    ports:
      - "1935:1935" # RTMP
    volumes:
      - ./srs.conf:/usr/local/srs/conf/srs.conf
      - srs_data:/usr/local/srs/objs/nginx/html
      - recordings_data:/usr/local/srs/objs/nginx/html/recordings
      - videos_data:/usr/local/srs/objs/nginx/html/videos
    networks:
      - livestream-network
    command: ./objs/srs -c conf/srs.conf
    restart: always

  # Spring Boot Backend
  backend:
    image: ${DOCKER_REGISTRY}/livestream-backend:${TAG}
    container_name: livestream-backend
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: ${SPRING_DATASOURCE_URL}
      SPRING_DATASOURCE_USERNAME: ${SPRING_DATASOURCE_USERNAME}
      SPRING_DATASOURCE_PASSWORD: ${SPRING_DATASOURCE_PASSWORD}
      SPRING_REDIS_HOST: ${SPRING_REDIS_HOST}
      SPRING_REDIS_PORT: ${SPRING_REDIS_PORT}
      SPRING_REDIS_PASSWORD: ${SPRING_REDIS_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRATION: ${JWT_EXPIRATION}
      JWT_REFRESH_EXPIRATION: ${JWT_REFRESH_EXPIRATION}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
      STREAM_RTMP_URL: ${STREAM_RTMP_URL}
      STREAM_HLS_BASE_URL: ${STREAM_HLS_BASE_URL}
      RECORDING_BASE_PATH: ${RECORDING_BASE_PATH}
      RECORDING_OUTPUT_PATH: ${RECORDING_OUTPUT_PATH}
      RECORDING_VIDEO_URL_BASE: ${RECORDING_VIDEO_URL_BASE}
      RECORDING_THUMBNAIL_URL_BASE: ${RECORDING_THUMBNAIL_URL_BASE}
      RECORDING_RETENTION_DAYS: ${RECORDING_RETENTION_DAYS}
    volumes:
      - recordings_data:/recordings
      - videos_data:/videos
    depends_on:
      - postgres
      - redis
    networks:
      - livestream-network
    restart: always

  # React Frontend
  frontend:
    image: ${DOCKER_REGISTRY}/livestream-frontend:${TAG}
    container_name: livestream-frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks:
      - livestream-network
    restart: always

  # Nginx for HLS streaming and video playback
  hls:
    image: nginx:alpine
    container_name: livestream-hls
    ports:
      - "8081:80"
    volumes:
      - srs_data:/usr/share/nginx/html
      - videos_data:/usr/share/nginx/html/videos
      - ./nginx-hls.conf:/etc/nginx/conf.d/default.conf
    networks:
      - livestream-network
    restart: always

volumes:
  postgres_data:
  redis_data:
  srs_data:
  recordings_data:
  videos_data:

networks:
  livestream-network:
    driver: bridge
EOL
```

4. Tạo file cấu hình Nginx cho HLS:

```bash
cat > nginx-hls.conf << 'EOL'
server {
    listen 80;
    
    # HLS live streaming
    location /live {
        root /usr/share/nginx/html;
        add_header Cache-Control no-cache always;
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Range" always;
        
        # CORS preflight
        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods 'GET, OPTIONS' always;
            add_header Access-Control-Allow-Headers 'Range' always;
            add_header Access-Control-Max-Age 1728000 always;
            add_header Content-Type 'text/plain charset=UTF-8' always;
            add_header Content-Length 0 always;
            return 204;
        }
        
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
    }
    
    # Video recordings for replay
    location /videos/ {
        alias /usr/share/nginx/html/videos/;
        add_header Cache-Control "public, max-age=86400" always;
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "*" always;
        
        # Enable range requests for video seeking
        add_header Accept-Ranges bytes always;
        
        # MIME types for video files
        types {
            video/mp4 mp4;
            video/x-flv flv;
            image/jpeg jpg jpeg;
            image/png png;
        }
    }
    
    # Thumbnails
    location /videos/thumbnails/ {
        alias /usr/share/nginx/html/videos/thumbnails/;
        add_header Cache-Control "public, max-age=86400" always;
        add_header Access-Control-Allow-Origin * always;
    }
}
EOL
```

5. Tạo file cấu hình SRS:

```bash
cat > srs.conf << 'EOL'
# SRS Configuration for Live Streaming

listen              1935;
max_connections     1000;
daemon              off;
srs_log_tank        console;

http_server {
    enabled         on;
    listen          8080;
    dir             ./objs/nginx/html;
    crossdomain     on;
}

http_api {
    enabled         on;
    listen          1985;
    crossdomain     on;
}

stats {
    network         0;
}

vhost __defaultVhost__ {
    # HLS Configuration - Optimized for low latency
    hls {
        enabled         on;
        hls_path        ./objs/nginx/html;
        hls_fragment    1;
        hls_window      6;
        hls_cleanup     on;
        hls_dispose     3;
        hls_wait_keyframe on;
        hls_m3u8_file   [app]/[stream]/index.m3u8;
        hls_ts_file     [app]/[stream]/[stream]-[seq].ts;
    }
    
    # HTTP Callbacks
    http_hooks {
        enabled         on;
        on_publish      http://backend:8080/api/stream/callback/publish;
        on_unpublish    http://backend:8080/api/stream/callback/unpublish;
        on_play         http://backend:8080/api/stream/callback/play;
        on_stop         http://backend:8080/api/stream/callback/stop;
        on_dvr          http://backend:8080/api/recordings/callback/dvr;
    }
}
EOL
```

## Bước 4: Thiết lập GitHub Actions

**LƯU Ý**: File `deploy.yml` đã có sẵn trong repository tại `.github/workflows/deploy.yml`. 

Kiểm tra và đảm bảo các thông tin sau đúng:

1. **Repository name**: Đảm bảo `${{ github.repository }}` trỏ đúng repository của bạn
2. **VPS IP**: Hiện tại là `76.13.212.30` (đã được cấu hình trong deploy.yml)
3. **Secrets cần thiết**:
   - `TOKEN`: GitHub Personal Access Token với quyền `write:packages`
   - `SSH_PRIVATE_KEY`: Private SSH key để kết nối VPS

Nếu cần tạo mới, file `deploy.yml` sẽ có nội dung:

```yaml
name: Deploy Livestream Platform

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.TOKEN }}

      - name: Build Backend
        run: |
          cd livestream-backend
          mvn clean package -DskipTests

      - name: Build Frontend
        run: |
          cd livestream-frontend
          npm install
          npm run build

      - name: Build and Push Backend Docker Image
        uses: docker/build-push-action@v4
        with:
          context: ./livestream-backend
          push: true
          tags: ghcr.io/${{ github.repository }}/livestream-backend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and Push Frontend Docker Image
        uses: docker/build-push-action@v4
        with:
          context: ./livestream-frontend
          push: true
          tags: ghcr.io/${{ github.repository }}/livestream-frontend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            VITE_API_URL=https://gachoichu5.com/api
            VITE_WS_URL=wss://gachoichu5.com/ws/chat
            VITE_HLS_BASE_URL=https://gachoichu5.com/live

      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: 76.13.212.30
          username: root
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /var/www/livestream

            # Login to GitHub Container Registry (for private repo)
            echo "${{ secrets.TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin

            # Set environment variables for docker-compose
            export DOCKER_REGISTRY=ghcr.io/${{ github.repository }}
            export TAG=latest

            # Pull latest images
            docker-compose -f docker-compose.prod.yml pull
            
            # Restart services
            docker-compose -f docker-compose.prod.yml up -d

            # Clean up unused images
            docker image prune -af
```

## Bước 5: Thiết lập GitHub Secrets

1. **Tạo SSH Key Pair** (nếu chưa có):
```bash
# Trên máy local của bạn
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_deploy
# Không đặt passphrase để GitHub Actions có thể sử dụng

# Copy public key lên VPS
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub root@76.13.212.30



2. **Thêm Secrets vào GitHub Repository**:
   - Đi tới repository > **Settings** > **Secrets and variables** > **Actions**
   - Click **New repository secret**
   
   **Secret 1: SSH_PRIVATE_KEY**
   - Name: `SSH_PRIVATE_KEY`
   - Value: Nội dung file `~/.ssh/github_actions_deploy` (private key)
   ```bash
   cat ~/.ssh/github_actions_deploy
   ```
   
   **Secret 2: TOKEN**
   - Name: `TOKEN`
   - Value: GitHub Personal Access Token
   - Tạo token tại: https://github.com/settings/tokens
   - Quyền cần thiết: `write:packages`, `read:packages`

## Bước 6: Push code và chờ GitHub Actions deploy

```bash
# Trên máy local
git add .
git commit -m "Setup production deployment"
git push origin main

# Sau đó theo dõi GitHub Actions tại:
# https://github.com/YOUR_USERNAME/livestream/actions
``` 



## Bước 7: Khởi động dịch vụ lần đầu trên server (nếu deploy thủ công)

**LƯU Ý**: Nếu đã setup GitHub Actions, bước này sẽ được tự động thực hiện. Chỉ cần chạy thủ công nếu:
- GitHub Actions chưa chạy xong
- Hoặc muốn test trước khi push code

```bash
# SSH vào VPS
ssh root@76.13.212.30

cd /var/www/livestream

# Load biến môi trường từ file .env
set -a
source .env
set +a

# Set biến cho docker-compose
export DOCKER_REGISTRY=ghcr.io/cuong78/livestreamchu5  # Thay YOUR_USERNAME bằng username GitHub của bạn
export TAG=latest

# Login vào GitHub Container Registry (nếu repo private)
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull và khởi động services
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Kiểm tra logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Bước 8: Kiểm tra và giám sát

1. Kiểm tra trạng thái các container:

```bash
docker ps
```

2. Xem logs:

```bash
# Xem logs của tất cả các container
docker-compose -f docker-compose.prod.yml logs

# Xem logs của một container cụ thể
docker logs livestream-backend -f
```

3. Kiểm tra website:
   - Truy cập https://gachoichu5.com
   - Kiểm tra API: https://gachoichu5.com/api/swagger-ui.html
   - Kiểm tra health: https://gachoichu5.com/api/actuator/health

4. Kiểm tra các service:
```bash
# Kiểm tra container đang chạy
docker ps

# Kiểm tra logs của từng service
docker logs livestream-backend -f
docker logs livestream-frontend -f
docker logs livestream-postgres -f
docker logs livestream-redis -f
docker logs livestream-srs -f
docker logs livestream-hls -f

# Kiểm tra network
docker network inspect livestream-network

# Kiểm tra volumes
docker volume ls | grep livestream
```

5. Troubleshooting:
```bash
# Nếu backend không kết nối được database
docker exec -it livestream-backend sh
# Kiểm tra biến môi trường: env | grep SPRING

# Nếu frontend không load được
docker exec -it livestream-frontend sh
# Kiểm tra file build: ls -la /usr/share/nginx/html

# Nếu SRS không stream được
docker logs livestream-srs
# Kiểm tra cấu hình: docker exec -it livestream-srs cat /usr/local/srs/conf/srs.conf
```

## Tổng kết cấu hình

### Ports được sử dụng:
- **80/443**: Nginx reverse proxy (SSL)
- **3000**: Frontend container (mapped từ port 80 trong container)
- **8080**: Backend API
- **8081**: HLS streaming server
- **1935**: RTMP streaming (SRS)
- **5432**: PostgreSQL (internal, không expose ra ngoài)
- **6379**: Redis (internal, không expose ra ngoài)

### Volumes:
- `postgres_data`: Database data
- `redis_data`: Redis data
- `srs_data`: HLS streaming files
- `recordings_data`: Raw recording files
- `videos_data`: Processed video files và thumbnails

### Environment Variables quan trọng:
- `DOCKER_REGISTRY`: GitHub Container Registry URL
- `TAG`: Docker image tag (thường là `latest`)
- Tất cả các biến khác được định nghĩa trong file `.env`


