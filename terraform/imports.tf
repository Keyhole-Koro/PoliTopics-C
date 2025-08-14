# Adopt the already-existing HTTP API route "POST /run" into Terraform state.
# ID format: <apiId>/<routeId>
import {
  to = aws_apigatewayv2_route.post_run
  id = "${var.api_id}/${var.existing_post_run_route_id}"
}
