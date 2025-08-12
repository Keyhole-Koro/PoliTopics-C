cp -n .env.tmpl .env
set -a; . ./.env; set +a

export TF_VAR_gemini_api_key="$GEMINI_API_KEY"
export TF_VAR_national_diet_api_endpoint="$NATIONAL_DIET_API_ENDPOINT"
export TF_VAR_from_date="${FROM_DATE:-}"
export TF_VAR_until_date="${UNTIL_DATE:-}"

npm run build
mkdir -p build && ( cd dist && zip -r ../build/lambda.zip . )

cd terraform
terraform init
terraform apply -auto-approve -var="region=${AWS_REGION:-ap-northeast-3}"
