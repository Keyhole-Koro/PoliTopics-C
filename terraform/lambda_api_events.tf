#############################################
# IAM role for Lambda
#############################################
resource "aws_iam_role" "lambda_role" {
  name = "${local.name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

# Basic CloudWatch logs for Lambda
resource "aws_iam_role_policy_attachment" "lambda_basic_logs" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

#############################################
# DynamoDB permissions (all three tables)
# NOTE: the three tables (article/keywords/participants) must exist elsewhere.
#############################################
resource "aws_iam_policy" "ddb_policy" {
  name = "${local.name}-ddb-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = [
        "dynamodb:PutItem", "dynamodb:BatchWriteItem",
        "dynamodb:GetItem", "dynamodb:BatchGetItem",
        "dynamodb:Query", "dynamodb:DescribeTable"
      ],
      Resource = [
        aws_dynamodb_table.article.arn,
        aws_dynamodb_table.keywords.arn,
        aws_dynamodb_table.participants.arn
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ddb_attach" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.ddb_policy.arn
}

#############################################
# Extra DynamoDB permissions for link tables
#############################################
resource "aws_iam_policy" "ddb_links_policy" {
  name = "${local.name}-ddb-links-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = [
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:Query",
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem",
        "dynamodb:DescribeTable"
      ],
      Resource = [
        aws_dynamodb_table.keywords.arn,
        aws_dynamodb_table.participants.arn
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ddb_links_attach" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.ddb_links_policy.arn
}

#############################################
# S3 policy for error logs (bucket must exist)
#############################################
resource "aws_iam_policy" "s3_policy" {
  name = "${local.name}-s3-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = ["s3:PutObject"],
      Resource = "${aws_s3_bucket.logs.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "s3_attach" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.s3_policy.arn
}

#############################################
# Lambda function (fixed name: politopics-c)
#############################################
resource "aws_lambda_function" "handler" {
  function_name = "politopics-c"
  role          = aws_iam_role.lambda_role.arn
  runtime       = "nodejs20.x"
  handler       = "lambda_handler.handler"

  # Package
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  # Performance
  timeout       = 900
  memory_size   = 1024
  architectures = ["x86_64"]

  # Environment variables
  environment {
    variables = {
      # Node.js runtime tuning
      NODE_OPTIONS                        = "--enable-source-maps"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"

      # Table names (wired to existing DDB resources)
      ARTICLE_TABLE_NAME     = aws_dynamodb_table.article.name
      KEYWORD_TABLE_NAME     = aws_dynamodb_table.keywords.name
      PARTICIPANT_TABLE_NAME = aws_dynamodb_table.participants.name

      # Error logging sink
      ERROR_BUCKET = aws_s3_bucket.logs.bucket

      # Secrets and config (fill via TF vars or workspace vars)
      GEMINI_API_KEY             = var.gemini_api_key
      NATIONAL_DIET_API_ENDPOINT = var.national_diet_api_endpoint
      RUN_API_KEY                = var.run_api_key

      # Optional date filters
      FROM_DATE  = var.from_date
      UNTIL_DATE = var.until_date
    }
  }

  tags = local.tags
}

#############################################
# EventBridge (scheduled run)
#############################################
resource "aws_cloudwatch_event_rule" "daily" {
  name                = "${local.name}-daily"
  schedule_expression = var.schedule_expression
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "daily_target" {
  rule      = aws_cloudwatch_event_rule.daily.name
  target_id = "lambda"
  arn       = aws_lambda_function.handler.arn
}

# Lambda permission for EventBridge
resource "aws_lambda_permission" "allow_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily.arn
}

#############################################
# API Gateway v2 (HTTP API)
#############################################
resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST"]
  }

  tags = local.tags
}

# Single integration (keep this one; remove any duplicate "run_lambda")
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.handler.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# Single route (keep this one; remove any duplicate "run")
resource "aws_apigatewayv2_route" "post_run" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /run"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Default stage (auto deploy)
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}

# Lambda permission for API Gateway (single source of truth)
# NOTE: We keep only this permission and delete any duplicate permission resources.
resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowExecutionFromAPIGatewayV2"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler.function_name
  principal     = "apigateway.amazonaws.com"

  # Wide allow is operationally stable in production. If you need to restrict,
  # switch to "${aws_apigatewayv2_api.http.execution_arn}/*/POST/run" *after* the system is stable.
  source_arn = "${aws_apigatewayv2_api.http.execution_arn}/*/*"

  # Ensure route and stage exist before granting permission (reduces eventual-consistency issues)
  depends_on = [
    aws_apigatewayv2_route.post_run,
    aws_apigatewayv2_stage.default
  ]
}

data "aws_apigatewayv2_api" "http" {
  api_id = var.apigw_api_id
}

data "aws_apigatewayv2_route" "run" {
  api_id   = var.apigw_api_id
  route_id = var.apigw_route_id
}
