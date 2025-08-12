````markdown
# PoliTopics-C

A serverless application that fetches National Diet records, summarizes them with LLM (Gemini), and stores the results in DynamoDB, with logs stored in S3.  
The project uses **Terraform** for infrastructure management, **TypeScript** for Lambda functions, and supports both **local development** (LocalStack) and AWS deployment.

---

## Features

- **Lambda Function** (`politopics-c`):
  - Fetches raw data from National Diet API
  - Summarizes speeches using Gemini API
  - Stores structured articles in DynamoDB (`politopics-article`)
  - Indexes article IDs in `politopics-keywords` and `politopics-participants`
  - Logs success/error events to S3 bucket (`politopics-error-logs-*`)

- **DynamoDB Tables**:
  1. `politopics-article` — Stores full article records
  2. `politopics-keywords` — Maps keywords → article IDs
  3. `politopics-participants` — Maps participants → article IDs

- **S3 Logs**:
  - `success/` and `error/` logs for each Lambda execution
  - Useful for debugging and audit

---

## Requirements

- Node.js 18+
- npm
- AWS CLI
- Terraform v1.5+
- LocalStack (optional, for local dev)
- `zip` command (for packaging Lambda)
- A Gemini API Key

---

## Environment Variables

Create a `.env` file in the project root:

```env
AWS_REGION=ap-northeast-3
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

NATIONAL_DIET_API_ENDPOINT=https://api.example.com
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: LocalStack endpoint
# AWS_ENDPOINT_URL=http://localhost:4566
````

---

## Local Development

### 1. Start LocalStack

```bash
localstack start -d
```

### 2. Bootstrap Local Resources

This will create DynamoDB tables and S3 bucket locally:

```bash
bash ./scripts/local-bootstrap-awscli.sh
```

### 3. Run Lambda Locally

```bash
npx ts-node -r tsconfig-paths/register scripts/local-invoke.ts
```

---

## Deploy to AWS

### 1. Build Lambda Package

```bash
bash ./scripts/build-zip.sh
```

### 2. Initialize and Apply Terraform

```bash
cd terraform
terraform init
terraform apply -auto-approve -var="region=ap-northeast-3"
```

Terraform will create:

* DynamoDB tables:

  * `politopics-article`
  * `politopics-keywords`
  * `politopics-participants`
* Lambda function `politopics-c`
* S3 log bucket
* API Gateway HTTP API (if enabled)

### 3. Check Outputs

```bash
terraform output
```

Example:

```
api_url = "https://xxxx.execute-api.ap-northeast-3.amazonaws.com"
function_name = "politopics-c"
log_bucket = "politopics-error-logs-123456789012-ap-northeast-3"
```

---

## DynamoDB Schema

### `politopics-article`

| Field        | Type   | Notes                          |
| ------------ | ------ | ------------------------------ |
| id           | String | PK                             |
| date         | String | GSI (DateIndex)                |
| title        | String |                                |
| summary      | String |                                |
| participants | List   | name + summary per participant |
| keywords     | List   | keyword + priority             |

### `politopics-keywords`

| Field   | Type   | Notes     |
| ------- | ------ | --------- |
| keyword | String | PK        |
| dataId  | String | Range key |

### `politopics-participants`

| Field       | Type   | Notes     |
| ----------- | ------ | --------- |
| participant | String | PK        |
| dataId      | String | Range key |

---

## Logs

Lambda logs execution results to S3:

* `success/` → Successful runs (metadata + stored IDs)
* `error/` → Failed runs (error stack trace)

Example S3 key:

```
success/2025-08-11T13:48:32.270Z-uuid.json
error/2025-08-11T14:05:12.100Z-uuid.json
```

---

## Useful Commands

### Tail Lambda Logs

```bash
aws logs tail /aws/lambda/politopics-c --follow --region ap-northeast-3
```

### Invoke Lambda Manually

```bash
aws lambda invoke \
  --function-name politopics-c \
  --payload '{}' \
  out.json \
  --region ap-northeast-3
cat out.json
```