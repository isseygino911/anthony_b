# node:20-slim (Debian/glibc), not alpine: bcrypt is a native addon built
# via node-pre-gyp, and glibc prebuilt binaries for it are reliably
# published upstream. Alpine (musl) commonly falls back to compiling from
# source, which would require adding python3/make/g++ to the image just to
# install dependencies. Node 20 matches local dev — package.json has no
# `engines` field pinning a version, so we pin it here instead.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4002

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
