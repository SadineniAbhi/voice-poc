variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "project-2026-486210"
}

variable "region" {
  description = "GCP region. Keep this one of us-central1 / us-west1 / us-east1 to stay Always-Free eligible."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "VM machine type. e2-micro is Google's Always Free tier machine type (1 per billing account, in a free-tier region)."
  type        = string
  default     = "e2-micro"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB. 30GB standard persistent disk is covered by Always Free."
  type        = number
  default     = 30
}

variable "vm_name" {
  description = "Name of the compute instance"
  type        = string
  default     = "voice-poc-vm"
}

variable "ssh_username" {
  description = "Linux username created on the VM for SSH access"
  type        = string
  default     = "abhi"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key installed on the VM"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "domain_name" {
  description = "Domain that will point at the VM's static IP (used for TLS)"
  type        = string
  default     = "voice.sadineni.in"
}

variable "letsencrypt_email" {
  description = "Email used for Let's Encrypt registration and renewal notices"
  type        = string
  default     = "sadineniabhi@gmail.com"
}

variable "github_repo_url" {
  description = "Git URL cloned onto the VM on first boot"
  type        = string
  default     = "https://github.com/SadineniAbhi/voice-poc.git"
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH into the VM"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
