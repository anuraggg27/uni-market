#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY_DIR="/opt/uni-market/source"
readonly COMPOSE_FILE="docker-compose.production.yml"
readonly ENV_FILE=".env.production"
readonly IMAGE_NAME="uni-market:production"
readonly ROLLBACK_IMAGE="uni-market:rollback"
readonly CONTAINER_NAME="uni-market"

exec 9>"/tmp/uni-market-deploy.lock"
if ! flock -n 9; then
  echo "A Uni Market deployment is already running"
  exit 1
fi

cd "$REPOSITORY_DIR"
test -s "$ENV_FILE"

git fetch --prune origin main
git checkout main
git merge --ff-only origin/main

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

previous_image="$(docker image inspect "$IMAGE_NAME" --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$previous_image" ]]; then
  docker tag "$previous_image" "$ROLLBACK_IMAGE"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build app

healthy=false
for _ in {1..24}; do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)" == "healthy" ]]; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != "true" ]]; then
  docker logs --tail 100 "$CONTAINER_NAME" || true
  failed_image="$(docker image inspect "$IMAGE_NAME" --format '{{.Id}}' 2>/dev/null || true)"
  if [[ -n "$previous_image" ]]; then
    docker tag "$previous_image" "$IMAGE_NAME"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build app
  fi
  if [[ -n "$failed_image" && "$failed_image" != "$previous_image" ]]; then
    docker image rm "$failed_image" >/dev/null 2>&1 || true
  fi
  docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
  echo "Deployment failed its health check; the previous image was restored"
  exit 1
fi

current_image="$(docker image inspect "$IMAGE_NAME" --format '{{.Id}}')"
docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
if [[ -n "$previous_image" && "$previous_image" != "$current_image" ]]; then
  docker image rm "$previous_image" >/dev/null 2>&1 || true
fi

# Remove only unused build cache older than seven days. Never prune containers,
# volumes, or images owned by the other applications on this shared droplet.
docker builder prune --force --filter "until=168h" >/dev/null

curl --fail --silent --show-error http://127.0.0.1:3020/health
docker inspect --format 'image={{.Image}} health={{.State.Health.Status}} restarts={{.RestartCount}}' "$CONTAINER_NAME"
df -h / | tail -n 1
