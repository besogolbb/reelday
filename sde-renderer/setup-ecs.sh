#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SDE ECS Fargate setup script — run once from the Easypanel terminal.
# Fills in all values below, then: bash sde-renderer/setup-ecs.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── FILL THESE IN ─────────────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID_VAL=""       # your R2 key (different from AWS key)
R2_SECRET_ACCESS_KEY_VAL=""
R2_BUCKET_NAME="reelday-uploads"
R2_PUBLIC_URL="https://media.reelday.ph"
WEBHOOK_SECRET=""             # same value as backend WEBHOOK_SECRET
OPENAI_API_KEY=""             # leave empty to skip voice over
# ─────────────────────────────────────────────────────────────────────────────

REGION="ap-southeast-1"
CLUSTER="reelday-cluster"
TASK_FAMILY="reelday-sde-renderer"
CONTAINER_NAME="sde-renderer"
LOG_GROUP="/ecs/reelday-sde-renderer"
WEBHOOK_URL="https://reelday.ph/api/webhooks/sde-ready"
APP_PUBLIC_HOST="reelday.ph"

export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION="$REGION"

echo ""
echo "=== SDE ECS Fargate Setup ==="
echo ""

# ── Account + ECR URI ─────────────────────────────────────────────────────────
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$TASK_FAMILY"
echo "Account: $ACCOUNT_ID"
echo "ECR URI: $ECR_URI"

# ── 1. CloudWatch log group ───────────────────────────────────────────────────
echo ""
echo "[1/8] Creating CloudWatch log group..."
aws logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null || echo "  already exists"
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 30

# ── 2. IAM execution role ─────────────────────────────────────────────────────
echo ""
echo "[2/8] Creating IAM task execution role..."
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "  already exists"

aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy \
  2>/dev/null || echo "  already attached"

EXEC_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/ecsTaskExecutionRole"

# ── 3. ECR repository ─────────────────────────────────────────────────────────
echo ""
echo "[3/8] Creating ECR repository..."
aws ecr create-repository --repository-name "$TASK_FAMILY" 2>/dev/null || echo "  already exists"

# ── 4. Build + push Docker image ──────────────────────────────────────────────
echo ""
echo "[4/8] Building and pushing Docker image (this takes ~5 min)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_URI"
docker build -t "$TASK_FAMILY" "$SCRIPT_DIR"
docker tag "$TASK_FAMILY:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"
echo "  pushed: $ECR_URI:latest"

# ── 5. ECS cluster ────────────────────────────────────────────────────────────
echo ""
echo "[5/8] Creating ECS cluster..."
aws ecs create-cluster --cluster-name "$CLUSTER" 2>/dev/null || echo "  already exists"

# ── 6. VPC + security group ───────────────────────────────────────────────────
echo ""
echo "[6/8] Setting up VPC and security group..."
VPC_ID=$(aws ec2 describe-vpcs --query 'Vpcs[0].VpcId' --output text)
echo "  VPC: $VPC_ID"

# Create security group (skip if exists)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=reelday-sde-renderer-sg" \
            "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --group-name reelday-sde-renderer-sg \
    --description "SDE renderer outbound only" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' \
    --output text)
  echo "  Created security group: $SG_ID"
else
  echo "  Security group already exists: $SG_ID"
fi

# Get public subnets
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
            "Name=map-public-ip-on-launch,Values=true" \
  --query 'Subnets[*].SubnetId' \
  --output text | tr '\t' ',')

if [ -z "$SUBNETS" ]; then
  # fallback: just grab first two subnets
  SUBNETS=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[:2].SubnetId' \
    --output text | tr '\t' ',')
fi
echo "  Subnets: $SUBNETS"

# ── 7. Task definition ────────────────────────────────────────────────────────
echo ""
echo "[7/8] Registering task definition..."

OPENAI_ENV=""
if [ -n "$OPENAI_API_KEY" ]; then
  OPENAI_ENV=',{"name":"OPENAI_API_KEY","value":"'"$OPENAI_API_KEY"'"}'
fi

aws ecs register-task-definition --cli-input-json "$(cat <<EOF
{
  "family": "$TASK_FAMILY",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "8192",
  "memory": "16384",
  "containerDefinitions": [{
    "name": "$CONTAINER_NAME",
    "image": "$ECR_URI:latest",
    "essential": true,
    "environment": [
      {"name":"R2_ACCOUNT_ID",        "value":"$R2_ACCOUNT_ID"},
      {"name":"R2_ACCESS_KEY_ID",     "value":"$R2_ACCESS_KEY_ID_VAL"},
      {"name":"R2_SECRET_ACCESS_KEY", "value":"$R2_SECRET_ACCESS_KEY_VAL"},
      {"name":"R2_BUCKET_NAME",       "value":"$R2_BUCKET_NAME"},
      {"name":"R2_PUBLIC_URL",        "value":"$R2_PUBLIC_URL"},
      {"name":"WEBHOOK_URL",          "value":"$WEBHOOK_URL"},
      {"name":"WEBHOOK_SECRET",       "value":"$WEBHOOK_SECRET"},
      {"name":"APP_PUBLIC_HOST",      "value":"$APP_PUBLIC_HOST"}
      $OPENAI_ENV
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group":         "$LOG_GROUP",
        "awslogs-region":        "$REGION",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
EOF
)"
echo "  Task definition registered."

# ── 8. Print backend env vars ─────────────────────────────────────────────────
echo ""
echo "[8/8] Done! Add these to your Easypanel backend env vars:"
echo ""
echo "  SDE_ECS_CLUSTER=$CLUSTER"
echo "  SDE_TASK_DEF=$TASK_FAMILY"
echo "  SDE_ECS_SUBNETS=$SUBNETS"
echo "  SDE_ECS_SECURITY_GROUP=$SG_ID"
if [ -n "$OPENAI_API_KEY" ]; then
  echo "  OPENAI_API_KEY=$OPENAI_API_KEY"
fi
echo ""
echo "Then restart the backend and trigger a test render."
