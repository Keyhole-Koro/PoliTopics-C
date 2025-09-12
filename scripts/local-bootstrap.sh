#!/usr/bin/env bash
# Bootstrap PoliTopics resources on LocalStack using AWS CLI (no awslocal).
# Fixed names (single-table design):
#   - DynamoDB: politopics (PK, SK; GSIs: ArticleByDate, MonthDateIndex)
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

TABLE_NAME="politopics"
echo "Creating DynamoDB table '$TABLE_NAME' (single table)..."
aws --endpoint-url "$ENDPOINT" dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    '[
      {
        "IndexName": "ArticleByDate",
        "KeySchema": [
          {"AttributeName": "GSI1PK", "KeyType": "HASH"},
          {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      },
      {
        "IndexName": "MonthDateIndex",
        "KeySchema": [
          {"AttributeName": "GSI2PK", "KeyType": "HASH"},
          {"AttributeName": "GSI2SK", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      }
    ]' \
  >/dev/null 2>&1 || true

aws --endpoint-url "$ENDPOINT" dynamodb wait table-exists --table-name "$TABLE_NAME"

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
