# PoliTopics — End-to-End Guide (Local Dev, Deploy, CI/CD, Ops)

This single document covers everything you need to build, run, and operate **PoliTopics**:
local testing with LocalStack, SAM deployment, CI/CD, environment variables, architecture,
data model, API usage, pipeline options, logging, and troubleshooting.

---

## Quick Start (TL;DR)

```bash
# 0) Prepare
cp .env.example .env   # fill in NATIONAL_DIET_API_ENDPOINT / GEMINI_API_KEY

# 1) Local infra
docker compose up -d
bash scripts/local-bootstrap.sh  # creates DynamoDB table + S3 bucket on LocalStack

# 2) Build & run locally
npm ci
npm run build
npx ts-node scripts/local-invoke.ts

# 3) Check results
# DynamoDB Admin: http://localhost:8001
aws --endpoint-url=http://localhost:4566 s3 ls s3://politopics-error-logs/success/
```

---

## Architecture Overview

```
EventBridge (daily) ─┐
                      ├─> Lambda (fetch → summarize → store)
HTTP API (/run) ──────┘                │
                                       ├─ DynamoDB (single table: politopics)
                                       └─ S3 (JSON logs: success/, error/)
```

* **Lambda** (Node.js 20): orchestrates fetch from the National Diet API → LLM summarize → persist to DynamoDB.
* **EventBridge**: daily schedule trigger (`rate(1 day)`).
* **HTTP API**: `POST /run` to kick off on demand (same handler).
* **DynamoDB**: single-table design for articles + a GSI for date queries.
* **S3 logging**: both **success run summaries** and **errors** are written as JSON for auditing.

---

## Environment Variables

| Name                         | Purpose                 | Example                                         | Notes                                     |
| ---------------------------- | ----------------------- | ----------------------------------------------- | ----------------------------------------- |
| `AWS_REGION`                 | Region                  | `ap-northeast-3`                                | Used both local & prod                    |
| `AWS_ENDPOINT_URL`           | LocalStack endpoint     | `http://localhost:4566`                         | Local only                                |
| `TABLE_NAME`                 | DynamoDB table          | `politopics`                                    | Matches SAM defaults                      |
| `ERROR_BUCKET`               | S3 bucket for logs      | (set by SAM)                                    | Used for **success/** and **error/** logs |
| `NATIONAL_DIET_API_ENDPOINT` | Source API              | `https://kokkai.ndl.go.jp/api/meeting?limit=50` | Required                                  |
| `GEMINI_API_KEY`             | LLM key                 | `***`                                           | Required                                  |
| `FROM_DATE`                  | Optional filter (start) | `2025-01-01`                                    | Optional                                  |
| `UNTIL_DATE`                 | Optional filter (end)   | `2025-01-31`                                    | Optional                                  |

**Notes**

* In **production**, `template.yaml` creates the bucket as
  `politopics-error-logs-${AccountId}-${Region}` and injects its name into `ERROR_BUCKET`.
* In **local**, `scripts/local-bootstrap.sh` creates `politopics-error-logs` on LocalStack.

---

## Local Development & Testing

### Prereqs

* Node.js **v20+**
* Docker / Docker Compose
* (Optional) AWS CLI v2

### Steps

1. **Start LocalStack**

```bash
docker compose up -d
```

2. **Create local resources**

```bash
bash scripts/local-bootstrap.sh
# creates:
# - DynamoDB table "politopics" (with GSI1)
# - S3 bucket "politopics-error-logs"
```

3. **Configure `.env`**

```env
AWS_REGION=ap-northeast-3
AWS_ENDPOINT_URL=http://localhost:4566
TABLE_NAME=politopics
ERROR_BUCKET=politopics-error-logs

NATIONAL_DIET_API_ENDPOINT=https://kokkai.ndl.go.jp/api/meeting?limit=50
GEMINI_API_KEY=***
# FROM_DATE=2025-01-01
# UNTIL_DATE=2025-01-31
```

4. **Build & run**

```bash
npm ci
npm run build
npx ts-node scripts/local-invoke.ts
```

5. **Inspect**

* DynamoDB Admin: `http://localhost:8001` → table `politopics`
* S3 logs (LocalStack):

```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://politopics-error-logs/success/
aws --endpoint-url=http://localhost:4566 s3 cp s3://politopics-error-logs/success/<file>.json -
```

6. **Simulated schedule**

* `scripts/local-invoke.ts` triggers the same handler with a minimal scheduled-event shape.
* You can adjust `FROM_DATE`/`UNTIL_DATE` to limit the data pulled.

**Debug tips**

* Ensure `NODE_OPTIONS=--enable-source-maps` is set (already in SAM `Globals`) for readable stacks.
* If LocalStack acts up, reset volumes: `docker compose down -v && docker compose up -d`.

---

## Deployment (AWS SAM)

### Build

```bash
npm ci
npm run build
sam build
```

### Deploy

```bash
sam deploy \
  --no-confirm-changeset \
  --stack-name politopics \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --region ap-northeast-3
# Use --region ap-northeast-1 for Tokyo if preferred
```

### Outputs & Manual Run

* `sam deploy` prints `HttpApiUrl`, e.g. `https://{apiId}.execute-api.{region}.amazonaws.com`.
* Manual trigger:

```bash
curl -X POST "$HttpApiUrl/run" -H 'Content-Type: application/json' -d '{}'
```

* The daily EventBridge rule runs the Lambda automatically.

### Config in prod

* Shared env vars are defined in `template.yaml` under `Globals → Function → Environment`.
* Prefer **Parameter Store** / **Secrets Manager** for secrets (e.g., `GEMINI_API_KEY`).

---

## CI/CD (GitHub Actions)

**What it does**

1. Setup Node & cache deps
2. `npm test` (if present)
3. `npm run build`
4. `sam build` → `sam deploy`

**Required**

* Repository Secret: `AWS_ROLE_ARN` (assumed via OIDC).
* Default region in the workflow is **ap-northeast-3**. Change to **ap-northeast-1** if needed.

**Optional manual trigger**

```yaml
on:
  workflow_dispatch:
```

**Common issues**

* OIDC misconfig → `AccessDenied`: check role trust policy + permissions.
* Long runs → increase Lambda `Timeout` / memory; measure locally first.

---

## Data Model (DynamoDB)

**Primary item (Article)**

* `PK = ARTICLE#{id}`
* `SK = META`
* `type = "Article"`
* `createdAt = ISO string`

**GSI1 (date queries)**

* `gsi1pk = DATE#{date}`
* `gsi1sk = {id}`

**Example item (conceptual)**

```json
{
  "PK": "ARTICLE#<id>",
  "SK": "META",
  "type": "Article",
  "createdAt": "2025-08-11T00:00:00.000Z",
  "gsi1pk": "DATE#2025-08-10",
  "gsi1sk": "<id>",
  "id": "<id>",
  "date": "2025-08-10",
  "meetingInfo": { /* ... */ },
  "speeches": [ /* ... */ ],
  "summary": "LLM output ..."
}
```

**Write pattern**

* `PutCommand` with `ConditionExpression: attribute_not_exists(PK)` to prevent duplicates.

**Future expansions**

* Reverse lookups (keywords / speakers) by inserting secondary linkage items:
  `PK=KEYWORD#{keyword}, SK=ARTICLE#{id}`
  `PK=PARTICIPANT#{name}, SK=ARTICLE#{id}`

---

## HTTP API

* **Base**: `HttpApiUrl` (CloudFormation output)
* **Endpoint**: `POST /run`
* **Body**: currently unused; the handler relies on env vars `FROM_DATE` / `UNTIL_DATE`.
  If you need per-request filters, extend the handler to read `from`/`until` from the request body.

**Example**

```bash
curl -X POST "$HttpApiUrl/run" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**CORS**

* Enabled permissively in SAM (`AllowOrigins: ["*"]`). Tighten as needed.

---

## S3 Logging (Success & Error)

Both **success** and **error** logs are written to the bucket referenced by `ERROR_BUCKET` with different prefixes:

* Success → `s3://$ERROR_BUCKET/success/<ISO>-<uuid>.json`
  Payload includes: `runId`, `startedAt`, `finishedAt`, `stored`, `storedIds`, `filters`, `eventSource`.

* Error → `s3://$ERROR_BUCKET/error/<ISO>-<uuid>.json`
  Payload includes the same run context + `{ message, stack }`.

In local dev, these go to the LocalStack bucket (`politopics-error-logs`).

---

## Pipeline Options (Step Functions)

Current pack keeps a single Lambda to simplify ops.
If you want finer control, split into three functions and orchestrate via **Step Functions**:

1. `FetchRecordsFunction` (National Diet API)
2. `SummarizeFunction` (LLM)
3. `StoreArticleFunction` (DynamoDB)

Benefits: granular retries, parallelization, observability.
SAM supports `AWS::Serverless::StateMachine` for this.

---

## Troubleshooting

* **LocalStack can’t be reached**
  Verify `AWS_ENDPOINT_URL=http://localhost:4566`. Reset volumes:
  `docker compose down -v && docker compose up -d`.

* **Port conflicts**
  Ensure nothing else is listening on `4566` (LocalStack) or `8001` (DynamoDB Admin).

* **Missing env**
  Errors like `Missing required environment variable: ...` → check `.env` and Lambda env in AWS.

* **ConditionalCheckFailedException**
  Duplicate insert: the `PutCommand` uses `attribute_not_exists(PK)`.
  Decide whether to skip or switch to `Update` for idempotency.

* **Timeouts / memory**
  LLM summarize may be heavy. Raise `Timeout`/`MemorySize` (default: 900s / 1024MB) or batch the work.

* **AccessDenied in CI/CD**
  Revisit OIDC trust policy and role permissions (`cloudformation:*`, `lambda:*`, `dynamodb:*`, `s3:*`, `events:*`, etc.).

---

## Security & Cost Notes

* Store secrets (e.g., `GEMINI_API_KEY`) in **Parameter Store** or **Secrets Manager**.
* DynamoDB uses **PAY\_PER\_REQUEST** by default; cost scales with usage.
* Tune Lambda memory/time based on real execution metrics; higher memory can reduce duration (and sometimes cost).

---

## File Layout (Key Pieces)

* `template.yaml` — SAM (DynamoDB, S3, Lambda, EventBridge schedule, HTTP API)
* `src/DynamoDBHandler/storeData.ts` — **direct** writes to DynamoDB
* `src/lambda_handler.ts` — main handler (**success/error** S3 logs)
* `docker-compose.yml` — LocalStack + DynamoDB Admin
* `scripts/local-bootstrap.sh` — creates local table & bucket
* `scripts/local-invoke.ts` — local entrypoint for the handler
* `.github/workflows/ci-cd.yml` — build/test/deploy pipeline
* `.env.example` — environment template

---

That’s it. If you want this split into subsections in your repo’s `docs/` folder later, say the word and I’ll generate the files.
