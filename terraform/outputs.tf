output "article_table_name" {
  value = aws_dynamodb_table.article.name
}

output "keyword_table_name" {
  value = aws_dynamodb_table.keywords.name
}

output "participant_table_name" {
  value = aws_dynamodb_table.participants.name
}

output "log_bucket" {
  value = aws_s3_bucket.logs.bucket
}

output "function_name" {
  value = aws_lambda_function.handler.function_name
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}
