#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:=ap-northeast-3}"
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=$AWS_REGION
export AWS_ENDPOINT_URL=http://localhost:4566

echo "Creating DynamoDB table 'politopics'..."
awslocal dynamodb create-table   --table-name politopics   --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S   --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE   --billing-mode PAY_PER_REQUEST   --global-secondary-indexes 'IndexName=GSI1,KeySchema=[{AttributeName=gsi1pk,KeyType=HASH},{AttributeName=gsi1sk,KeyType=RANGE}],Projection={ProjectionType=ALL}' || true

echo "Creating S3 bucket 'politopics-error-logs'..."
awslocal s3 mb s3://politopics-error-logs || true

echo "Done."
