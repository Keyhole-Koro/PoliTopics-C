resource "aws_dynamodb_table" "article" {
  name         = "politopics-article"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  global_secondary_index {
    name            = "DateIndex"
    hash_key        = "date"
    projection_type = "ALL"
  }

  tags = local.tags

  attribute {
    name = "month"
    type = "S"
  }


  point_in_time_recovery {
    enabled = true
  }


  global_secondary_index {
    name               = "MonthDateIndex"
    hash_key           = "month"
    range_key          = "date"
    projection_type    = "ALL"
  }

}

resource "aws_dynamodb_table" "keywords" {
  name         = "politopics-keywords"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "keyword"
  range_key    = "dataId"

  attribute {
    name = "keyword"
    type = "S"
  }

  attribute {
    name = "dataId"
    type = "S"
  }

  tags = local.tags

  global_secondary_index {
    name               = "DataIdKeywordIndex"
    hash_key           = "dataId"
    range_key          = "keyword"
    projection_type    = "ALL"
  }


  point_in_time_recovery {
    enabled = true
  }

}

resource "aws_dynamodb_table" "participants" {
  name         = "politopics-participants"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "participant"
  range_key    = "dataId"

  attribute {
    name = "participant"
    type = "S"
  }

  attribute {
    name = "dataId"
    type = "S"
  }

  tags = local.tags

  global_secondary_index {
    name               = "DataIdParticipantIndex"
    hash_key           = "dataId"
    range_key          = "participant"
    projection_type    = "ALL"
  }


  point_in_time_recovery {
    enabled = true
  }

}
