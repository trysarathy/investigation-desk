resource "digitalocean_project" "clearline" {
  name        = "clearline"
  description = "Clearline v1: staging and production (Singapore)"
  purpose     = "Web Application"
  environment = "Production"
  resources = concat(
    [for c in digitalocean_database_cluster.pg : c.urn],
    [for b in digitalocean_spaces_bucket.uploads : b.urn],
  )
}

# ---- PostgreSQL 16, one cluster per environment (never shared) --------------------------------------------------
resource "digitalocean_database_cluster" "pg" {
  for_each   = var.environments
  name       = "clearline-pg-${each.key}"
  engine     = "pg"
  version    = "16"
  size       = var.db_size[each.key]
  region     = var.region
  node_count = 1
  tags       = ["clearline", each.key]

  maintenance_window {
    day  = "sunday"
    hour = "18:00:00" # 02:00 Singapore time
  }

  lifecycle {
    prevent_destroy = true # deleting a cluster deletes its backups and point-in-time history
  }
}

# Only the environment's own app (after the second apply) and the founder's listed addresses may connect.
resource "digitalocean_database_firewall" "pg" {
  for_each   = var.environments
  cluster_id = digitalocean_database_cluster.pg[each.key].id

  dynamic "rule" {
    for_each = contains(keys(var.app_ids), each.key) ? [var.app_ids[each.key]] : []
    content {
      type  = "app"
      value = rule.value
    }
  }
  dynamic "rule" {
    for_each = toset(var.admin_ip_cidrs)
    content {
      type  = "ip_addr"
      value = rule.value
    }
  }
}

# ---- Uploads: one private bucket per environment ----------------------------------------------------------------
# Objects are already AES-256-GCM sealed by the app (CLEARLINE_UPLOAD_KEY); the bucket is private, without versioning,
# so the app's retention delete really deletes. No public access, no CDN.
resource "digitalocean_spaces_bucket" "uploads" {
  for_each      = var.environments
  name          = "${var.bucket_prefix}-${each.key}"
  region        = var.region
  acl           = "private"
  force_destroy = false

  versioning {
    enabled = false
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 1
  }
}

# A key that can read and write ONLY its own environment's bucket (staging cannot touch production files).
resource "digitalocean_spaces_key" "uploads" {
  for_each = var.environments
  name     = "clearline-uploads-${each.key}"
  grant {
    bucket     = digitalocean_spaces_bucket.uploads[each.key].name
    permission = "readwrite"
  }
}

# ---- Container registry (one image, promoted from staging to production by sha) ---------------------------------
resource "digitalocean_container_registry" "clearline" {
  name                   = var.registry_name
  subscription_tier_slug = "basic"
  region                 = var.region
}
