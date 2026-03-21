FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM alpine:3.20
COPY --from=builder /app/dist /app/dist

# Copy built files to the shared volume on startup
CMD ["cp", "-r", "/app/dist/.", "/app/output/"]
