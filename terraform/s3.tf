resource "aws_s3_bucket" "logs" {
  bucket = "politopics-error-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-after-90-days"
    status = "Enabled"

    filter {}  # apply to the whole bucket

    expiration {
      days = 90
    }
  }
}
