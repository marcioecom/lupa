FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- runtime ---
FROM node:22-alpine AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY drizzle.config.ts ./
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3000

EXPOSE 3000

USER node

CMD ["pnpm", "start"]
