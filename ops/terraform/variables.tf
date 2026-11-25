variable "region" {
  description = "DigitalOcean region for every resource (Singapore)."
  type        = string
  default     = "sgp1"
}

variable "environments" {
  description = "Separate environments: each has its own database cluster, bucket, bucket key and App Platform app."
  type        = set(string)
  default     = ["staging", "production"]
}

variable "db_size" {
  description = "Managed PostgreSQL node size per environment (smallest plan with daily backups and 7-day point-in-time restore)."
  type        = map(string)
  default = {
    staging    = "db-s-1vcpu-1gb"
    production = "db-s-1vcpu-1gb"
  }
}

variable "bucket_prefix" {
  description = "Spaces bucket names are global; the bucket is <prefix>-<environment>."
  type        = string
  default     = "clearline-uploads"
}

variable "registry_name" {
  description = "Container registry name (global on DigitalOcean)."
  type        = string
  default     = "clearline"
}

variable "admin_ip_cidrs" {
  description = "The founder's own address(es), allowed to reach the databases for db-bootstrap.sh and the admin CLI. Remove after setup."
  type        = list(string)
  default     = []
}

variable "app_ids" {
  description = "App Platform app id per environment, filled after `doctl apps create` (second apply) so only the app reaches its database."
  type        = map(string)
  default     = {}
}
