variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-3"
}

variable "app_name" {
  description = "Application name prefix"
  type        = string
  default     = "politopics"
}

variable "schedule_expression" {
  description = "EventBridge schedule expression"
  type        = string
  default     = "rate(1 day)"
}

variable "lambda_zip_path" {
  description = "Path to Lambda zip (built from dist)"
  type        = string
  default     = "../build/lambda.zip"
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
}

variable "national_diet_api_endpoint" {
  type        = string
  description = "National Diet API endpoint"
  default     = "https://kokkai.ndl.go.jp/api/meeting?limit=50"
}

variable "from_date" {
  type    = string
  default = ""
}

variable "until_date" {
  type    = string
  default = ""
}

variable "keyword_table_name" {
  description = "DynamoDB table for keyword -> articleId links"
  type        = string
  default     = "politopics-keywords"
}

variable "participant_table_name" {
  description = "DynamoDB table for participant -> articleId links"
  type        = string
  default     = "politopics-participants"
}

variable "run_api_key" {
  type        = string
  sensitive   = true
  description = "API key for POST /run (validated against x-api-key header)."
}

# RouteId of the existing 'POST /run' route (e.g., hnm2tbm)
variable "existing_post_run_route_id" {
  type        = string
  description = "Existing RouteId for 'POST /run'"
}

variable "apigw_api_id" {
  type      = string
  description = "Existing HTTP API id"
}

variable "apigw_route_id" {
  type      = string
  description = "Existing RouteId for 'POST /run'"
}
