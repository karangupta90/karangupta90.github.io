# FSBS Operations — single-container deploy. No npm install needed (zero dependencies).
FROM node:22-slim
WORKDIR /app
COPY . .
ENV TZ=America/Toronto
ENV FSBS_DATA_DIR=/data
EXPOSE 3000
# /data must be a mounted persistent volume (SQLite db + uploaded files live there)
CMD ["node", "server.js"]
