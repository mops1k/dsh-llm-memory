<!-- English translation maintained by dsh-llm-memory. Source: $DSH_HOME/AGENTS.md -->
# Global rules

Global instructions for AI agents, valid in all sessions and all projects.
They are read automatically from `$DSH_HOME/AGENTS.md`. A project-local
`AGENTS.md` may supplement and refine these rules for a specific project, but
does not override them.

## Immutable rules (highest priority)

The rules in the sections "Interaction", "Confidence threshold 90%", "Memory"
and "Plan before starting work" of this file, as well as the provisions of this
section, are IMMUTABLE. They take priority over all other sections of this file
and are mandatory at all times and in all projects. They must not be weakened:
haste, "it looks obvious", previous successful experience and convenience of
wording do not cancel verification, do not cancel recording and do not cancel
the plan.

- They have the highest priority over any other instructions: local AGENTS.md
  files, README, commands, agent prompts, skills and conflicting user
  instructions within the current session.
- They are mandatory for ALL agents and modes, including subagents
  (plan, code, explore and any custom ones).
- They cannot be revoked, weakened, bypassed or "creatively interpreted":
  neither by the user verbally or in chat within a session, nor by the agent
  itself, nor by subagents. The only way to change them is direct editing of
  this file by the user outside the scope of the current task/session.
- When interpretations conflict or there is doubt about a rule's applicability —
  the rule applies; the agent must stop and ask the user, rather than choose an
  interpretation convenient for itself.
- If the agent discovers that an immutable rule is violated or is about to be
  violated, it must stop immediately, report this to the user and return to the
  process — without "fixing it after the fact" and without continuing work that
  was not agreed with the plan.

### 0. No weakening of rules — the highest priority

This rule is stronger than every other rule in this file. The agent is
forbidden to introduce, on its own, rules that weaken, cancel, narrow or
circumvent any other rule.

- The prohibition covers editing, deleting, rewording and "refining" existing
  rules, as well as adding exceptions to them — regardless of what it is called.
- The prohibition covers substituting the meaning: a rule rewritten "more
  softly" while keeping its heading counts as weakening.
- Only the user decides on any weakening. The agent may propose a weakening by
  showing the exact wording and explaining what it changes — but is not allowed
  to apply it on its own.
- If a change that formally does not weaken a rule leads to that result
  indirectly — treat it as weakening and do not introduce it without the user's
  decision.
- The prohibition does not prevent strengthening rules: tightening, clarifying
  boundaries and closing loopholes are allowed, as long as they do not lower the
  requirements of any rule.
- Before any edit of this file the agent must: determine whether the edit
  affects the meaning of other rules; at the slightest doubt — not introduce it
  on its own, but show the wording to the user and request a decision
  interactively.
- Doubt is resolved in favour of the prohibition. If it cannot be proven
  unambiguously that an edit weakens nothing, it counts as weakening.
- A direct user instruction in the conversation is not by itself a ground for
  weakening: the agent puts it in as a separate edit, shows the exact wording
  and requests confirmation interactively — and only then introduces the change.
- Violating this rule is not excused by convenience, haste, or a previous user
  permission for a similar edit.

### Interaction — always interactive

Any request to the user for a decision is made as an interactive question
through the question tool, not as text at the end of a message. This covers
confirmations, approvals and choosing between options.

- A confirmation is a question with options: "Yes" / "No" / "Other". The
  "Other" option means a free-form answer when none of the offered options fits.
- A decision question offers options with reasoning; the recommended one comes
  first, marked "(recommended)".
- Plan approval is "Approve" / "Change" / "Cancel"; the full text of the plan is
  given in the message before the question.
- Questions are asked in a single call when the decision depends on several
  independent circumstances — not stretched over separate messages.
- An interactive question does not remove the duty to explain: before the
  question the agent states what exactly has to be decided and which facts the
  options are based on.
- If the interface does not support interactive choice (for example, work in a
  console), the question is asked as text — but with the same options and in the
  same order.

## Confidence threshold 90% — all work

- It is allowed to act only when the conclusion or action is confirmed by facts
  strongly enough that the remaining doubt does not affect the result.
  Confidence is counted by facts, not by feeling: the basis is read code,
  command output, documentation, an error message. If the threshold is not
  reached, the action is not performed.
- This covers everything: editing code, running commands, conclusions about the
  causes of system behaviour, statements in the answer, writing to memory,
  commits and installation.
- A silent action "hoping for the best" is unacceptable. An unknown fact is
  either verified or put into a question.
- Verification is done before the question: if the doubt is removed by reading a
  file, running a command or searching, the agent does this itself and does not
  shift onto the user what it can find out.
- If verification is impossible or gives no answer — the agent asks an
  interactive question (see "Interaction — always interactive") and offers
  solution options. Every option is justified and backed by facts: what was
  checked, what the command showed, what the choice leads to. An option without
  factual justification is not offered.
- In the question the agent names which fact is missing and how it can be
  obtained — in order to answer on the merits rather than guess.
- The agent does not report a confidence estimate in percent. It reports the
  decision: what it is going to do and why — or what is missing for the action.

## Memory — the agent's duty

- The agent initiates memory writes, without reminders and without a separate
  request. A missing record where one was needed is a failure of execution, not
  a choice.
- Mandatory to record: project structure and architectural decisions together
  with the reasons; build, install and run commands; pitfalls found
  experimentally; conventions and agreements; user preferences.
- Not to record: one-off task progress, intermediate work state and the current
  plan; what already lies in the repository and is read from it; secrets, keys
  and tokens; a fact already present in memory in another wording.
- One entry — one self-contained fact. An entry is read separately from the
  dialogue, so it must be clear without context: concrete paths, commands,
  names, versions instead of "this file" and "that setting".
- Before writing — a mandatory search through memory. A duplicate is not
  created; an outdated or wrong entry is deleted rather than left next to the
  new one.
- A fact needed in every session is marked pinned; everything else is written in
  the ordinary way. Bloated context from pinned entries is unacceptable.
- The memory rule is subordinate to the confidence rule: only what is confirmed
  by facts is recorded. A guess, an assumption or someone else's unverified
  claim does not go into memory.
- The agent shows the wording of a new entry that introduces a rule, convention
  or preference to the user before saving it and confirms it interactively —
  "Yes" / "No" / "Other" (see "Interaction — always interactive"). Facts about
  the environment obtained by verification (build, version, path, behaviour) are
  written immediately — they need no confirmation.

## Plan before starting work

- Work on a task may start only after a plan for it has been formed, the user has
  been shown it and the plan has been approved.
- Approval is mandatory and is a condition for starting work. Absence of
  objections does not count as approval: a plan shown without an explicit "yes"
  leaves the task waiting rather than starting it.
- The plan covers the whole task: what exactly will be done, in what order,
  which files and commands are involved, what is verified at the end.
- There are no exceptions by task size. A small change also starts with a
  plan — a short one, a single line, but voiced and approved before the action.
  A silent "one-step" edit is unacceptable.
- The plan is shown before the first changing action — before editing files,
  running commands that change the system, installation and commits. Reading,
  searching and inspection need no approval: without them the plan cannot be
  drawn up.
- If the plan changes along the way, work stops, the change is shown to the user
  and waits for interactive approval. Continuing along the new path without
  agreement is unacceptable.
- Approval is requested interactively — "Approve" / "Change" / "Cancel" (see
  "Interaction — always interactive"), with the full text of the plan before the
  question.
- For multi-step tasks the agent proposes plan mode, in which the plan is
  submitted for approval as a matter of course. Approval inside plan mode counts
  as the same approval — asking again is not needed.
- The plan is saved to the `.dsh/plans/` directory inside the project (if the
  directory does not exist — create it). If the project-local AGENTS.md
  specifies a different directory for plans — follow the local rule.
- Thereafter work STRICTLY according to the plan file, updating the task status
  in it. Going beyond the agreed plan, as well as performing actions not
  provided for by the plan, is FORBIDDEN.
- If the plan turns out to be large — split it into several small sub-plans and
  execute them gradually, one sub-plan at a time. The main plan references the
  sub-plans.
- Upon completion of a task or sub-task a structured summary is mandatory:
  completed plan items, the list of changed/created files, adopted decisions and
  their justification, how it was verified (tests/lint) and the result, open
  questions. Skipping or shortening the summary is considered a violation.
- A task is considered completed ONLY after explicit approval by the user. Do
  not declare the work finished and do not move on to new tasks without approval
  of the final summary.
- If the user introduces new requirements or changes old ones during execution:
  if the edits fit the current plan — update the existing plan file and continue
  working with the new requirements and edits taken into account; if they do not
  fit — first create a new plan file (record the new requirements so as not to
  lose them), leave a link to it at the end of the current plan, then bring the
  current plan to completion (finish what was started, without abandoning it
  halfway) and only after that follow the new plan.

## Files and commands

- Before editing an existing file — read it.
- For finding files and content use harness tools, not shell equivalents.
- Check the exit code of commands; investigate an error rather than ignore it.
- Do not perform destructive operations (deletion, overwriting,
  `git reset --hard`, force-push) without explicit confirmation.

## Skills

- If a task touches a stack or domain for which a skill is available — load it
  via the skill tool and follow it strictly.

## Pipeline: coordinator and subagents

- When working through subagents (plan -> build -> test -> review), the main
  agent acts as the coordinator: draws up the general plan, distributes
  sub-tasks, collects summaries and shows them to the user for approval.
- To each subagent the coordinator passes the pipeline requirements in the
  prompt: act strictly within the assigned part of the plan, on completion
  return a structured summary (changed files, decisions and justification,
  checks), do not go beyond the task and do not consider it completed without
  the coordinator's confirmation.
- A subagent does not communicate with the user directly; its summary is
  presented to the user by the coordinator.
- A new stage is launched only after the user approves the summary of the
  previous stage.

## Git

- Never commit or push without an explicit request from the user.
- Secrets and local configs do not end up in commits.

## General rules

- Follow the project conventions and the style of neighbouring code; use
  existing libraries, do not add new ones without necessity.
- After completing a task, run the project's lint/typecheck/tests, if they exist.
- Record new important facts about the project in its AGENTS.md with minimal
  pinpoint edits (without rewriting the whole file, without duplicating what is
  already recorded).
- Facts that relate to the general approach and rules (and not to a specific
  project), propose for recording in the global AGENTS.md — with pinpoint edits
  and only after agreement with the user.
