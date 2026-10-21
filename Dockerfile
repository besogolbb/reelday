FROM node:26-alpine

# ffmpeg powers the server-side video transcode pipeline
# (backend/lib/videoTranscode.js). Without it, video uploads still
# work but the wall has to play the original full-resolution clip.
# Alpine's ffmpeg package is ~70 MB compared to apt's 150 MB, but
# functionally identical for H.264 + AAC + faststart muxing.
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/

EXPOSE 3000

CMD ["node", "backend/server.js"]
