FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data /data && chown node:node /app/data /data
EXPOSE 3000
VOLUME ["/data"]
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
