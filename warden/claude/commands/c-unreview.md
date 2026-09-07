Do a comprehensive review of the current uncommitted changes in this repository.

Use `.claude/agents/cc-plan.md`, following the guidance in
`CODE_REVIEW.md`. Establish a green baseline first (§1a) so pre-existing
failures are not attributed to these changes. Work its tiers in order, verify every finding per
§5 before reporting it, and classify per §4. Check §6 before reporting anything that looks wrong.
Reach that document with `knowledge_search` then `knowledge_read` on the chunk id it returns
(`AGENT_GUIDE.md §1`); cite the chunk id for every rule a finding rests on.

- Critically assess whether the changes are secure, bullet-proof, and production-ready.
- Consider how they fit the surrounding architecture, not only whether they work in isolation.
- Ensure the patterns are efficient and effective, and naturally avoid technical debt.
- Specifically inspect attack vectors the changes introduce or widen.
- This is a pre-1.0 release: no regression shims, no backward-compatibility paths. If you find
  any, report them as blocking.
