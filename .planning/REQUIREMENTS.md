# Requirements: OmniBank Local v2

**Defined:** 2026-07-18
**Core Value:** Financial data sovereignty — records never leave your machine while getting local AI decision support

## v1 Requirements

### OCR Receipt Scanning

- [ ] **OCR-01**: User can capture/submit a receipt image (photo upload) for automated processing
- [ ] **OCR-02**: System uses local Ollama Vision model (Gemma 4 / Llava) to extract transaction amount, date, description, and vendor
- [ ] **OCR-03**: Extracted data is presented to user as a proposed transaction entry for validation
- [ ] **OCR-04**: User can accept, edit, or reject the proposed entry before it hits the ledger

### Mobile Viewport Virtualization

- [ ] **MOB-01**: VirtualTable rendering is stable and performant on viewports ≤768px width
- [ ] **MOB-02**: No scroll jank, rendering gaps, or layout breaks at mobile widths with datasets up to 50K rows

### Docker Deployment

- [ ] **DKR-01**: Docker deployment includes healthcheck endpoints and volume persistence documentation
- [ ] **DKR-02**: Docker image builds are reproducible and documented in README.md

### Large History Performance

- [ ] **PERF-01**: Transaction list views (Dashboard, History, Recurrences) render and scroll smoothly with 50K+ rows
- [ ] **PERF-02**: VirtualTable cell edit, sort, and filter operations complete within 500ms at 50K+ row counts

## v2 Requirements (Deferred)

| Feature | Notes |
|---------|-------|
| OCR Vision pipeline | Awaiting mobile app delivery strategy |
| Touch/gesture navigation for mobile | Depends on viewport virtualization fix |
| Docker Compose production profile | Requires more user feedback on usage patterns |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud sync / multi-device | Violates zero-cloud core value |
| External accounting integrations (QuickBooks, Xero) | Self-contained workflow preservation |
| Real-time collaborative editing | Organisation Mode is audit-style only, not collaborative |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OCR-01 | Phase 1 | Pending |
| OCR-02 | Phase 1 | Pending |
| OCR-03 | Phase 1 | Pending |
| OCR-04 | Phase 1 | Pending |
| MOB-01 | Phase 2 | Pending |
| MOB-02 | Phase 2 | Pending |
| DKR-01 | Phase 3 | Pending |
| DKR-02 | Phase 3 | Pending |
| PERF-01 | Phase 3 | Pending |
| PERF-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-18*
*Last updated: 2026-07-18 after initial definition*
