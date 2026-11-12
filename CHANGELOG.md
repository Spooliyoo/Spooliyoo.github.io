# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Multi-part prints: tick "several parts" while logging and add each part (name, time, spools) in the same log. History shows one print; its page lists the parts. Older multi-print models are merged automatically.
- Prints menu with the full list; History now shows the last 5 prints and a Recently deleted section (restore or delete forever; kept 30 days).
- New Spooliyoo app icon and logo.

### Changed
- More space below floating buttons (Back up, Save, messages), including the iPhone home-indicator area.
- Print time is entered in separate hour and minute boxes (iPhone keypads have no ":" key).

## [1.0.0]

### Added

- Spools with unique user-defined IDs, colour swatches, tare weight, archive/restore and duplicate.
- Remaining grams derived from logged usage and scale-based weight corrections.
- Print log with multiple spools per print, purge and extra filament, failed prints, and reference photos.
- Live price calculator (filament, electricity, wear, labour, failure buffer, markup) with a per-print rate snapshot and manual price override.
- Dashboard, history with search and filters, low-stock and over-use warnings.
- Settings for default rates, currency, low-stock threshold and theme.
- JSON backup export/import (photos included) with schema versioning; prints CSV export; 30-day backup reminder.
- Installable offline PWA with update prompt and persistent-storage request.
