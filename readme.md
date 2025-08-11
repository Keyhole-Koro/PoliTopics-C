# PoliTopics Upgrade Pack (EN)

This pack implements the following improvements:

- **DB unification**: write directly to **DynamoDB** from Lambda (single-table design), no external `/articles` API.
- **Local DX**: `docker-compose` with LocalStack (DynamoDB/S3/Events/etc.) + DynamoDB Admin. One command to start.
- **Simple deploy**: AWS SAM template. `npm run build && sam deploy` is enough.
- **S3 logging**: Lambda writes **error logs** and **success run summaries** to S3 as JSON.
- **Pipeline**: EventBridge daily schedule. Optionally extendable to Step Functions for finer-grained orchestration.

---

## What’s included

- `template.yaml` — SAM: DynamoDB (single table), S3 (log bucket), Lambda, **daily schedule**, HTTP API.
- `replacements/src/DynamoDBHandler/storeData.ts` — direct DynamoDB writes via `PutCommand`.
- `replacements/src/lambda_handler.ts` — error **and success** logging to S3; safer env handling.
- `docker-compose.yml` — LocalStack + DynamoDB Admin.
- `scripts/local-bootstrap.sh` — sets up the local DynamoDB table + S3 bucket on LocalStack.
- `scripts/local-invoke.ts` — local invocation entrypoint for the Lambda handler.
- `events/sample-schedule.json` — example scheduled event.
- `.env.example` — environment variables.
- `.github/workflows/ci-cd.yml` — CI/CD with build/test + `sam deploy`.

> The project is assumed to be TypeScript and builds into `dist/`. SAM points to `dist/lambda_handler.js` as the entry.

---

## Apply (quick path)

1. Place this pack at the repository root.
2. **Overwrite** the following files:
   - `src/DynamoDBHandler/storeData.ts` → `replacements/src/DynamoDBHandler/storeData.ts`
   - `src/lambda_handler.ts` → `replacements/src/lambda_handler.ts`
3. Add dependencies:
   ```bash
   npm i @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3
   ```
4. Create `.env` based on `.env.example` and set `NATIONAL_DIET_API_ENDPOINT`, `GEMINI_API_KEY`.
5. Local run:
   ```bash
   docker compose up -d
   bash scripts/local-bootstrap.sh
   npm run build
   npx ts-node scripts/local-invoke.ts
   ```
6. Deploy:
   ```bash
   npm run build
   sam build
   sam deploy --no-confirm-changeset --stack-name politopics --resolve-s3 --capabilities CAPABILITY_IAM
   ```

---

## Single-table design (quick)

- **PK**: `ARTICLE#{id}`
- **SK**: `META`
- **GSI1** (date queries): `gsi1pk=DATE#{date}`, `gsi1sk=id`

Each article is stored as a single item (arrays kept inline). To expand reverse lookups later (keywords/speakers), add more items like:

- `PK=KEYWORD#{keyword}`, `SK=ARTICLE#{id}`
- `PK=PARTICIPANT#{name}`, `SK=ARTICLE#{id}`

---

## S3 Logging

We reuse the same bucket defined as `ERROR_BUCKET` for both **error** and **success** logs (different prefixes):

- Errors → `s3://$ERROR_BUCKET/error/YYYY-MM-DDTHH:mm:ss.sssZ-{uuid}.json`
- Success → `s3://$ERROR_BUCKET/success/YYYY-MM-DDTHH:mm:ss.sssZ-{uuid}.json`

The **success** payload contains: `runId`, `startedAt`, `finishedAt`, `stored`, `storedIds`, and optional filters (`from`, `until`).

If you prefer separate buckets or a more generic name, rename the parameter to `LOG_BUCKET` in `template.yaml` and update env usage accordingly.

---

## Pipeline options

The pack ships a single Lambda that does **Fetch → Summarize → Store** and is triggered daily via EventBridge.

If you need finer-grained retries/monitoring, split into three Lambdas and orchestrate via **Step Functions**:

1. `FetchRecordsFunction`
2. `SummarizeFunction`
3. `StoreArticleFunction`

SAM supports this via `AWS::Serverless::StateMachine`.

---

## CI/CD Notes

- Add `AWS_ROLE_ARN` (OIDC) to repository secrets.
- Default region is **ap-northeast-3** (Osaka). Switch to **ap-northeast-1** (Tokyo) if preferred.

---

## Common pitfalls

- For LocalStack, set SDK clients with `AWS_ENDPOINT_URL=http://localhost:4566` (handled by this pack).
- `sam deploy` requires S3 bucket creation permissions on the first run. If not available, pass `--s3-bucket` explicitly.
- Missing `GEMINI_API_KEY` will fail the summarize step; a JSON error will be saved to S3 if `ERROR_BUCKET` is set.
