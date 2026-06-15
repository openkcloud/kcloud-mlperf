#!/bin/bash

# 환경 변수로 설정 (필요시 수정)
DOCKER_USERNAME=${DOCKER_USERNAME:-"도커 로그인 계정명"}
WEB_IMAGE_PREFIX=${WEB_IMAGE_PREFIX:-"프론트엔드 이미지명 (ex. ghcr.io/etri-llm/etri-llm-frontend)"}
SERVER_IMAGE_PREFIX=${SERVER_IMAGE_PREFIX:-"백엔드 이미지명 (ex. ghcr.io/etri-llm/etri-llm-backend)"}
VERSION=${VERSION:-"버전명 (ex. v1.0.4)"}
WEB_ENVIRONMENT=${WEB_ENVIRONMENT:-"dev"}
SERVER_ENVIRONMENT=${SERVER_ENVIRONMENT:-"prod"}
# 플랫폼 설정 (linux/amd64 for standard Linux servers, linux/arm64 for ARM servers)
PLATFORM=${PLATFORM:-"linux/amd64"}

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Building and pushing Docker images for Linux...${NC}"
echo "Username: $DOCKER_USERNAME"
echo "Web Image: $WEB_IMAGE_PREFIX"
echo "Server Image: $SERVER_IMAGE_PREFIX"
echo "Version: $VERSION"
echo "Web Environment: $WEB_ENVIRONMENT"
echo "Server Environment: $SERVER_ENVIRONMENT"
echo "Target Platform: $PLATFORM"

# Docker buildx 설정 확인 및 생성
echo -e "${YELLOW}Setting up Docker buildx...${NC}"
if ! docker buildx ls | grep -q "linux-builder"; then
    docker buildx create --name linux-builder --use
    docker buildx inspect --bootstrap
else
    docker buildx use linux-builder
fi

# Docker Hub 로그인
docker login -u "$DOCKER_USERNAME"

# Dockerfile 선택
if [[ "$WEB_ENVIRONMENT" == "dev" ]]; then
    WEB_DOCKERFILE_SUFFIX="dev"
else
    WEB_DOCKERFILE_SUFFIX="prod"
fi

# Web 이미지 빌드 및 푸시
WEB_IMAGE="$WEB_IMAGE_PREFIX:$VERSION"
echo -e "${GREEN}Building web image for $PLATFORM...${NC}"
docker buildx build \
    --platform "$PLATFORM" \
    --push \
    -t "$WEB_IMAGE" \
    -f "./web/Dockerfile.$WEB_DOCKERFILE_SUFFIX" \
    ./web

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Web image built and pushed successfully${NC}"
else
    echo -e "${RED}✗ Failed to build web image${NC}"
    exit 1
fi


if [[ "$SERVER_ENVIRONMENT" == "dev" ]]; then
    SERVER_DOCKERFILE_SUFFIX="dev"
else
    SERVER_DOCKERFILE_SUFFIX="prod"
fi

# Server 이미지 빌드 및 푸시
SERVER_IMAGE="$SERVER_IMAGE_PREFIX:$VERSION"
echo -e "${GREEN}Building server image for $PLATFORM...${NC}"
docker buildx build \
    --platform "$PLATFORM" \
    --push \
    -t "$SERVER_IMAGE" \
    -f "./server/Dockerfile.$SERVER_DOCKERFILE_SUFFIX" \
    ./server

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Server image built and pushed successfully${NC}"
else
    echo -e "${RED}✗ Failed to build server image${NC}"
    exit 1
fi

echo -e "${GREEN}Done! Images pushed for $PLATFORM:${NC}"
echo "  - $WEB_IMAGE"
echo "  - $SERVER_IMAGE"