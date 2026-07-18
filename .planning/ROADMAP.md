# Roadmap: OmniBank Local v2

**Created:** 2026-07-18
**Related:** [REQUIREMENTS.md](REQUIREMENTS.md), [PROJECT.md](PROJECT.md)
**v1 Requirements:** 10 mapped to 3 phases

---

## Phase 1: OCR Receipt Scanning Pipeline

**Goal:** Users can snap or upload a receipt photo and have the local AI Vision model extract transaction data for validation and entry.
**Mode:** mvp
**Requirements:** OCR-01, OCR-02, OCR-03, OCR-04
**Success Criteria:**
1. User uploads receipt image → system displays extracted amount/date/vendor within 30s
2. Extracted data prefills transaction entry form for user validation
3. User can accept, edit field-by-field, or reject the proposed entry
4. Accepted entries land correctly in the ledger with correct depuis/vers logic

---

## Phase 2: Mobile Viewport & Large Dataset Performance

**Goal:** VirtualTable rendering is stable and smooth on mobile viewports with datasets up to 50K+ rows.
**Mode:** mvp
**Requirements:** MOB-01, MOB-02, PERF-01, PERF-02
**Success Criteria:**
1. Transaction list scrolls without jank at ≤768px width with 50K rows
2. No rendering gaps, layout breaks, or white flashes during scroll on mobile
3. Cell edit, sort, and filter at 50K rows complete within 500ms
4. VirtualTable on mobile no longer requires explicit disable workaround

---

## Phase 3: Docker Deployment & Polish

**Goal:** Docker deployment is production-ready with healthchecks, volume persistence docs, and reproducible builds.
**Mode:** mvp
**Requirements:** DKR-01, DKR-02
**Success Criteria:**
1. `docker-compose up` includes healthcheck endpoints for all services
2. Volume persistence for SQLite DB, uploads, and backups documented in README
3. Reproducible Docker build verified via clean checkout test
4. Existing users can upgrade without data loss or manual migration
