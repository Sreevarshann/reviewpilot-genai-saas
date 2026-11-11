FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG REVIEWPILOT_API_ORIGIN=http://api:8113
ENV REVIEWPILOT_API_ORIGIN=$REVIEWPILOT_API_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3103
CMD ["npx", "next", "start", "--port", "3103", "--hostname", "0.0.0.0"]
