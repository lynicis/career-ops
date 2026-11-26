# Turkey-Based Job Eligibility Filter — Short Design

## Intent

Avoid surfacing or applying to foreign on-site/hybrid roles unless the posting explicitly offers both relocation support and visa sponsorship. Keep remote roles subject to existing eligibility rules; this change adds no new remote-location restriction.

## Approaches

1. **Existing configuration only:** allow Turkey and broadly remote roles; exclude other structured locations. Simpler, but cannot retain foreign on-site roles that offer both supports or reliably classify ambiguous data.
2. **Scanner eligibility rule (selected):** add an opt-in, profile-driven rule that evaluates location/work mode plus posting text. It can express the required conjunction and rejects postings lacking enough evidence. This matches the requested policy without changing the generic liveness classifier.

## Design

- Extend the existing scanner eligibility/location policy rather than introduce a LinkedIn-specific provider or a second general location convention.
- Eligible: on-site/hybrid roles in Turkey; foreign on-site/hybrid only when posting text explicitly indicates both relocation and visa sponsorship. Remote roles are unaffected by this new rule.
- Missing/unclear location or required support evidence fails closed for foreign on-site/hybrid roles; report a distinct filter reason/counter so drops are explainable.
- Correct profile work-authorization facts to Turkey-only authorization and sponsorship required outside Turkey. Do not infer citizenship.
- Liveness remains unchanged: it reports posting availability, not personal eligibility.
- LinkedIn MCP may be used as an interactive source when the user asks to scan jobs. Do not add authenticated LinkedIn scraping/API behavior to the core scanner or alter liveness to call LinkedIn.

## Constraints and non-goals

- No application submission or automated application action.
- No changes to generic expired/active detection.
- No new external service/dependency.
- Keep eligibility policy opt-in/configurable for other users; apply this user's preference in their personal configuration.
- Text matching is conservative and cannot prove that a visa will be approved; ambiguous evidence is rejected.
