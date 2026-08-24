output "vm_public_ip" {
  description = "Static public IP — point your domain's DNS A record here"
  value       = google_compute_address.static_ip.address
}

output "vm_name" {
  value = google_compute_instance.app.name
}

output "ssh_command" {
  value = "ssh ${var.ssh_username}@${google_compute_address.static_ip.address}"
}
