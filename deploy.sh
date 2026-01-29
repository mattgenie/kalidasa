#!/bin/bash
# ============================================================================
# Kalidasa: AWS App Runner Deployment Script
# ============================================================================
# Usage:
#   ./deploy.sh           # Update existing service
#   ./deploy.sh --create  # First-time setup (creates ECR repo + App Runner service)
#   ./deploy.sh --build-only  # Just build and push to ECR
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REPO="kalidasa"
APP_RUNNER_SERVICE="kalidasa-search-api"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ----------------------------------------------------------------------------
# Parse arguments
# ----------------------------------------------------------------------------
CREATE_MODE=false
BUILD_ONLY=false

for arg in "$@"; do
    case $arg in
        --create) CREATE_MODE=true ;;
        --build-only) BUILD_ONLY=true ;;
        --help|-h)
            echo "Usage: $0 [--create] [--build-only]"
            echo "  --create      First-time setup (creates ECR repo + App Runner service)"
            echo "  --build-only  Only build and push to ECR, don't deploy"
            exit 0
            ;;
    esac
done

# ----------------------------------------------------------------------------
# Validate prerequisites
# ----------------------------------------------------------------------------
log_info "Validating prerequisites..."

command -v aws >/dev/null 2>&1 || log_error "AWS CLI not found. Install: brew install awscli"
command -v docker >/dev/null 2>&1 || log_error "Docker not found"

# Check AWS credentials
aws sts get-caller-identity >/dev/null 2>&1 || log_error "AWS credentials not configured. Run: aws configure"

log_success "Prerequisites validated (Account: ${AWS_ACCOUNT_ID}, Region: ${AWS_REGION})"

# ----------------------------------------------------------------------------
# Create IAM Role for App Runner (first-time only)
# ----------------------------------------------------------------------------
if [ "$CREATE_MODE" = true ]; then
    log_info "Setting up IAM role for App Runner ECR access..."
    
    ROLE_NAME="AppRunnerECRAccessRole"
    
    # Check if role exists
    if aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
        log_warn "IAM role '${ROLE_NAME}' already exists"
    else
        # Create trust policy for App Runner
        TRUST_POLICY='{
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "Service": "build.apprunner.amazonaws.com"
                    },
                    "Action": "sts:AssumeRole"
                }
            ]
        }'
        
        log_info "Creating IAM role..."
        aws iam create-role \
            --role-name "${ROLE_NAME}" \
            --assume-role-policy-document "${TRUST_POLICY}" \
            --description "Allows App Runner to pull images from ECR"
        
        # Attach AWS managed policy for ECR access
        log_info "Attaching ECR access policy..."
        aws iam attach-role-policy \
            --role-name "${ROLE_NAME}" \
            --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
        
        log_success "IAM role '${ROLE_NAME}' created with ECR access"
        
        # Wait for role to propagate (IAM is eventually consistent)
        log_info "Waiting for IAM role to propagate (10s)..."
        sleep 10
    fi
fi

# ----------------------------------------------------------------------------
# Create ECR repository (first-time only)
# ----------------------------------------------------------------------------
if [ "$CREATE_MODE" = true ]; then
    log_info "Creating ECR repository..."
    if aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1; then
        log_warn "ECR repository '${ECR_REPO}' already exists"
    else
        aws ecr create-repository \
            --repository-name "${ECR_REPO}" \
            --region "${AWS_REGION}" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256
        log_success "ECR repository created"
    fi
fi

# ----------------------------------------------------------------------------
# Build Docker image
# ----------------------------------------------------------------------------
log_info "Building Docker image..."
docker build -t "${ECR_REPO}:${IMAGE_TAG}" .
log_success "Docker image built: ${ECR_REPO}:${IMAGE_TAG}"

# ----------------------------------------------------------------------------
# Push to ECR
# ----------------------------------------------------------------------------
log_info "Authenticating with ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

log_info "Pushing image to ECR..."
docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:${IMAGE_TAG}"
log_success "Image pushed: ${ECR_URI}:${IMAGE_TAG}"

if [ "$BUILD_ONLY" = true ]; then
    log_success "Build complete (--build-only mode)"
    exit 0
fi

# ----------------------------------------------------------------------------
# Load environment variables for App Runner
# ----------------------------------------------------------------------------
log_info "Loading environment variables from .env..."

if [ ! -f .env ]; then
    log_error ".env file not found. Copy .env.example and fill in your API keys."
fi

# Build runtime environment config as proper JSON dict (not array)
# App Runner expects: {"KEY": "value", "KEY2": "value2"}
ENV_VARS="{"
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Remove quotes from value
    value="${value%\"}"
    value="${value#\"}"
    # Escape any quotes in value for JSON
    value="${value//\"/\\\"}"
    # Append in proper JSON dict format
    ENV_VARS="${ENV_VARS}\"${key}\":\"${value}\","
done < .env

# Remove trailing comma and close brace
ENV_VARS="${ENV_VARS%,}}"

# ----------------------------------------------------------------------------
# Create or update App Runner service
# ----------------------------------------------------------------------------
if [ "$CREATE_MODE" = true ]; then
    log_info "Creating App Runner service..."
    
    # Create autoscaling configuration
    AUTOSCALE_ARN=$(aws apprunner create-auto-scaling-configuration \
        --auto-scaling-configuration-name "kalidasa-autoscale" \
        --min-size 1 \
        --max-size 10 \
        --max-concurrency 80 \
        --region "${AWS_REGION}" \
        --query 'AutoScalingConfiguration.AutoScalingConfigurationArn' \
        --output text 2>/dev/null || \
        aws apprunner describe-auto-scaling-configuration \
            --auto-scaling-configuration-name "kalidasa-autoscale" \
            --region "${AWS_REGION}" \
            --query 'AutoScalingConfiguration.AutoScalingConfigurationArn' \
            --output text)
    
    log_info "Autoscaling config ARN: ${AUTOSCALE_ARN}"
    
    # Create the service
    aws apprunner create-service \
        --service-name "${APP_RUNNER_SERVICE}" \
        --source-configuration "{
            \"AuthenticationConfiguration\": {
                \"AccessRoleArn\": \"arn:aws:iam::${AWS_ACCOUNT_ID}:role/AppRunnerECRAccessRole\"
            },
            \"AutoDeploymentsEnabled\": false,
            \"ImageRepository\": {
                \"ImageIdentifier\": \"${ECR_URI}:${IMAGE_TAG}\",
                \"ImageRepositoryType\": \"ECR\",
                \"ImageConfiguration\": {
                    \"Port\": \"3200\",
                    \"RuntimeEnvironmentVariables\": ${ENV_VARS}
                }
            }
        }" \
        --instance-configuration "{
            \"Cpu\": \"1024\",
            \"Memory\": \"2048\"
        }" \
        --health-check-configuration "{
            \"Protocol\": \"HTTP\",
            \"Path\": \"/health\",
            \"Interval\": 10,
            \"Timeout\": 5,
            \"HealthyThreshold\": 1,
            \"UnhealthyThreshold\": 5
        }" \
        --auto-scaling-configuration-arn "${AUTOSCALE_ARN}" \
        --region "${AWS_REGION}"
    
    log_success "App Runner service created!"
    log_info "Note: First deployment takes 3-5 minutes. Check status with:"
    echo "  aws apprunner describe-service --service-arn <arn> --region ${AWS_REGION}"
    
else
    log_info "Updating App Runner service..."
    
    # Get existing service ARN
    SERVICE_ARN=$(aws apprunner list-services \
        --region "${AWS_REGION}" \
        --query "ServiceSummaryList[?ServiceName=='${APP_RUNNER_SERVICE}'].ServiceArn" \
        --output text)
    
    if [ -z "$SERVICE_ARN" ]; then
        log_error "Service '${APP_RUNNER_SERVICE}' not found. Run with --create first."
    fi
    
    aws apprunner update-service \
        --service-arn "${SERVICE_ARN}" \
        --source-configuration "{
            \"AuthenticationConfiguration\": {
                \"AccessRoleArn\": \"arn:aws:iam::${AWS_ACCOUNT_ID}:role/AppRunnerECRAccessRole\"
            },
            \"AutoDeploymentsEnabled\": false,
            \"ImageRepository\": {
                \"ImageIdentifier\": \"${ECR_URI}:${IMAGE_TAG}\",
                \"ImageRepositoryType\": \"ECR\",
                \"ImageConfiguration\": {
                    \"Port\": \"3200\",
                    \"RuntimeEnvironmentVariables\": ${ENV_VARS}
                }
            }
        }" \
        --region "${AWS_REGION}"
    
    log_success "Deployment triggered!"
    
    # Get and display the service URL
    SERVICE_URL=$(aws apprunner describe-service \
        --service-arn "${SERVICE_ARN}" \
        --region "${AWS_REGION}" \
        --query 'Service.ServiceUrl' \
        --output text)
    
    echo ""
    log_success "Service URL: https://${SERVICE_URL}"
    echo "  Health: https://${SERVICE_URL}/health"
    echo "  API:    POST https://${SERVICE_URL}/api/search"
fi

echo ""
log_success "Deployment complete! 🏛️"
