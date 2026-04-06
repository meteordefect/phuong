terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

variable "hcloud_token" {
  description = "Hetzner Cloud API Token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key for server access (can be key string or path to .pub file)"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "use_existing_ssh_key" {
  description = "Use existing SSH key from Hetzner instead of creating new one"
  type        = string
  default     = ""
}

variable "server_name" {
  description = "Name of the server"
  type        = string
  default     = "phuong-control-plane"
}

variable "server_type" {
  description = "Server type (CX22, CX32, etc.)"
  type        = string
  default     = "cx22"
}

variable "location" {
  description = "Server location"
  type        = string
  default     = "nbg1"
}

provider "hcloud" {
  token = var.hcloud_token
}

locals {
  # Try to read SSH key from file if it looks like a path, otherwise use as-is
  ssh_key_content = fileexists(pathexpand(var.ssh_public_key)) ? file(pathexpand(var.ssh_public_key)) : var.ssh_public_key
  use_new_key     = var.use_existing_ssh_key == ""
}

# Use existing SSH key if specified
data "hcloud_ssh_key" "existing" {
  count = var.use_existing_ssh_key != "" ? 1 : 0
  name  = var.use_existing_ssh_key
}

# Create new SSH key only if not using existing
resource "hcloud_ssh_key" "default" {
  count      = local.use_new_key ? 1 : 0
  name       = "phuong-key-${formatdate("YYYYMMDD-hhmm", timestamp())}"
  public_key = local.ssh_key_content
  
  lifecycle {
    ignore_changes = [name]
  }
}

resource "hcloud_server" "control_plane" {
  name        = var.server_name
  server_type = var.server_type
  location    = var.location
  image       = "ubuntu-24.04"
  ssh_keys    = local.use_new_key ? [hcloud_ssh_key.default[0].id] : [data.hcloud_ssh_key.existing[0].id]

  labels = {
    project     = "phuong"
    environment = "production"
    version     = "v3"
  }

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}

resource "hcloud_firewall" "control_plane" {
  name = "phuong-firewall"

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall_attachment" "control_plane" {
  firewall_id = hcloud_firewall.control_plane.id
  server_ids  = [hcloud_server.control_plane.id]
}

output "server_ip" {
  value       = hcloud_server.control_plane.ipv4_address
  description = "Public IPv4 address of the control plane server"
}

output "server_id" {
  value       = hcloud_server.control_plane.id
  description = "Server ID"
}
