# PoliTopics‑C

A serverless application that fetches National Diet records, summarizes them with an LLM (Gemini), and stores results in DynamoDB. Run logs are written to S3. The project uses **TypeScript** for Lambda code, **Terraform** for infrastructure, and supports both **local development** via LocalStack and **deployment to AWS**.

---

## Highlights

- **Lambda function** `politopics-c`
  - Fetches raw data from the National Diet API
  - Summarizes speeches with Gemini
  - Stores structured **articles** in DynamoDB (single-table design)
  - Writes success/error logs to S3
  - **Date range** defaults to the **previous day (JST)** when `FROM_DATE` / `UNTIL_DATE` are not provided

- **DynamoDB (single table)**
  - Physical table: `politopics`
  - Keys: `PK` (partition), `SK` (sort)
  - GSIs:
    - `ArticleByDate` — global latest (GSI1: `GSI1PK = "ARTICLE"`, `GSI1SK = ISO date`)
    - `MonthDateIndex` — per-month latest (GSI2: `GSI2PK = "YEAR#YYYY#MONTH#MM"`, `GSI2SK = ISO date`)
  - Thin index items for categories, persons, keywords, image kinds, sessions, houses, and meetings

- **Local-first DX**
  - LocalStack recipe (Docker Compose)
  - DynamoDB bootstrap script
  - Jest integration tests against LocalStack (@ddb)
  - VS Code **Dev Container** support (`.devcontainer/`)

---

## Requirements

- Node.js 18+
- npm
- Docker (for LocalStack)
- AWS CLI
- Terraform v1.5+
- `zip` (for packaging, if you build a .zip)
- Gemini API key

---


## Local Development (LocalStack)


```bash
npm run local:up

./scripts/local-bootstrap.sh

npm run dev

```

---

## DynamoDB Data Model

Single physical table: **`politopics`**

### Key attributes

| Attribute | Type   | Purpose                                                                                     |
| --------- | ------ | ------------------------------------------------------------------------------------------- |
| `PK`      | String | Partition key (namespaces like `A#<id>`, `CATEGORY#<name>`, `PERSON#<name>`, etc.)          |
| `SK`      | String | Sort key (often `Y#YYYY#M#MM#D#<ISO date>#A#<id>` for index items; `META` for main article) |
| `GSI1PK`  | String | GSI1 global listing: always `"ARTICLE"` on main article item                                |
| `GSI1SK`  | String | GSI1 sort by ISO date (descending reads)                                                    |
| `GSI2PK`  | String | GSI2 per-month listing: `"YEAR#YYYY#MONTH#MM"` on main article item                            |
| `GSI2SK`  | String | GSI2 sort by ISO date                                                                       |

### Item types & key shapes

| `type`                | `PK` example              | `SK` example                | Main attributes (subset)                                                                                                                          |
| --------------------- | ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARTICLE` (main body) | `A#<id>`                  | `META`                      | `id,title,date,month,imageKind,session,nameOfHouse,nameOfMeeting,categories,description,summary,soft_summary,middle_summary,dialogs` + GSI fields |
| `CATEGORY_INDEX`      | `CATEGORY#<category>`     | `M#<month>#D#<date>#A#<id>` | `articleId,title,date,month,imageKind,nameOfMeeting`                                                                                              |
| `PERSON_INDEX`        | `PERSON#<nameOrYomi>`     | same as above               | same as above                                                                                                                                     |
| `KEYWORD_INDEX`       | `KEYWORD#<keyword>`       | same as above               | same as above                                                                                                                                     |
| `IMAGEKIND_INDEX`     | `IMAGEKIND#<imageKind>`   | same as above               | same as above                                                                                                                                     |
| `SESSION_INDEX`       | `SESSION#<zero-padded>`   | same as above               | same as above                                                                                                                                     |
| `HOUSE_INDEX`         | `HOUSE#<nameOfHouse>`     | same as above               | same as above                                                                                                                                     |
| `MEETING_INDEX`       | `MEETING#<nameOfMeeting>` | same as above               | same as above                                                                                                                                     |

### Representative queries

| Use case                   | KeyCondition                                       |
| -------------------------- | -------------------------------------------------- |
| Latest N for a category    | `PK='CATEGORY#外交'` with `ScanIndexForward=false`   |
| Category for a month       | `PK='CATEGORY#外交' AND begins_with(SK,'M#2025-08')` |
| Latest for imageKind = 会議録 | `PK='IMAGEKIND#会議録'`                               |
| Latest for session=201     | `PK='SESSION#0201'`                                |
| All latest articles        | **GSI1**: `GSI1PK='ARTICLE'` (descending)          |
| Latest for a month         | **GSI2**: `GSI2PK='MONTH#2025-08'` (descending)    |

> Dates are stored as **ISO 8601 UTC** strings so lexicographical order == chronological order.

---

## Logs

If `ERROR_BUCKET` is set, the Lambda stores run metadata in S3:

- `success/` — Successful runs (metadata + stored IDs)
- `error/` — Failed runs (serialized error)

Example S3 keys:

```
success/2025-08-11T13:48:32.270Z-<uuid>.json
error/2025-08-11T14:05:12.100Z-<uuid>.json
```
