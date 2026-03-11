#!/usr/bin/env bash

# 1. 현재 스크립트의 절대 경로 확보
SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"

# 2. 실행할 스크립트 경로 설정
TARGET_SCRIPT="$SCRIPT_DIR/nfs-subdir-external-provisioner-4.0.18/01-install.sh"

# 3. 스크립트 실행 (따옴표로 감싸면 공백/특수문자 자동 해결)
echo "Executing: $TARGET_SCRIPT"
"$TARGET_SCRIPT"