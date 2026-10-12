# Single image: Angular build served by the Fastify API (one origin, no CORS).
# Built by the hosting platform (Render, Railway, Fly.io…); Docker isn't needed locally.

FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/web/dist/web/browser \
    TRUST_PROXY=true
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
# Bake the embedding model into the image so a cold start doesn't download ~100 MB.
RUN node -e "import('./src/services/embeddings.ts').then((m) => m.warmup())"
COPY --from=web /app/web/dist/web/browser /app/web/dist/web/browser

# Registry, uploaded PDFs and local vectors: mount a persistent volume here.
VOLUME /data
EXPOSE 3000
# Node 24 runs the TypeScript sources directly (tsconfig enforces erasableSyntaxOnly).
CMD ["node", "src/server.ts"]
