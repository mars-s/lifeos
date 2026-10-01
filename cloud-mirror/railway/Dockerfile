FROM node:24-bookworm-slim
WORKDIR /app
COPY railway/runtime.mjs railway/sqlite.mjs railway/mirror.mjs ./
COPY railway/migrations ./migrations
ENV NODE_ENV=production LIFEOS_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "runtime.mjs"]
