FROM node:22-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY CHANGELOG.md ./
COPY docs ./docs
WORKDIR /repo/docs
ENV CI=true
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm install --prod --frozen-lockfile

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/docs/build ./build
COPY --from=build /repo/docs/package.json ./package.json
COPY --from=build /repo/docs/node_modules ./node_modules
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "build"]
