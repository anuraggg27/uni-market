FROM node:22-bookworm-slim AS node
FROM postgres:18-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /workspace
ENTRYPOINT ["node", "infra/operations/backup.mjs"]
