variable "REGISTRY" {
  default = "ghcr.io/anarchist-666/dockers"
}

# Rust
target "pterodactyl-rust" {
  context = "./pterodactyl-rust"
  dockerfile = "Dockerfile"
  tags = ["${REGISTRY}:pterodactyl-rust"]
}

# Asterisk
target "pterodactyl-asterisk-22" {
  context = "./pterodactyl-asterisk-22" # Указываем другую папку
  dockerfile = "Dockerfile"
  tags = ["${REGISTRY}:pterodactyl-asterisk-22"]
}

group "default" {
  targets = ["pterodactyl-rust", "pterodactyl-asterisk-22"]
}