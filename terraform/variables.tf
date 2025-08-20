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

variable "gemini_model_name" {
  description = "Gemini model name"
  type        = string
  default     = "gemini-2.5-flash"
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

variable "run_api_key" {
  type        = string
  sensitive   = true
  description = "API key for POST /run (validated against x-api-key header)"
}
