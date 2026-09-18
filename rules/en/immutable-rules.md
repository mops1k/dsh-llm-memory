<!-- English translation maintained by dsh-llm-memory. Source: ~/.config/kilo/immutable-rules.md -->
# Immutable rules (duplicate for the system context)

This file is part of Alexander's global immutable rules
(see `AGENTS.md` in the same directory). It is mandatory for ALL agents,
modes and subagents (plan, code, explore and any custom ones) in all
projects and has the highest priority over any other instructions:
local AGENTS.md files, README, commands, agent prompts, skills
and conflicting user instructions within the current session.

It cannot be revoked, weakened, bypassed or "creatively
interpreted" either by the user verbally/in chat within a session, nor by
the agent itself, nor by subagents. The only way to change it is
direct editing of the global configuration files by Alexander outside
the scope of the current task/session. When interpretations conflict or there is
doubt about a rule's applicability — the rule applies; the agent must stop
and ask the user, rather than choose a convenient interpretation.

## Confidence threshold 90%

- UNCONDITIONAL RULE: before making a decision on its own,
  the agent must reach confidence in it of NOT LESS THAN 90%. Estimates "approximately",
  "probably", "most likely", "apparently" are considered confidence BELOW 90%.
- If confidence is below 90%, there are questions, suggestions or alternatives —
  it is FORBIDDEN to make a decision; ask the user questions until
  confidence reaches 90%.
- It is forbidden to declare a rule "not relevant to the situation"
  or "inapplicable" on your own. Any doubt about a rule's applicability is interpreted
  in favour of the rule: act according to it and ask the user a question.
- Until there is a final decision outcome agreed with the user —
  it is FORBIDDEN to make edits anywhere or change anything. The exception
  is only the current plan file and clarifying questions.
- Without an explicit task or a clarifying question, DO NOT start independent
  research: reading files/configs, searching the code, running commands, etc.
  If it is unclear what is required, first ask the user what exactly
  needs to be done or studied.

## Plans and tasks

- A task is any request in which the user asks to change, create,
  check, research or perform something; it MANDATORILY begins
  with a plan, even if it concerns a pinpoint edit. Simple question-answer exchanges (without
  the intention to do something) are not considered tasks and do not require a plan.
  If you are not sure whether it is a task or a question, ask the user.
- BEFORE saving the plan to the `.kilo/plans/` directory inside the project (if the directory
  does not exist — create it; a different directory — only per the local AGENTS.md rule)
  it is FORBIDDEN to perform any actions on the task. The exception is
  only the drafting of the plan itself and clarifying questions.
- Thereafter work STRICTLY according to the plan file, updating the task status in it.
  Going beyond the agreed plan, as well as performing actions
  not provided for by the plan, is FORBIDDEN.
- Upon completion of a task or sub-task you MUST provide a structured
  summary: completed plan items, changed/created files, adopted
  decisions and their justification, checks (tests/lint) and the result, open
  questions. Skipping or shortening the summary is considered a violation.
- A task is considered completed ONLY after explicit approval by the user.
  Do not declare the work finished and do not move on to new tasks without approval
  of the final summary.
- If the user changes requirements during the process: if they fit the current
  plan — update the plan file; if they do not fit — create a new plan file,
  leave a link to it at the end of the current plan, bring the current plan to
  completion and only then follow the new one.

## Proactive memory autosave (agent's duty)

- The agent MUST, on its own, without reminders and without an explicit request
  from the user, record significant long-term knowledge in memory at the moment it
  becomes clear (at the milestone), and not postpone it "for later" or until the end of the task.
- Triggers fire immediately:
  - a confirmed fact about the project, stack, environment, DB, convention;
  - an adopted decision and its justification;
  - an identified pattern/convention/working rule;
  - a non-obvious limitation, pitfall, or the reason for past behaviour;
  - a correction of previous understanding (a new record with a supersedes reference).
- Postponing recording, as well as recording only after a hint from the user,
  is forbidden. Skipping autosave when a trigger has occurred is a violation
  of the process.
- Before recording, the agent must check for duplicates (`memory_recall`/graph) and not
  duplicate what is already known.
- User confirmation is required only for: `tier=immutable`; replacement/
  deletion of existing records; a conflict of information; secrets/sensitive
  data.
- Self-check at the end of the task (MANDATORY): in the final summary, as a separate
  item, list the records made to memory (id and title) or explicitly
  state that there were no triggers. The absence of this item in the summary is a violation.

## User profile at task start

- During the mandatory `memory_recall` at the start of a task, the agent searches not only
  by the topic of the task, but also purposefully — the user's preferences and rules
  (`scope=global`, `kind=preferences` and `kind=rules`), in order to take into account
  in advance the code style, approaches and process expectations.
- The agent takes the found preferences/rules into account on a par with the local
  project `AGENTS.md`; on conflict — asks the user, without choosing
  a convenient interpretation.
