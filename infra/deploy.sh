#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY_DIR="/opt/uni-market/source"
readonly COMPOSE_FILE="docker-compose.production.yml"
readonly ENV_FILE=".env.production"
readonly IMAGE_NAME="uni-market:production"
readonly ROLLBACK_IMAGE="uni-market:rollback"
readonly CONTAINER_NAME="uni-market"

sync_release_environment() {
  local values=("$@")
  local keys=(
    MSG91_WIDGET_ID MSG91_OTP_LENGTH MSG91_TOKEN_AUTH MSG91_AUTH_KEY
    SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_FROM_NAME SMTP_FROM_EMAIL
    DATA_ENCRYPTION_KEY CUSTOMER_CARE_EMAIL GRIEVANCE_EMAIL PRIVACY_EMAIL LEGAL_POLICY_VERSION
    EMAIL_PROVIDER_NAME EMAIL_PROVIDER_REGION DATABASE_REGION OBJECT_STORAGE_REGION LOG_REGION
    RETENTION_MODE GRIEVANCE_RETENTION_DAYS MONITORING_TOKEN
  )
  local env_temp

  [[ "${#values[@]}" -eq "${#keys[@]}" ]]
  [[ "${values[0]}" =~ ^[A-Za-z0-9_-]+$ ]]
  [[ "${values[1]}" =~ ^[4-8]$ ]]
  [[ "${values[2]}" =~ ^[A-Za-z0-9_-]+$ ]]
  [[ "${values[3]}" =~ ^[A-Za-z0-9_-]+$ ]]
  [[ "${values[5]}" =~ ^[0-9]+$ ]]
  [[ "${values[6]}" =~ ^(true|false)$ ]]
  [[ "${values[11]}" =~ ^[A-Fa-f0-9]{64}$ ]]
  [[ "${values[21]}" =~ ^(dry-run|enforce)$ ]]
  [[ "${values[22]}" =~ ^[0-9]+$ ]]
  [[ "${values[23]}" == disabled || "${values[23]}" =~ ^[A-Fa-f0-9]{64}$ ]]
  for value in "${values[@]}"; do
    [[ -n "$value" && "$value" != *$'\r'* && "$value" != *'#'* ]]
  done

  env_temp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  chmod 600 "$env_temp"
  # Remove retired legal-identity keys as well as the values replaced below.
  grep -Ev '^(DEV_MODE|MSG91_WIDGET_ID|MSG91_OTP_LENGTH|MSG91_TOKEN_AUTH|MSG91_AUTH_KEY|OTP_SERVICE_API_KEY|OTP_SERVICE_BASE_URL|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM_NAME|SMTP_FROM_EMAIL|DATA_ENCRYPTION_KEY|LEGAL_OPERATOR_NAME|LEGAL_OPERATOR_ADDRESS|LEGAL_JURISDICTION_CITY|CUSTOMER_CARE_EMAIL|GRIEVANCE_EMAIL|PRIVACY_EMAIL|LEGAL_POLICY_VERSION|EMAIL_PROVIDER_NAME|EMAIL_PROVIDER_REGION|DATABASE_REGION|OBJECT_STORAGE_REGION|LOG_REGION|RETENTION_MODE|GRIEVANCE_RETENTION_DAYS|MONITORING_TOKEN)=' "$ENV_FILE" > "$env_temp"
  printf 'DEV_MODE=false\n' >> "$env_temp"
  for index in "${!keys[@]}"; do
    if [[ "${keys[$index]}" == MONITORING_TOKEN && "${values[$index]}" == disabled ]]; then continue; fi
    printf '%s=%s\n' "${keys[$index]}" "${values[$index]}" >> "$env_temp"
  done
  mv "$env_temp" "$ENV_FILE"
}

exec 9>"/tmp/uni-market-deploy.lock"
if ! flock -n 9; then
  echo "A Uni Market deployment is already running"
  exit 1
fi

cd "$REPOSITORY_DIR"
test -s "$ENV_FILE"

if [[ "${SSH_ORIGINAL_COMMAND:-}" == deploy-with-release-env:* ]]; then
  encoded_release_environment="${SSH_ORIGINAL_COMMAND#deploy-with-release-env:}"
  [[ "$encoded_release_environment" =~ ^[A-Za-z0-9+/=]+$ ]]
  mapfile -t release_environment < <(printf '%s' "$encoded_release_environment" | base64 --decode)
  sync_release_environment "${release_environment[@]}"
fi

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
