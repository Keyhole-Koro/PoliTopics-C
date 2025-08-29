import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL; // LocalStack対応
const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}) });

function serializeError(e: unknown) {
  if (e && typeof e === "object") {
    const any = e as any;
    return { name: any.name, message: any.message, stack: any.stack };
  }
  return { message: String(e) };
}

function truncate(s: string, max = 1024 * 1024) {
  return s.length > max ? s.slice(0, max) + "\n/* truncated */" : s;
}

export async function saveErrorToS3(params: {
  error: unknown;
  payload: string;                     // LLMの生レスポンス
  meta?: Record<string, unknown>;      // 任意の付加情報
  keyHint?: string;                    // ファイル名ヒント
}) {
  const bucket = process.env.ERROR_BUCKET;
  const prefix = process.env.ERROR_PREFIX || "error"; // デフォルト /error
  if (!bucket) {
    console.warn("[errorSink] ERROR_BUCKET 未設定のため保存スキップ");
    return;
  }

  const iso = new Date().toISOString();
  const ts = iso.replace(/[:]/g, "-");               // Windows-safe
  const rnd = Math.random().toString(36).slice(2, 8);
  const key = `${prefix}/${ts}-${params.keyHint ?? "llm-parse"}-${rnd}.json`;

  const body = JSON.stringify(
    {
      time: iso,
      error: serializeError(params.error),
      meta: params.meta,
      payload: truncate(params.payload),
    },
    null,
    2
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      Tagging: "type=llm-json-parse-error",
    })
  );

  console.error(`[errorSink] saved to s3://${bucket}/${key}`);
  return { bucket, key };
}
