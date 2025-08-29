#!/usr/bin/env bash
# Bootstrap PoliTopics resources on LocalStack using AWS CLI (no awslocal).
# Fixed names:
#   - DynamoDB: politopics-article, politopics-keywords, politopics-participants
#   - S3: politopics-error-logs  (logs for success/error)
# Safe to re-run.

set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-northeast-3}"
ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$AWS_REGION"

# (WSL) Avoid /mnt/c/... shadowing
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/c/' | paste -sd:)"

echo "== PoliTopics Local Bootstrap =="
echo "Region:    $AWS_REGION"
echo "Endpoint:  $ENDPOINT"
echo

# --- Articles table (id HASH, GSI on date) ---
echo "Creating DynamoDB table 'politopics-article'..."
aws --endpoint-url "$ENDPOINT" dynamodb create-table \
  --table-name politopics-article \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=date,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    'IndexName=DateIndex,KeySchema=[{AttributeName=date,KeyType=HASH}],Projection={ProjectionType=ALL}' \
  >/dev/null 2>&1 || true

aws --endpoint-url "$ENDPOINT" dynamodb wait table-exists --table-name politopics-article

# --- Keywords link table (keyword HASH, dataId RANGE) ---
echo "Creating DynamoDB table 'politopics-keywords'..."
aws --endpoint-url "$ENDPOINT" dynamodb create-table \
  --table-name politopics-keywords \
  --attribute-definitions \
    AttributeName=keyword,AttributeType=S \
    AttributeName=dataId,AttributeType=S \
  --key-schema \
    AttributeName=keyword,KeyType=HASH \
    AttributeName=dataId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  >/dev/null 2>&1 || true

# --- Participants link table (participant HASH, dataId RANGE) ---
echo "Creating DynamoDB table 'politopics-participants'..."
aws --endpoint-url "$ENDPOINT" dynamodb create-table \
  --table-name politopics-participants \
  --attribute-definitions \
    AttributeName=participant,AttributeType=S \
    AttributeName=dataId,AttributeType=S \
  --key-schema \
    AttributeName=participant,KeyType=HASH \
    AttributeName=dataId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  >/dev/null 2>&1 || true

# --- S3 for logs ---
echo "Creating S3 bucket 'politopics-error-logs'..."
if aws --endpoint-url "$ENDPOINT" s3api create-bucket \
    --bucket politopics-error-logs \
    --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null 2>&1; then
  :
else
  aws --endpoint-url "$ENDPOINT" s3api create-bucket \
    --bucket politopics-error-logs >/dev/null 2>&1 || true
fi

echo "Enabling versioning on 'politopics-error-logs'..."
aws --endpoint-url "$ENDPOINT" s3api put-bucket-versioning \
  --bucket politopics-error-logs \
  --versioning-configuration Status=Enabled

echo "Done."
