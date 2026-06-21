# Changelog

All notable changes to this project will be documented in this file.

## [1.0.55] - 2026-06-21

### Changed
- Optimized backend database query performance:
  - Restricted transaction loading in budget status calculations to only search within active budget date ranges (e.g. current year/month/custom ranges) rather than retrieving the entire history.
  - Optimized account balance queries to select only necessary columns (`amount`, `from_account_id`, `to_account_id`) to bypass expensive SQLAlchemy object hydration overhead.
  - Optimized paycheck prediction queries by fetching only required columns.
  - Resulted in a 5x to 15x speedup for dashboard stats and accounts endpoints, dropping reload times to under 100ms.

## [1.0.54] - 2026-06-21

### Changed
- Optimized Nginx configuration (`nginx.conf`) for Docker image / Unraid setups:
  - Enabled HTTP Keep-Alive for API routes by dynamically mapping the connection upgrade header.
  - Disabled Nginx proxy buffering (`proxy_buffering off;`) to avoid writing large API responses to disk, resolving major UI latency issues on Unraid/FUSE filesystems.
  - Enabled Gzip compression for proxied dynamic backend responses (`gzip_proxied any;`) to reduce bandwidth and speed up page load times.
