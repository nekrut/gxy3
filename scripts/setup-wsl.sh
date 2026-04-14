#!/usr/bin/env bash
# gxy3 WSL2 setup script
# Run this INSIDE an Ubuntu WSL2 instance on Windows.
#
# Prerequisites (run in PowerShell as Administrator first):
#   wsl --install -d Ubuntu
#   # Reboot, then open Ubuntu from Start menu and set up your user.
#
# Then inside Ubuntu/WSL2:
#   curl -fsSL https://raw.githubusercontent.com/nekrut/gxy3/master/scripts/setup-wsl.sh | bash

set -euo pipefail

echo "=== gxy3 WSL2 Setup ==="
echo ""

# ── Check we're in WSL2 ──────────────────────────────────────────────────────
if ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "WARNING: This doesn't look like WSL2. Script is designed for WSL2 on Windows."
  echo "On native Linux, just run: cd gxy3/app && npm install && npm start"
  read -rp "Continue anyway? [y/N] " yn
  [[ "$yn" =~ ^[Yy] ]] || exit 0
fi

# ── Electron system libraries ────────────────────────────────────────────────
# Electron needs libnss3, GTK, ALSA, etc. WSL2 Ubuntu ships minimal, so install them.
# Ubuntu 24.04 renamed several packages with a t64 suffix (time_t transition); try
# t64 names first, fall back to plain names for older releases.
echo "Installing Electron system libraries (requires sudo)..."
sudo apt-get update
DEPS_COMMON=(libnss3 libgbm1 libxss1 libxcomposite1 libxdamage1 libxrandr2 libdrm2 libxkbcommon0 libpango-1.0-0 libcairo2)
sudo apt-get install -y "${DEPS_COMMON[@]}"
DEPS_T64=(libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgtk-3-0t64 libasound2t64)
DEPS_PLAIN=(libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libasound2)
if ! sudo apt-get install -y "${DEPS_T64[@]}" 2>/dev/null; then
  sudo apt-get install -y "${DEPS_PLAIN[@]}"
fi
echo ""

# ── Node.js via nvm ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  echo ""
else
  echo "Node.js $(node --version) found."
fi

# ── Conda/Mamba via Miniforge ────────────────────────────────────────────────
if ! command -v conda &>/dev/null && ! command -v mamba &>/dev/null; then
  echo "Installing Miniforge (conda + mamba)..."
  MINIFORGE="Miniforge3-Linux-x86_64.sh"
  curl -fsSL "https://github.com/conda-forge/miniforge/releases/latest/download/$MINIFORGE" -o "/tmp/$MINIFORGE"
  bash "/tmp/$MINIFORGE" -b -p "$HOME/miniforge3"
  rm "/tmp/$MINIFORGE"
  eval "$("$HOME/miniforge3/bin/conda" shell.bash hook)"
  conda init bash
  echo ""
  echo "Miniforge installed. Restart your shell or run: source ~/.bashrc"
else
  echo "Conda/Mamba found."
fi

# ── Clone gxy3 ───────────────────────────────────────────────────────────────
GXY3_DIR="$HOME/gxy3"
if [ ! -d "$GXY3_DIR" ]; then
  echo "Cloning gxy3..."
  git clone https://github.com/nekrut/gxy3.git "$GXY3_DIR"
else
  echo "gxy3 already cloned at $GXY3_DIR"
fi

# ── Install npm dependencies ─────────────────────────────────────────────────
echo "Installing npm dependencies..."
cd "$GXY3_DIR"
npm install
cd "$GXY3_DIR/app"
npm install

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start gxy3:"
echo "  cd ~/gxy3/app && npm start"
echo ""
echo "Notes:"
echo "  - WSLg provides the display automatically (Windows 11 / updated Windows 10)"
echo "  - Keep your analysis data inside WSL2 (~/) for best file I/O performance"
echo "  - Avoid working on /mnt/c/ paths — cross-filesystem access is slow"
