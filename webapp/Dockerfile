# Lightweight dashboard service. Uses Node's built-in SQLite (node:sqlite),
# so no native module compilation is required.
FROM node:22-alpine

# docker CLI is needed inside this container only when WORKER_MODE=docker,
# so this service can launch sibling bbb-mp4-worker containers via the
# mounted host Docker socket (docker-outside-of-docker pattern).
RUN apk add --no-cache docker-cli

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
