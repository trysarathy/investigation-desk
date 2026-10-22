# Preview image: the demo workspace only (DEMO_MODE=1 turns uploads off). See README "Private preview".
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DEMO_MODE=1 AI_EXPLANATIONS=off PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# The demo workspace and cases are written here; reset on demand from Settings → Data.
RUN mkdir .data && chown node:node .data
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
