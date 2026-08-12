FROM node:22.14.0-alpine AS base

ARG NPM_VERSION=11.1.0
WORKDIR /app

RUN npm install -g npm@${NPM_VERSION}
COPY package*.json ./
RUN npm ci

COPY prisma.config.js ./
COPY prisma ./prisma
RUN npm run db:generate

COPY tsconfig.json ./
COPY index.ts ./
COPY src ./src

FROM base AS build

RUN npm run build

FROM node:22.14.0-alpine AS production-deps

ARG NPM_VERSION=11.1.0
WORKDIR /app
RUN npm install -g npm@${NPM_VERSION}
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma.config.js ./
COPY prisma ./prisma
RUN npm run db:generate

FROM node:22.14.0-alpine AS dev

ARG NPM_VERSION=11.1.0
WORKDIR /app
ENV NODE_ENV=development
RUN npm install -g npm@${NPM_VERSION}
COPY --from=base /app ./
EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM node:22.14.0-alpine AS production

ARG NPM_VERSION=11.1.0
ARG OCI_SOURCE=""
ARG OCI_REVISION=""
ARG OCI_CREATED=""
ARG OCI_VERSION=""

LABEL org.opencontainers.image.source=$OCI_SOURCE \
  org.opencontainers.image.revision=$OCI_REVISION \
  org.opencontainers.image.created=$OCI_CREATED \
  org.opencontainers.image.version=$OCI_VERSION

WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g npm@${NPM_VERSION}

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/package*.json ./
COPY --from=production-deps /app/prisma.config.js ./
COPY --from=production-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/docs/openapi ./src/docs/openapi
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
