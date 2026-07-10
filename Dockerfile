FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npm run db:generate

COPY tsconfig.json ./
COPY index.ts ./
COPY src ./src

FROM base AS dev

ENV NODE_ENV=development
EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM base AS build

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/docs/openapi ./src/docs/openapi

EXPOSE 8080
CMD ["node", "dist/index.js"]
