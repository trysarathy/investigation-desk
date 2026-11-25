# v1 phase 6: DigitalOcean infrastructure for Clearline (Singapore, sgp1). NOT APPLIED: the founder runs it after
# deciding (docs/ops/HOSTING_PROPOSAL.md, "Provisioning"). State stays LOCAL on the founder's encrypted disk (it holds
# the Spaces keys); never commit it (.gitignore) and never use a shared remote state without encryption.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.50"
    }
  }
}

# The token comes from DIGITALOCEAN_TOKEN; Spaces keys for the bucket API from SPACES_ACCESS_KEY_ID and
# SPACES_SECRET_ACCESS_KEY (an admin Spaces key the founder creates once in the console for Terraform only).
provider "digitalocean" {}
