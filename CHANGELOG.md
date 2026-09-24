# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Claude Code 5h/weekly usage tiles in the status bar, read directly from
  Anthropic's OAuth usage API (account-wide, self-refreshing) with the
  claude-hud plugin's snapshot as fallback for machines with no usable
  Claude Code credentials.
- A "Barra de status" picker in the CONFIG panel to choose which stat
  tiles (CPU/RAM/disk/Claude) show.

### Fixed
- Stat tile visibility no longer gets permanently stuck hidden by a stale
  localStorage whitelist — now stores hidden tiles instead of shown ones,
  so new/returning tiles default to visible.
