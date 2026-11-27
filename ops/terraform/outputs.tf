output "database_hosts" {
  description = "Private and public host per environment (no credentials)."
  value       = { for k, c in digitalocean_database_cluster.pg : k => { host = c.host, private_host = c.private_host, port = c.port } }
}

output "buckets" {
  value = { for k, b in digitalocean_spaces_bucket.uploads : k => b.name }
}

output "spaces_keys" {
  description = "Per-bucket keys for CLEARLINE_S3_ACCESS_KEY_ID / CLEARLINE_S3_SECRET_ACCESS_KEY. Read with `terraform output -json spaces_keys` into the password manager, then into the app spec's SECRET values; never paste into chat or commit."
  value       = { for k, s in digitalocean_spaces_key.uploads : k => { access_key = s.access_key, secret_key = s.secret_key } }
  sensitive   = true
}

output "registry" {
  value = digitalocean_container_registry.clearline.endpoint
}
