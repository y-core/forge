Do a comprehensive code review of the codebase.

Use `.claude/agents/cc-plan.md`, following the guidance in
`CODE_REVIEW.md`. Work its tiers in order — §3a gated, §3b ripgrep with
triage, §3c judgement — verify every finding per §5 before reporting it, and classify per §4.
Check §6 before reporting anything that looks wrong; several correct patterns are listed there.

- Critically assess whether the code is secure, bullet-proof, and production-ready.
- Consider how the system flows, and whether the architecture holds together as a whole.
- Ensure the patterns are efficient and effective, and naturally avoid technical debt.
- Specifically inspect attack vectors that could be exploited; it must be exploit-resistant.
- This is a pre-1.0 release: no regression shims, no backward-compatibility paths. If you find
  any, report them as blocking.
