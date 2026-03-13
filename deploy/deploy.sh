#!/usr/bin/env bash
set -e

# Phoung v4 - Deployment Script
# Usage: ./deploy.sh [command]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/friendlabs-deploy}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if .env exists
check_env() {
    if [ ! -f .env ]; then
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and configure it:"
        log_info "  cp .env.example .env"
        exit 1
    fi
}

# Load environment variables
load_env() {
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi
}

# Terraform commands
cmd_terraform_init() {
    log_info "Initializing Terraform..."
    cd terraform
    terraform init
    cd ..
    log_success "Terraform initialized"
}

cmd_terraform_plan() {
    log_info "Planning Terraform changes..."
    cd terraform
    terraform plan
    cd ..
}

cmd_terraform_apply() {
    log_info "Applying Terraform configuration..."
    cd terraform
    terraform apply
    
    # Get server IP
    SERVER_IP=$(terraform output -raw server_ip)
    log_success "Server provisioned at IP: $SERVER_IP"
    
    # Update Ansible inventory
    cd ../ansible
    if [ ! -f inventory.ini ]; then
        cp inventory.ini.example inventory.ini
    fi
    sed -i.bak "s/ansible_host=.*/ansible_host=$SERVER_IP/" inventory.ini
    log_success "Ansible inventory updated"
    cd ..
}

cmd_terraform_destroy() {
    log_warn "This will destroy all infrastructure!"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        cd terraform
        terraform destroy
        cd ..
        log_success "Infrastructure destroyed"
    else
        log_info "Cancelled"
    fi
}

# Ansible commands
cmd_ansible_deploy() {
    check_env
    load_env
    log_info "Deploying with Ansible..."
    cd ansible
    ansible-playbook playbooks/site.yml
    cd ..
    log_success "Deployment complete"
}

cmd_ansible_status() {
    log_info "Checking system status..."
    cd ansible
    ansible-playbook playbooks/status.yml
    cd ..
}

cmd_ansible_backup() {
    check_env
    load_env
    log_info "Creating backup..."
    cd ansible
    ansible-playbook playbooks/backup.yml
    cd ..
    log_success "Backup complete"
}

cmd_ansible_migrate() {
    log_info "Running database migrations..."
    cd ansible
    ansible-playbook playbooks/db-migrate.yml
    cd ..
    log_success "Migrations complete"
}

# Combined commands
cmd_init() {
    log_info "Initializing Phoung Control Plane from scratch..."
    
    check_env
    
    log_info "Step 1: Terraform Init"
    if [ -d terraform/.terraform ]; then
        log_info "Terraform already initialized, skipping init"
    else
        cmd_terraform_init
    fi

    log_info "Step 2: Provision Infrastructure"
    cmd_terraform_apply
    
    log_info "Step 3: Wait for SSH to become available..."
    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    for i in $(seq 1 24); do
        if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@$SERVER_IP exit 2>/dev/null; then
            log_success "SSH ready"
            break
        fi
        log_info "Waiting for SSH... ($((i*5))s)"
        sleep 5
    done

    log_info "Step 4: Deploy Services"
    cmd_ansible_deploy

    log_info "Step 5: Run Database Migrations"
    cmd_ansible_migrate

    log_success "Phoung v4 Control Plane is ready!"
    log_info "Open dashboard via SSH tunnel: ./deploy.sh tunnel"
}

cmd_full() {
    log_info "Full redeploy (Terraform + Ansible)..."
    cmd_terraform_plan
    cmd_terraform_apply
    sleep 10
    cmd_ansible_deploy
}

cmd_config() {
    log_info "Updating configuration only..."
    cmd_ansible_deploy
}

cmd_api() {
    log_info "Updating Control API only..."
    cd ansible
    ansible control_plane -m shell -a "cd /opt/phoung && docker compose restart control-api"
    cd ..
    log_success "Control API restarted"
}

cmd_dashboard() {
    log_info "Updating Dashboard only..."
    cd ansible
    ansible control_plane -m shell -a "cd /opt/phoung && docker compose restart dashboard"
    cd ..
    log_success "Dashboard restarted"
}

cmd_nginx() {
    log_info "Updating Nginx configuration..."
    cd ansible
    ansible-playbook playbooks/site.yml --tags nginx
    cd ..
    log_success "Nginx updated"
}

cmd_deploy_v2() {
    if [ -f ../.env ]; then
        export $(grep -v '^#' ../.env | grep -v '^$' | xargs)
    fi
    if [ -f .env ]; then
        export $(grep -v '^#' .env | grep -v '^$' | xargs)
    fi

    if [ -z "$KIMI_API_KEY" ] && [ -z "$ZAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
        log_error "No LLM API key found. Set at least one of KIMI_API_KEY, ZAI_API_KEY, or ANTHROPIC_API_KEY."
        log_info "Copy .env.example to .env and fill in your keys:"
        log_info "  cp ../.env.example ../.env"
        exit 1
    fi

    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found at ansible/inventory.ini"
        log_info "Create it from the example:"
        log_info "  cp ansible/inventory.ini.example ansible/inventory.ini"
        log_info "  # Then edit ansible/inventory.ini and set your server IP"
        exit 1
    fi

    log_info "Deploying Phoung v2..."
    cd ansible
    ansible-playbook playbooks/deploy-v2.yml
    cd ..
    log_success "Phoung v2 deployed!"
    log_info "Open dashboard via SSH tunnel: ./deploy.sh tunnel"
}

cmd_tunnel() {
    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found. Run 'deploy.sh init' first."
        exit 1
    fi

    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    log_info "Opening SSH tunnel → $SERVER_IP"
    log_success "Dashboard: http://localhost:8080"
    log_info "Press Ctrl+C to close tunnel"
    echo ""
    ssh -i "$SSH_KEY" -N -L 8080:127.0.0.1:8080 root@$SERVER_IP
}

cmd_ssh() {
    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found. Run 'deploy.sh init' first."
        exit 1
    fi
    
    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    log_info "Connecting to $SERVER_IP..."
    ssh -i "$SSH_KEY" root@$SERVER_IP
}

cmd_logs() {
    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found. Run 'deploy.sh init' first."
        exit 1
    fi
    
    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    log_info "Fetching logs from $SERVER_IP..."
    ssh -i "$SSH_KEY" root@$SERVER_IP "cd /opt/phoung && docker compose logs -f --tail=100"
}

cmd_build_openclaw() {
    log_info "Building OpenClaw image from source..."
    check_env
    load_env
    
    cd ../openclaw-source
    
    if [ "$OPENCLAW_VERSION" = "latest" ]; then
        log_info "Pulling latest from main branch..."
        git pull origin main
    else
        log_info "Checking out tag: $OPENCLAW_VERSION"
        git fetch --tags
        git checkout "$OPENCLAW_VERSION"
    fi
    
    log_info "Building Docker image..."
    docker build -t openclaw/openclaw:${OPENCLAW_VERSION} .
    
    cd ../deploy
    log_success "OpenClaw image built: openclaw/openclaw:${OPENCLAW_VERSION}"
}

# Agent Bridge commands (local deployment)
cmd_agent_bridge_build() {
    log_info "Building agent bridge image..."
    docker compose build agent-bridge
    log_success "Agent bridge image built"
}

cmd_agent_bridge_start() {
    log_info "Starting agent bridge (local)..."
    check_env
    docker compose --profile agent-bridge up -d agent-bridge
    log_success "Agent bridge started"
    log_info "View logs: ./deploy.sh agent-bridge-logs"
}

cmd_agent_bridge_stop() {
    log_info "Stopping agent bridge..."
    docker compose stop agent-bridge
    log_success "Agent bridge stopped"
}

cmd_agent_bridge_restart() {
    log_info "Restarting agent bridge..."
    docker compose restart agent-bridge
    log_success "Agent bridge restarted"
}

cmd_agent_bridge_logs() {
    log_info "Showing agent bridge logs (Ctrl+C to exit)..."
    docker compose logs -f agent-bridge
}

cmd_agent_bridge_status() {
    log_info "Agent bridge status:"
    docker compose ps agent-bridge
    echo ""
    log_info "Recent logs:"
    docker compose logs --tail=20 agent-bridge
}

# Remote agent bridge deployment (via Ansible)
cmd_agent_bridge_deploy() {
    log_info "Deploying agent bridge to remote server..."
    check_env
    load_env
    cd ansible
    ansible-playbook playbooks/site.yml --tags agent-bridge
    cd ..
    log_success "Agent bridge deployed to remote server"
}

cmd_agent_bridge_remote_logs() {
    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found. Run 'deploy.sh init' first."
        exit 1
    fi
    
    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    log_info "Fetching agent bridge logs from $SERVER_IP..."
    ssh -i "$SSH_KEY" root@$SERVER_IP "cd /opt/phoung && docker compose logs -f agent-bridge"
}

cmd_agent_bridge_remote_status() {
    if [ ! -f ansible/inventory.ini ]; then
        log_error "Ansible inventory not found. Run 'deploy.sh init' first."
        exit 1
    fi
    
    SERVER_IP=$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2)
    log_info "Checking agent bridge status on $SERVER_IP..."
    ssh -i "$SSH_KEY" root@$SERVER_IP "cd /opt/phoung && docker compose ps agent-bridge"
}

cmd_list_agents() {
    log_info "Fetching registered agents..."
    check_env
    load_env

    # Call control API to list agents
    curl -s http://localhost:3001/api/agents | python3 -m json.tool || log_error "Failed to fetch agents"
}

# OpenClaw Gateway commands (for chat feature)
cmd_gateway_start() {
    log_info "Starting OpenClaw gateway (for dashboard chat)..."
    check_env
    load_env
    docker compose --profile openclaw-gateway up -d openclaw-gateway
    log_success "OpenClaw gateway started"
    log_info "View logs: ./deploy.sh gateway-logs"
}

cmd_gateway_stop() {
    log_info "Stopping OpenClaw gateway..."
    docker compose stop openclaw-gateway
    log_success "OpenClaw gateway stopped"
}

cmd_gateway_restart() {
    log_info "Restarting OpenClaw gateway..."
    docker compose restart openclaw-gateway
    log_success "OpenClaw gateway restarted"
}

cmd_gateway_logs() {
    log_info "Showing OpenClaw gateway logs (Ctrl+C to exit)..."
    docker compose logs -f openclaw-gateway
}

cmd_gateway_status() {
    log_info "OpenClaw gateway status:"
    docker compose ps openclaw-gateway
    echo ""
    log_info "Health check:"
    curl -s http://localhost:18789/health | python3 -m json.tool || log_warn "Gateway may not be running"
    echo ""
    log_info "Recent logs:"
    docker compose logs --tail=20 openclaw-gateway
}

cmd_destroy() {
    log_warn "This will destroy ALL infrastructure and data!"
    read -p "Type 'destroy' to confirm: " confirm
    if [ "$confirm" = "destroy" ]; then
        cmd_terraform_destroy
    else
        log_info "Cancelled"
    fi
}

cmd_setup_ssl() {
    log_info "Running SSL setup..."
    ./setup-ssl.sh
}

cmd_renew_ssl() {
    check_env
    load_env
    log_info "Renewing SSL certificates..."
    ssh -i ~/.ssh/friendlabs-deploy root@$(grep ansible_host ansible/inventory.ini | cut -d'=' -f2) "certbot renew --quiet && systemctl reload nginx"
    log_success "SSL certificates renewed"
}

cmd_check_ssl() {
    check_env
    load_env
    log_info "Checking SSL certificate..."
    local domain=$(grep "^DOMAIN=" .env | cut -d'=' -f2)
    echo ""
    echo "Domain: $domain"
    echo ""
    if curl -s -I https://$domain 2>&1 | grep -i "ssl\|tls\|certificate" | head -5; then
        echo ""
        log_success "SSL is working!"
    else
        echo ""
        log_warn "Could not verify SSL. Make sure the domain points to the server."
    fi
}

cmd_help() {
    cat <<EOF
${GREEN}Phoung v4 - Deployment Tool${NC}

${BLUE}Usage:${NC}
  ./deploy.sh [command]

${BLUE}Setup Commands:${NC}
  init              Fresh VPS → fully running control plane + agent bridge
  full              Terraform plan + full Ansible redeploy
  
${BLUE}Terraform Commands:${NC}
  terraform-init    Initialize Terraform
  terraform-plan    Plan infrastructure changes
  terraform-apply   Apply infrastructure changes
  terraform-destroy Destroy all infrastructure

${BLUE}Phoung v2 (Recommended):${NC}
  deploy-v2         Deploy the v2 stack (api + review-ui + nginx + subagent)

${BLUE}Ansible Commands (v3/v4):${NC}
  deploy            Deploy/update all services via Ansible
  config            Update configuration only
  api               Restart Control API
  dashboard         Restart Dashboard
  nginx             Update Nginx configuration
  migrate           Run database migrations

${BLUE}Agent Bridge - Same Server (VPS):${NC}
  agent-bridge-deploy       Deploy agent bridge to VPS (with control plane)
  agent-bridge-remote-logs  View agent bridge logs on VPS
  agent-bridge-remote-status Check agent bridge status on VPS

${BLUE}Agent Bridge - Local/Different Server:${NC}
  agent-bridge-build    Build agent bridge image (local)
  agent-bridge-start    Start agent bridge service (local)
  agent-bridge-stop     Stop agent bridge service (local)
  agent-bridge-restart  Restart agent bridge service (local)
  agent-bridge-logs     View agent bridge logs (local)
  agent-bridge-status   Check agent bridge status (local)

${BLUE}Agent Management:${NC}
  list-agents           List all registered agents

${BLUE}OpenClaw Gateway (Chat Feature):${NC}
  gateway-start         Start OpenClaw gateway service (local)
  gateway-stop          Stop OpenClaw gateway service
  gateway-restart       Restart OpenClaw gateway service
  gateway-logs          View OpenClaw gateway logs
  gateway-status        Check OpenClaw gateway status
  
${BLUE}Access Commands:${NC}
  tunnel            Open SSH tunnel → http://localhost:8080 (SSH key required)
  ssh               SSH to server
  logs              View server logs

${BLUE}Maintenance Commands:${NC}
  status            Check all services health
  backup            Backup PostgreSQL + workspace files
  build-openclaw    Build OpenClaw image from source

${BLUE}SSL/HTTPS Commands:${NC}
  setup-ssl         Set up SSL certificate for HTTPS
  renew-ssl         Manually renew SSL certificate
  check-ssl         Check SSL certificate status
  
${BLUE}Destructive Commands:${NC}
  destroy           Tear down everything (DESTRUCTIVE)

${BLUE}Fresh Server Setup — v2 (run in order):${NC}
  ${GREEN}# 1. Configure environment (from repo root)${NC}
  cp ../.env.example ../.env && vi ../.env

  ${GREEN}# 2. Set up Ansible inventory${NC}
  cp ansible/inventory.ini.example ansible/inventory.ini
  vi ansible/inventory.ini   # set your server IP

  ${GREEN}# 3. Deploy v2 stack${NC}
  ./deploy.sh deploy-v2

  ${GREEN}# 4. Open dashboard in browser${NC}
  ./deploy.sh tunnel   # then visit http://localhost:8080

${BLUE}Day-to-Day:${NC}
  ${GREEN}# Push code changes to server${NC}
  ./deploy.sh deploy

  ${GREEN}# SSH into server${NC}
  ./deploy.sh ssh

  ${GREEN}# View live logs${NC}
  ./deploy.sh logs

${BLUE}Rebuild from scratch:${NC}
  ${GREEN}# Destroy old server and start fresh${NC}
  ./deploy.sh destroy
  ./deploy.sh init

${YELLOW}Note:${NC} Make sure .env is configured before running any commands.
${YELLOW}SSH:${NC}  Set SSH_KEY env var to override the key path (default: ~/.ssh/friendlabs-deploy).
EOF
}

# Main command router
case "${1:-help}" in
    init)                        cmd_init ;;
    full)                        cmd_full ;;
    terraform-init)              cmd_terraform_init ;;
    terraform-plan)              cmd_terraform_plan ;;
    terraform-apply)             cmd_terraform_apply ;;
    terraform-destroy)           cmd_terraform_destroy ;;
    deploy)                      cmd_ansible_deploy ;;
    deploy-v2)                   cmd_deploy_v2 ;;
    config)                      cmd_config ;;
    api)                         cmd_api ;;
    dashboard)                   cmd_dashboard ;;
    nginx)                       cmd_nginx ;;
    migrate)                     cmd_ansible_migrate ;;
    status)                      cmd_ansible_status ;;
    backup)                      cmd_ansible_backup ;;
    tunnel)                      cmd_tunnel ;;
    ssh)                         cmd_ssh ;;
    logs)                        cmd_logs ;;
    build-openclaw)              cmd_build_openclaw ;;
    agent-bridge-deploy)         cmd_agent_bridge_deploy ;;
    agent-bridge-remote-logs)    cmd_agent_bridge_remote_logs ;;
    agent-bridge-remote-status)  cmd_agent_bridge_remote_status ;;
    agent-bridge-build)          cmd_agent_bridge_build ;;
    agent-bridge-start)          cmd_agent_bridge_start ;;
    agent-bridge-stop)           cmd_agent_bridge_stop ;;
    agent-bridge-restart)        cmd_agent_bridge_restart ;;
    agent-bridge-logs)           cmd_agent_bridge_logs ;;
    agent-bridge-status)         cmd_agent_bridge_status ;;
    list-agents)                 cmd_list_agents ;;
    gateway-start)               cmd_gateway_start ;;
    gateway-stop)                cmd_gateway_stop ;;
    gateway-restart)             cmd_gateway_restart ;;
    gateway-logs)                cmd_gateway_logs ;;
    gateway-status)              cmd_gateway_status ;;
    destroy)                     cmd_destroy ;;
    setup-ssl)                   cmd_setup_ssl ;;
    renew-ssl)                   cmd_renew_ssl ;;
    check-ssl)                   cmd_check_ssl ;;
    help|--help|-h)              cmd_help ;;
    *)
        log_error "Unknown command: $1"
        cmd_help
        exit 1
        ;;
esac
