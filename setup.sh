#!/usr/bin/env bash
set -euo pipefail

echo "=== NetRun Setup ==="

# --- Homebrew ---
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# --- Python 3.11 ---
if ! brew list python@3.11 &>/dev/null; then
  echo "Installing Python 3.11..."
  brew install python@3.11
fi
PYTHON="$(brew --prefix python@3.11)/bin/python3.11"

# --- uv ---
if ! command -v uv &>/dev/null; then
  echo "Installing uv..."
  brew install uv
fi

# --- Node.js ---
if ! command -v node &>/dev/null; then
  echo "Installing Node.js..."
  brew install node
fi

# --- Ollama (optional) ---
if ! command -v ollama &>/dev/null; then
  echo "Installing Ollama..."
  brew install ollama
fi

# --- Python venv ---
echo "Creating Python 3.11 venv..."
uv venv --python "$PYTHON" venv
echo "Installing Python dependencies..."
uv pip install --python venv/bin/python -r requirements.txt

# --- Node dependencies ---
echo "Installing Node dependencies..."
npm install

# --- Ollama models ---
echo ""
echo "Setup complete! Optional: pull Ollama models for AI features:"
echo "  brew services start ollama"
echo "  ollama pull qwen2.5:1.5b"
echo "  ollama pull nomic-embed-text"
echo ""
echo "Run the app with: npm start"
