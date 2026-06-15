#!/usr/bin/env bash
# install-build-host.sh — turn a node into a docker-image build/push host.
#
# Use case: cluster nodes only have containerd; we need ONE machine that has a
# full docker daemon for `docker build` + `docker push`. Today node4 plays this
# role because it had docker pre-installed. Run this script when you bring up
# a new build host (e.g., a dedicated CI runner).
#
# Usage:
#   ./install-build-host.sh                      # interactive: prompts for Docker Hub creds
#   DOCKERHUB_USER=jungwooshim DOCKERHUB_TOKEN=dckr_xxx ./install-build-host.sh    # non-interactive
#   ./install-build-host.sh --skip-login         # install daemon, skip docker login
#   ./install-build-host.sh --help
#
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 install failure | 4 login failure

set -euo pipefail

SKIP_LOGIN=false
case "${1:-}" in
  --help|-h) grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
  --skip-login) SKIP_LOGIN=true ;;
  '') ;;
  *) echo "ERROR: unknown flag '$1'. See --help." >&2; exit 2 ;;
esac

if ! grep -q '22.04' /etc/os-release 2>/dev/null; then
  echo "ERROR: this script targets Ubuntu 22.04 only" >&2; exit 1
fi

# 1. Install docker via apt
if ! command -v docker >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
fi
sudo systemctl enable --now docker

# 2. Add invoking user to docker group (effective on next login)
if id -nG "$USER" | grep -qvw docker; then
  sudo usermod -aG docker "$USER"
  echo "NOTE: '$USER' added to 'docker' group. Log out + back in (or 'newgrp docker') to use docker without sudo."
fi

# 3. docker login
if [ "$SKIP_LOGIN" = false ]; then
  user="${DOCKERHUB_USER:-}"
  token="${DOCKERHUB_TOKEN:-}"
  if [ -z "$user" ]; then read -rp "Docker Hub username: " user; fi
  if [ -z "$token" ]; then read -rsp "Docker Hub access token: " token; echo; fi
  if [ -z "$user" ] || [ -z "$token" ]; then
    echo "ERROR: empty user or token; refusing to login." >&2; exit 4
  fi
  echo "$token" | sudo docker login --username "$user" --password-stdin
fi

# 4. Verify
docker_ver=$(sudo docker version --format '{{.Server.Version}}' 2>/dev/null || true)
if [ -z "$docker_ver" ]; then
  echo "ERROR: docker daemon not running after install" >&2; exit 3
fi
echo "Build host ready. Docker $docker_ver, $([ "$SKIP_LOGIN" = true ] && echo 'login skipped' || echo "logged in as $user")."
