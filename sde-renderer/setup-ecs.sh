#!/usr/bin/env bash
# Run from the Easypanel terminal — reads all credentials from server env vars.
# No values to fill in: bash sde-renderer/setup-ecs.sh
set -euo pipefail

REGION="ap-southeast-1"
CLUSTER="reelday-cluster"
TASK_FAMILY="reelday-sde-renderer"
CONTAINER_NAME="sde-renderer"
LOG_GROUP="/ecs/reelday-sde-renderer"
WEBHOOK_URL="https://reelday.ph/api/webhooks/sde-ready"
APP_PUBLIC_HOST="reelday.ph"

REQUIRED=(AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_URL WEBHOOK_SECRET)
MISSING=()
for VAR in "${REQUIRED[@]}"; do [ -z "${!VAR:-}" ] && MISSING+=("$VAR"); done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: missing env vars:"; for V in "${MISSING[@]}"; do echo "  $V"; done; exit 1
fi

export AWS_DEFAULT_REGION="$REGION"
echo ""; echo "=== SDE ECS Fargate Setup ==="

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$TASK_FAMILY"
echo "Account: $ACCOUNT_ID | ECR: $ECR_URI"

echo ""; echo "[1/8] CloudWatch log group..."
aws logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null || echo "  exists"
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 30

echo ""; echo "[2/8] IAM role..."
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  2>/dev/null || echo "  exists"
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy 2>/dev/null || echo "  attached"
EXEC_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/ecsTaskExecutionRole"

echo ""; echo "[3/8] ECR repo..."
aws ecr create-repository --repository-name "$TASK_FAMILY" 2>/dev/null || echo "  exists"

echo ""; echo "[4/8] Docker build + push (~5 min)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"
docker build -t "$TASK_FAMILY" "$SCRIPT_DIR"
docker tag "$TASK_FAMILY:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"

echo ""; echo "[5/8] ECS cluster..."
aws ecs create-cluster --cluster-name "$CLUSTER" 2>/dev/null || echo "  exists"

echo ""; echo "[6/8] VPC + security group..."
VPC_ID=$(aws ec2 describe-vpcs --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=reelday-sde-renderer-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name reelday-sde-renderer-sg \
    --description "SDE renderer outbound only" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
fi
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=map-public-ip-on-launch,Values=true" \
  --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')
[ -z "$SUBNETS" ] && SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[:2].SubnetId' --output text | tr '\t' ',')
echo "  SG=$SG_ID  Subnets=$SUBNETS"

echo ""; echo "[7/8] Task definition..."
OPENAI_ENV=""
[ -n "${OPENAI_API_KEY:-}" ] && OPENAI_ENV=',{"name":"OPENAI_API_KEY","value":"'"$OPENAI_API_KEY"'"}'

aws ecs register-task-definition --cli-input-json "{
  \"family\": \"$TASK_FAMILY\",
  \"executionRoleArn\": \"$EXEC_ROLE_ARN\",
  \"networkMode\": \"awsvpc\",
  \"requiresCompatibilities\": [\"FARGATE\"],
  \"cpu\": \"16384\",
  \"memory\": \"65536\",
  \"containerDefinitions\": [{
    \"name\": \"$CONTAINER_NAME\",
    \"image\": \"$ECR_URI:latest\",
    \"essential\": true,
    \"environment\": [
      {\"name\":\"R2_ACCOUNT_ID\",        \"value\":\"$R2_ACCOUNT_ID\"},
      {\"name\":\"R2_ACCESS_KEY_ID\",     \"value\":\"$R2_ACCESS_KEY_ID\"},
      {\"name\":\"R2_SECRET_ACCESS_KEY\", \"value\":\"$R2_SECRET_ACCESS_KEY\"},
      {\"name\":\"R2_BUCKET_NAME\",       \"value\":\"$R2_BUCKET_NAME\"},
      {\"name\":\"R2_PUBLIC_URL\",        \"value\":\"$R2_PUBLIC_URL\"},
      {\"name\":\"WEBHOOK_URL\",          \"value\":\"$WEBHOOK_URL\"},
      {\"name\":\"WEBHOOK_SECRET\",       \"value\":\"$WEBHOOK_SECRET\"},
      {\"name\":\"APP_PUBLIC_HOST\",      \"value\":\"$APP_PUBLIC_HOST\"}
      $OPENAI_ENV
    ],
    \"logConfiguration\": {
      \"logDriver\": \"awslogs\",
      \"options\": {
        \"awslogs-group\": \"$LOG_GROUP\",
        \"awslogs-region\": \"$REGION\",
        \"awslogs-stream-prefix\": \"ecs\"
      }
    }
  }]
}"

echo ""; echo "======================================================="
echo "[8/8] Done! Add these to Easypanel backend env vars:"
echo "======================================================="
echo "SDE_ECS_CLUSTER=$CLUSTER"
echo "SDE_TASK_DEF=$TASK_FAMILY"
echo "SDE_ECS_SUBNETS=$SUBNETS"
echo "SDE_ECS_SECURITY_GROUP=$SG_ID"
echo ""; echo "Restart backend then trigger a test render."
