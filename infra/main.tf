terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Reserved while attached to a running instance = free. Only costs money if
# reserved but left unattached, so don't `terraform destroy` the instance
# without also releasing this.
resource "google_compute_address" "static_ip" {
  name   = "${var.vm_name}-ip"
  region = var.region
}

resource "google_compute_firewall" "allow_ssh" {
  name    = "${var.vm_name}-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.ssh_source_ranges
  target_tags   = ["voice-poc"]
}

resource "google_compute_firewall" "allow_web" {
  name    = "${var.vm_name}-allow-web"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["voice-poc"]
}

resource "google_compute_instance" "app" {
  name         = var.vm_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["voice-poc"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-standard" # cheapest disk type, and the one Always Free covers
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.static_ip.address
    }
  }

  metadata = {
    ssh-keys = "${var.ssh_username}:${file(var.ssh_public_key_path)}"
  }

  metadata_startup_script = templatefile("${path.module}/templates/startup.sh.tpl", {
    github_repo_url = var.github_repo_url
    domain_name     = var.domain_name
    ssh_username    = var.ssh_username
  })

  scheduling {
    automatic_restart = true
    preemptible        = false # keep it non-preemptible: this holds a stateful Postgres
  }

  allow_stopping_for_update = true
}
