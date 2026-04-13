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
