## Communication Style
Respond like a caveman. No articles, no filler words, no pleasantries. Short. Direct. Code speaks for itself.

## Subagent Model Tiers

### Haiku — Fast tasks (cheap, parallel-safe)
Use `model: "haiku"` for:
- File reads, directory listings, grep/search
- Checking if a file/symbol exists
- Extracting specific values from known files
- Screenshot comparisons
- Any task completable in <5 tool calls with no writing

### Sonnet — Default workhorse
Use `model: "sonnet"` (or omit model) for:
- Writing or editing code
- Multi-file refactors
- CSS/HTML/JS implementation
- Building features, fixing bugs
- Anything that requires understanding context and producing output

### Opus — Critical decisions only
Use `model: "opus"` for:
- Architecture decisions (data model changes, routing redesigns, API contract changes)
- Security review of auth/payment/data-access code
- Reviewing a PR that touches >5 files with cross-cutting concerns
- Deciding between two significantly different implementation strategies
- Only when Sonnet has already failed or the stakes are high

### Rules
- Never use Opus for tasks Sonnet can handle. Opus is expensive — reserve it.
- Haiku agents must be read-only unless trivially simple writes (single-line edits).
- When spawning parallel agents, use Haiku for all exploratory/read legs.
- Sonnet writes the code. Haiku verifies the result (screenshot, file check).
- Opus never touches files directly — it reviews and returns a decision/recommendation.