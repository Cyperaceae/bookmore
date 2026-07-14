# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-07-14

### Added

- Added support for Goodreads multi-language URLs (e.g. `/en/book/*`, `/de/book/*`, and any locale-prefixed URLs).
- Implemented automatic dynamic remote mirror synchronization when the options/settings page is opened for the first time.
- Integrated a robust `cleanTitle()` utility to strip newlines, consolidate double spaces, and decode any lingering URL or HTML entity strings prior to copying to clipboard or searching, resolving rare Libby copy-paste character bugs.

### Changed

- Replaced old `innerHTML`-based HTML entity decoding with safe, standards-compliant `DOMParser` parsing across all extension and userscript targets.
- Rewrote `chrome/options.js` to eliminate all occurrences of `innerHTML`, refactoring to strictly safe DOM node creation APIs.
- Streamlined `tampermonkey/bookmore.user.js` to dynamically obtain its version from headers using `GM_info.script.version` rather than hardcoding it.
- Upgraded and simplified the global release version synchronization script `sync-version.js` to unify versions across all channels.

### Removed

- Cleaned up unused local variables and storage keys (`STORAGE_KEYS`) from content scripts.
- Merged duplicate `chrome.runtime.onInstalled` listeners in Chrome background worker.

[Unreleased]: https://github.com/Cyperaceae/bookmore/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/Cyperaceae/bookmore/releases/tag/v2.3.0
