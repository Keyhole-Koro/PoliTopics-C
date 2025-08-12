terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # Use this if you want a remote backend:
  # backend "s3" {}
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name = var.app_name
  tags = {
    Project = var.app_name
    Managed = "terraform"
  }
}
