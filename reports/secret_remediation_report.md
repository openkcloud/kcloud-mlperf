> Note: ETRI takeover migration 2026-05-12 — directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# Security Audit: Secret Remediation Report

## Executive Summary

This audit inventories plaintext secrets found in committed files and proposes remediation steps. **Critical finding: Ansible credentials are hardcoded in kubespray/inventory/etri/hosts.yml, a file that may be version-controlled or shared.** All other secrets are properly gitignored or stored outside the repo.

**Severity levels:**
- **HIGH**: Committed to public repository (if published) or shared without encryption
- **MEDIUM**: Committed to private repository with limited access
- **LOW**: Local-only files or examples, no actual credentials

---

## Inventory of Plaintext Secrets

### 1. Ansible Credentials in Kubespray Inventory

**File**: `kubespray/inventory/etri/hosts.yml`  
**Lines**: 7, 8, 14, 15, 22, 23, 30, 31  
**Severity**: **HIGH** if shared; **MEDIUM** if private repo only  
**Status**: **FOUND AND ACTIVE**

```yaml
# Line 7-8:
ansible_password: "<SUDO_PASS>"
ansible_become_password: "<SUDO_PASS>"

# Repeated for node2, node3, node4
```

**Risk**: Ansible runs kubespray (Kubernetes deployment automation) with these credentials. If someone gains access to this inventory file, they can:
- SSH into all cluster nodes
- Execute arbitrary commands as root (via ansible_become_password)
- Compromise the entire cluster

**Recommendation**: Migrate to public-key SSH authentication.

### 2. Docker Registry Auth in Helm Values

**File**: `kubernetes/app-chart/values.yaml`  
**Line**: (exact line number to be determined)  
**Severity**: **MEDIUM**  
**Status**: **FOUND (Base64-encoded, not plaintext)**

```yaml
imagePullSecret:
  dockerConfigJson: eyJhdXRocyI6eyJodHRwczovL2luZGV4LmRvY2tlci5pby92MS8iOnsiYXV0aCI6ImFuVnVaM2R2YjNOb2FXMDZaR05yY2w5d1lYUmZOR0ZsVmxSb1VIcHZUMlpZZVdOdWRtaDBhVkY2WnpKWE9UVlIifX19
```

**Decoded content** (do not share):
- Base64-encoded Docker Hub token
- Grants access to pull images from jungwooshim/ registry

**Risk**: If values.yaml is committed to a public repository or shared accidentally, the Docker credentials are exposed. Any attacker can pull (and potentially push) container images.

**Recommendation**: Use Kubernetes Secret objects or External Secrets Operator instead of embedding in Helm values.

### 3. Credentials Example File

**File**: `config/credentials.example.env`  
**Severity**: **LOW**  
**Status**: **EXAMPLE ONLY (no actual credentials)**

```bash
# This is an example. Real credentials are in .env (gitignored).
export SUDO_PASS=""
export DOCKERHUB_TOKEN=""
export GITHUB_PAT=""
export HUGGINGFACE_TOKEN=""
```

**Risk**: Minimal. This is an example template; actual credentials are in `.env`, which is gitignored.

### 4. Test Configuration

**File**: `config/.env-test`  
**Severity**: **LOW**  
**Status**: **EMPTY / NO SECRETS**

File exists but contains no actual credentials (verified).

---

## Token Leak Detection

### GitHub PAT (Personal Access Token)

**Search**: Grep for `ghp_`, `github_token`, `github_pat`
```bash
grep -r "ghp_\|github_token\|github_pat" /home/kcloud/etri-llm-deployments/app \
  --include="*.yaml" --include="*.yml" --include="*.py" --include="*.sh"
```

**Result**: No GitHub PATs found in committed files. (Repository clones likely use HTTPS with cached credentials in `~/.git-credentials`, not committed.)

### Hugging Face Token

**Search**: Grep for `hf_`, `huggingface_token`
```bash
grep -r "hf_\|huggingface_token" /home/kcloud/etri-llm-deployments/app \
  --include="*.yaml" --include="*.yml" --include="*.sh" --include="*.json"
```

**Result**: No HuggingFace tokens found in committed files. (Model downloads use `huggingface-cli login`, which stores token in `~/.cache/huggingface/token`, not in repo.)

### Docker Hub Token

**Search**: Grep for `dckr_pat_`, `dockerhub_token`, `docker_password`
```bash
grep -r "dckr_pat_\|dockerhub_token\|docker_password" /home/kcloud/etri-llm-deployments/app \
  --include="*.yaml" --include="*.yml"
```

**Result**: Found encoded in `kubernetes/app-chart/values.yaml` (see section 2 above).

---

## Remediation Steps

### IMMEDIATE (Priority 1: Ansible Credentials)

**1a. Rotate Cluster Password**

Generate a new password for the `kcloud` user on all nodes (if password auth is still in use):

```bash
for node in node1 node2 node3 node4; do
  ssh kcloud@<node-ip> passwd kcloud
  # Interactively set new password
done
```

**1b. Migrate to Public-Key SSH (Recommended)**

Generate SSH key pair on operator workstation:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_etri_kcloud -C "etri-llm-cluster"
```

Copy public key to all nodes:
```bash
for node in node1 node2 node3 node4; do
  ssh-copy-id -i ~/.ssh/id_etri_kcloud.pub -p 122 kcloud@<node-ip>
done
```

Update kubespray inventory to remove passwords:
```yaml
# OLD (kubespray/inventory/etri/hosts.yml):
node1:
  ansible_host: 10.254.177.41
  ansible_user: kcloud
  ansible_password: "<SUDO_PASS>"
  ansible_become_password: "<SUDO_PASS>"

# NEW:
node1:
  ansible_host: 10.254.177.41
  ansible_user: kcloud
  ansible_ssh_private_key_file: ~/.ssh/id_etri_kcloud
  # No password or become_password
```

Update sudoers to allow passwordless sudo for kcloud user:
```bash
for node in node1 node2 node3 node4; do
  ssh kcloud@<node-ip> "echo 'kcloud ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/kcloud-nopasswd"
  ssh kcloud@<node-ip> "sudo chmod 0440 /etc/sudoers.d/kcloud-nopasswd"
done
```

**Verification**: Re-run kubespray with the updated inventory:
```bash
cd kubespray
ansible-playbook -i inventory/etri/hosts.yml cluster.yml --check
# Should succeed without prompting for passwords
```

### MEDIUM PRIORITY (Priority 2: Docker Registry Credentials)

**2a. Migrate to Kubernetes Secret**

Create a secret object instead of embedding in Helm values:

```bash
kubectl create secret docker-registry image-pull-secret \
  --docker-username=jungwooshim \
  --docker-password=<DOCKERHUB_TOKEN> \
  --docker-server=https://index.docker.io/v1/ \
  -n llm-evaluation \
  --dry-run=client -o yaml | kubectl apply -f -
```

**2b. Update Helm Values**

Remove the `dockerConfigJson` from `kubernetes/app-chart/values.yaml`:

```yaml
# OLD:
imagePullSecret:
  dockerConfigJson: eyJhdXRocyI6e...}

# NEW:
imagePullSecret:
  create: false  # Use existing secret instead
  name: image-pull-secret  # Reference the Kubernetes secret created above
```

**2c. Update Helm Template**

Modify `kubernetes/app-chart/templates/deployment.yaml` to reference the secret:

```yaml
imagePullSecrets:
  - name: image-pull-secret  # Matches the secret created in step 2a
```

**2d. Rotate Docker Token**

Generate a new Docker Hub PAT:
1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Select "Read, Write, Delete" permissions
4. Copy the token
5. Update the Kubernetes secret:
   ```bash
   kubectl delete secret image-pull-secret -n llm-evaluation
   kubectl create secret docker-registry image-pull-secret \
     --docker-username=jungwooshim \
     --docker-password=<NEW_TOKEN> \
     --docker-server=https://index.docker.io/v1/ \
     -n llm-evaluation
   ```

**Optional: Use External Secrets Operator (ESO)**

For production, use ESO to manage secrets from an external vault:

```yaml
# kubernetes/app-chart/templates/external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: dockerhub-secret
  namespace: llm-evaluation
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault  # or 'aws-secrets', 'azure-keyvault', etc.
    kind: SecretStore
  target:
    name: image-pull-secret
    creationPolicy: Owner
  data:
    - secretKey: .dockerconfigjson
      remoteRef:
        key: dockerhub-credentials
```

---

## Future-Prevention Measures

### 1. Pre-Commit Hook (gitleaks)

Install and configure `gitleaks` to prevent secrets from being committed:

```bash
# Install (via brew on macOS, or apt on Ubuntu)
brew install gitleaks

# Add to .pre-commit-config.yaml:
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
        name: "gitleaks: detect secret leaks"
        description: Detect secrets using gitleaks
        entry: gitleaks protect --verbose --redact --staged
        language: golang
        stages: [commit]
```

Run pre-commit setup:
```bash
pip install pre-commit
pre-commit install
```

Test:
```bash
# Try to commit a fake secret; pre-commit should block it:
echo "export DOCKERHUB_TOKEN=dckr_pat_fake123" >> .env
git add .env
git commit -m "test"
# Should fail with: "gitleaks: detected 1 leak(s)"
```

### 2. CI/CD Secret Scanning

Add GitHub Actions workflow (if using GitHub):

```yaml
# .github/workflows/secret-scan.yml
name: Secret Scan

on: [pull_request, push]

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        with:
          redact: true
          fail: true
```

### 3. .gitignore Enhancements

Ensure critical files are never committed:

```bash
# Already in .gitignore (verified):
.env
config/.env
kubeconfig/admin.conf
kubeconfig/config
kubernetes/kubeconfig/admin.conf

# Recommend adding:
# Kubernetes secrets exports
**/secrets-*.yaml
**/*-secret.yaml

# Helm values with secrets
**/values-secret.yaml
**/values-prod.yaml

# Docker credentials
~/.docker/config.json
.dockercfg

# SSH keys
**/ssh_keys/
**/.ssh/
*.pem
*.key
```

### 4. Audit Commits for Leaks

Scan git history for any leaked secrets:

```bash
# Find all commits that modified .env or secrets files:
git log --all --source --oneline -- '.env' 'config/.env' 'config/credentials.example.env'

# Inspect a commit to see if secrets were added:
git show <commit-hash>

# If secrets were found, rewrite history (use with caution):
git filter-branch --tree-filter 'rm -f .env' HEAD
git push --force-with-lease
```

---

## Summary Table

| Category | Severity | Location | Status | Remediation |
|----------|----------|----------|--------|-------------|
| **Ansible SSH Password** | HIGH | `kubespray/inventory/etri/hosts.yml` (lines 7-8, 14-15, 22-23, 30-31) | **FOUND** | Migrate to public-key SSH; remove password entries |
| **Ansible Become Password** | HIGH | Same file (same lines) | **FOUND** | Configure passwordless sudo; remove become_password |
| **Docker Registry Token** | MEDIUM | `kubernetes/app-chart/values.yaml` | **FOUND (Base64)** | Move to Kubernetes Secret; rotate token |
| **GitHub PAT** | — | N/A | **NOT FOUND** | N/A |
| **HuggingFace Token** | — | N/A | **NOT FOUND** | N/A |
| **Test Credentials** | LOW | `config/.env-test` | **EMPTY** | N/A |
| **Credentials Example** | LOW | `config/credentials.example.env` | **EXAMPLE** | Already properly separated from real credentials |

---

## Implementation Timeline

| Phase | Tasks | Duration | Owner |
|-------|-------|----------|-------|
| **Phase 1 (Week 1)** | Rotate ansible password; generate SSH keys; test SSH auth | 2–3 days | Ops |
| **Phase 2 (Week 1–2)** | Update kubespray inventory; migrate to public-key auth | 1–2 days | Ops |
| **Phase 3 (Week 2)** | Migrate Docker credentials to Kubernetes Secret | 1 day | Ops |
| **Phase 4 (Week 2)** | Deploy gitleaks pre-commit hook to all developer workstations | 1 day | Eng |
| **Phase 5 (Week 3)** | Add secret-scan GitHub Action to CI/CD pipeline | 1 day | Eng |
| **Phase 6 (Ongoing)** | Monitor gitleaks alerts; audit git history monthly | Continuous | Security |

---

## Compliance Notes

- **OWASP**: Aligns with A02:2021 – Cryptographic Failures (no plaintext secrets in version control)
- **CIS Kubernetes Benchmark**: Recommendation 5.2.3 (Minimize access to secrets)
- **SOC 2**: Criterion CC6.2 (Implement logical and physical access controls)

---

## Appendix: Command Reference

### Quick Secret Rotation

```bash
# 1. Rotate all node passwords:
for node in node1 node2 node3 node4; do
  ssh kcloud@<node-ip> -p 122 "sudo passwd kcloud"
done

# 2. Generate SSH key:
ssh-keygen -t ed25519 -f ~/.ssh/id_etri_kcloud -N ""

# 3. Distribute public key:
for node in node1 node2 node3 node4; do
  ssh-copy-id -i ~/.ssh/id_etri_kcloud.pub -p 122 kcloud@<node-ip>
done

# 4. Update kubespray inventory:
sed -i 's/ansible_password: .*//' kubespray/inventory/etri/hosts.yml
sed -i 's/ansible_become_password: .*//' kubespray/inventory/etri/hosts.yml

# 5. Rotate Docker token:
# Go to https://hub.docker.com/settings/security and create a new token
kubectl delete secret image-pull-secret -n llm-evaluation 2>/dev/null || true
kubectl create secret docker-registry image-pull-secret \
  --docker-username=jungwooshim \
  --docker-password=<NEW_DOCKER_TOKEN> \
  --docker-server=https://index.docker.io/v1/ \
  -n llm-evaluation
```

### Pre-Commit Hook Installation

```bash
cd /home/kcloud/etri-llm-deployments/app
pip install pre-commit
cat > .pre-commit-config.yaml <<EOF
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
        name: gitleaks
        entry: gitleaks protect --verbose --redact --staged
        language: golang
        stages: [commit]
EOF

pre-commit install
```

### Verify Secret Removal

```bash
# Scan entire git history for secrets:
gitleaks detect --source=git --verbose --redact

# Scan specific file:
gitleaks detect --source=git --verbose --redact -l kubespray/inventory/etri/hosts.yml
```
