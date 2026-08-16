# ===========================================================================
# Kitchen-sink example: a support-ticket triage pipeline.
#
# This single Turn DSL file is written to exercise EVERY surface construct of
# Turnout in one coherent program:
#
#   * state block  — all six field types (number/str/bool + arr<...> variants)
#   * scenes       — entry_action, both next policies (first-match, all-match)
#   * overview     — all three enforce modes (strict, at_least, nodes_only),
#                    plus a scene with no overview block at all
#   * actions      — docstring sugar (""" """) AND explicit text = <<-EOT
#   * compute      — inline IO: `<~` ingress from STATE and from a hook, `~>`
#                    egress, both arrows on one bidirectional line, anonymous
#                    write-only egress, and the `:=` result binding
#   * expressions  — every infix operator (+ - * / % > >= < <= == != & |),
#                    nested infix, every callable binary fn (max, min,
#                    bool_xor, str_*, arr_*), transform methods used four ways
#                    (standalone, chained, as a call argument, and as the left
#                    operand of an infix), and the local forms if/case/pipe/#it
#   * effects      — hook ingress and publish (multiple hooks)
#   * transitions  — the `next <flag> -> <action>` sugar, the bare
#                    deterministic `next <action>`, the block form with all
#                    three transition ingress sources (action, literal, STATE),
#                    and the `next on (...) match { }` form for a decision over
#                    values rather than one flag per branch
#   * route        — entry, direct/wildcard/multi-segment paths, OR (|), _
#
# Grammar reminders this file follows (enforced by the converter):
#   - Infix expressions nest, and standard precedence applies: comparisons
#     bind tighter than `&` and `|`. Parentheses around a complete RHS are
#     reserved for egress, so a named intermediate binding is still the way to
#     force a different grouping.
#   - A call argument is a reference, a literal, or a transform chain. An
#     infix expression inside one — `min(a + b, 100)` — does not parse.
#   - The `:=` result binding (compute root, or transition condition) must be
#     the LAST binding in its prog.
#   - `route`, `state`, `scene`, `action`, etc. are reserved words and cannot
#     be used as field or binding identifiers.
#
# STATE is declared inline below. As an alternative, the same block could live
# in its own file and be referenced with `state_file = "support.state.hcl"`
# (the two forms are mutually exclusive and lower to identical HCL).
# ===========================================================================

state {
  ticket {
    subject:str        = ""
    body:str           = ""
    priority:number    = 0
    vip:bool           = false
    tags:arr<str>      = []
    flags:arr<bool>    = []
    scores:arr<number> = []
  }
  signal {
    toxicity:number  = 0
    spam:bool        = false
    sentiment:number = 0
  }
  triage {
    score:number           = 0
    checksum:number        = 0
    band:str               = ""
    route_tag:str          = ""
    audit:str              = ""
    normalized_subject:str = ""
    flagged:bool           = false
    sla_hours:number       = 0
  }
  review {
    note:str      = ""
    log_line:str  = ""
    reviewer:str  = ""
    parallel:bool = false
  }
  outcome {
    status:str     = ""
    notice:str     = ""
    handled_by:str = ""
    sealed:bool    = false
    archived:bool  = false
  }
}

# ---------------------------------------------------------------------------
# Scene 1: triage  (next_policy = first-match, overview enforce = strict)
#
# The single entry action `intake` is the kitchen sink: it touches every
# operator, builtin, transform method, and local expression form. The strict
# overview pins the action graph exactly — every node and edge must match.
# ---------------------------------------------------------------------------

scene "triage" {
  entry_action = intake
  next_policy  = "first-match"

  overview strict {
    intake |=> auto_resolve
    intake |=> escalate
    intake |=> manual_queue
    auto_resolve
    escalate
    manual_queue
  }

  action "intake" {
    """
    Logic overview:
    - Pull ticket text, counters, arrays, and live signals from STATE
      (and one value, live_sentiment, from the sentiment_api hook).
    - Normalize text, score the ticket, and classify it into a band/route.
    - Persist the derived fields, then branch first-match to one of three
      terminal actions.
    """

    compute "intake_graph" {
      # --- inline ingress: STATE reads, one bidirectional pair, one hook ---
      subject:str <~ @ticket.subject
      body:str <~ @ticket.body
      priority:number <~ @ticket.priority ~> @triage.sla_hours
      vip:bool <~ @ticket.vip
      toxicity:number <~ @signal.toxicity
      spam:bool <~ @signal.spam
      sentiment:number <~ @signal.sentiment
      tags:arr<str> <~ @ticket.tags
      flags:arr<bool> <~ @ticket.flags
      scores:arr<number> <~ @ticket.scores
      live_sentiment:number <~ hook("sentiment_api")

      # --- numeric operators: * + - / %, with min/max as calls ---
      weighted_raw:number = toxicity * 3 + priority
      capped:number       = min(weighted_raw, 100)
      floored:number      = max(capped, 0)
      gap:number          = capped - floored
      half:number         = floored / 2
      bucket:number       = floored % 10
      adjusted:number     = floored + live_sentiment

      # --- comparison + boolean operators: >= < > <= != == | xor & ---
      risky:bool       = toxicity >= 7
      low_tox:bool     = toxicity < 3
      mid:bool         = floored > 40
      within:bool      = half <= 100
      clean:bool       = spam != true
      is_zero:bool     = bucket == 0
      unsafe:bool      = risky | spam
      conflicting:bool = bool_xor(risky, spam)
      vip_clean:bool   = vip & clean

      # --- string builtins; transform chains as call arguments ---
      normalized:str     = subject + "!"
      has_clean_kw:bool  = str_includes(subject.trim().toLowerCase(), "urgent")
      reply_flag:bool    = str_starts(subject.toUpperCase(), "RE:")
      ends_flag:bool     = str_ends(normalized, "!")
      refund_flag:bool   = str_includes(body, "refund")
      tox_text_flag:bool = str_includes(toxicity.toStr(), "7")
      spam_text:bool     = str_includes(spam.toStr(), "true")

      # --- transform methods standalone, and as an infix left operand ---
      subj_len:number   = subject.length()
      body_num:number   = body.toNumber()
      abs_v:number      = sentiment.abs()
      floor_v:number    = half.floor()
      ceil_v:number     = half.ceil()
      round_v:number    = half.round()
      neg_v:number      = priority.negate()
      not_spam:bool     = spam.not()
      long_subject:bool = subject.length() > 20

      # --- array builtins + array transform methods ---
      seed_tags:arr<str> = ["audit"]
      tag_count:number   = tags.length()
      score_count:number = scores.length()
      flags_empty:bool   = flags.isEmpty()
      has_urgent:bool    = arr_includes(tags, "urgent")
      first_tag:str      = arr_get(tags, 0)
      top_score:number   = arr_get(scores, 0)
      all_tags:arr<str>  = arr_concat(tags, seed_tags)
      allfirst:str       = arr_get(all_tags, 0)

      # --- pipe with #it ---
      pipe_score:number = pipe(
        toxicity,
        #it + 1,
        #it * 2,
        #it - 1
      )

      # --- if (nested binary choice) ---
      band:str = if(
        floored >= 70,
        "high",
        if(floored >= 40, "medium", "low")
      )

      # --- case (literal arm, guarded variable binders, wildcard) ---
      route_label:str = case(
        floored,
        0 => "empty",
        hi if hi >= 70 => "urgent",
        mid_n if mid_n >= 40 => "standard",
        _ => "light"
      )

      # --- named egress values plus anonymous write-only egresses ---
      # `score` and `flagged` keep their names because the transitions below
      # read them back through action(...); an anonymous egress cannot be.
      score:number = (adjusted) ~> @triage.score
      flagged:bool = (unsafe | has_urgent | conflicting) ~> @triage.flagged

      (band) ~> @triage.band
      (route_label) ~> @triage.route_tag
      (normalized) ~> @triage.normalized_subject
      (first_tag + " | " + allfirst) ~> @triage.audit

      # --- fold the numeric features into one checksum (nested infix) ---
      raw_metrics:number    = weighted_raw + capped + gap + half + bucket + adjusted + pipe_score
      text_metrics:number   = subj_len + body_num + tag_count + score_count + top_score
      number_metrics:number = abs_v + floor_v + ceil_v + round_v + neg_v
      (raw_metrics + text_metrics + number_metrics) ~> @triage.checksum

      # --- fold the boolean features into the := result, declared last ---
      ready_text:bool = has_clean_kw | reply_flag | ends_flag | refund_flag | long_subject
      ready_meta:bool = tox_text_flag | spam_text | not_spam | flags_empty
      ready:bool := low_tox | mid | within | is_zero | vip_clean | ready_text | ready_meta
    }

    publish {
      hook = "audit_log"
      hook = "emit_metrics"
    }

    # conditional transition, block form: mixes all three transition ingress
    # sources — action(...), a literal, and post-merge STATE.
    next {
      compute "to_auto_resolve" {
        score:number <~ action(score)
        threshold:number <~ 40
        flagged:bool <~ @triage.flagged
        go_auto:bool := score < threshold & flagged == false
      }
      action = auto_resolve
    }

    # conditional transition, sugar form: a bare bool binding of this action
    next flagged -> escalate

    # deterministic transition: no condition at all (always-true fallthrough)
    next manual_queue
  }

  action "auto_resolve" {
    """
    Terminal: low-risk tickets are resolved automatically.
    """
    compute "auto_resolve_graph" {
      ("auto_resolved") ~> @outcome.status

      notice:str := ("closed without human review") ~> @outcome.notice
    }
    publish {
      hook = "emit_metrics"
    }
  }

  action "escalate" {
    """
    Terminal: risky tickets are escalated for review.
    """
    compute "escalate_graph" {
      sla:number <~ @triage.sla_hours
      bumped:number = sla + 4

      ("escalated") ~> @outcome.status

      hours:number := (max(bumped, 24)) ~> @triage.sla_hours
    }
  }

  action "manual_queue" {
    """
    Terminal: everything else waits in the manual queue.
    """
    compute "manual_queue_graph" {
      ("queued") ~> @outcome.status

      owner:str := ("support_team") ~> @outcome.handled_by
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 2: review  (next_policy = all-match, overview enforce = at_least)
#
# Demonstrates all-match: `assess` can enqueue BOTH `notify` and `log` in one
# step. The entry action uses the explicit `text = <<-EOT` form instead of the
# triple-quoted docstring sugar.
# ---------------------------------------------------------------------------

scene "review" {
  entry_action = assess
  next_policy  = "all-match"

  overview at_least {
    assess |=> notify
    assess |=> log
  }

  action "assess" {
    text = <<-EOT
      Read the triage verdict and decide, in parallel, whether to page the
      on-call reviewer and what to write to the audit log.
    EOT

    compute "assess_graph" {
      flagged:bool <~ @triage.flagged
      route_tag:str <~ @triage.route_tag
      score:number <~ @triage.score

      (route_tag + " review") ~> @review.note

      reviewed:bool := (flagged | score >= 70) ~> @review.parallel
    }

    # all-match: this rule fires when the ticket is hot/flagged ...
    next reviewed -> notify

    # ... and this deterministic rule always fires, so both can be selected.
    next log
  }

  action "notify" {
    """
    Terminal: page the on-call reviewer.
    """
    compute "notify_graph" {
      reviewer:str := ("oncall") ~> @review.reviewer
    }
    publish {
      hook = "page_oncall"
    }
  }

  action "log" {
    """
    Terminal: append an audit line.
    """
    compute "log_graph" {
      note:str <~ @review.note

      line:str := (note + " logged") ~> @review.log_line
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 3: finalize  (next_policy = first-match, overview enforce = nodes_only)
#
# Seal, then pick an archive lane from two values at once. nodes_only
# enforcement checks only that the named node exists; edges are not pinned.
# ---------------------------------------------------------------------------

scene "finalize" {
  entry_action = seal
  next_policy  = "first-match"

  overview nodes_only {
    seal |=> archive
    seal |=> expedite_archive
  }

  action "seal" {
    """
    Seal the case, then choose the archive lane from the triage band and
    whether the requester is a VIP.
    """
    compute "seal_graph" {
      band:str <~ @triage.band
      vip:bool <~ @ticket.vip

      sealed:bool := (true) ~> @outcome.sealed
    }

    # transition, match form: one rule per arm, evaluated in arm order under
    # first-match. This is sugar — each arm expands to exactly the next { }
    # block it abbreviates, and the `_` arm to a bare `next expedite_archive`.
    # The form earns its place when the decision is over values; a decision
    # that is already one bool per branch stays clearer as `next <flag> -> x`.
    next on (band, vip) match {
      ("heavy", false) => archive,
      ("heavy", true)  => expedite_archive,
      (_, true)        => expedite_archive,
      _ => archive
    }
  }

  action "expedite_archive" {
    """
    Terminal: archive on the fast lane, skipping the retention notice.
    """
    compute "expedite_archive_graph" {
      (true) ~> @outcome.archived

      notice:str := ("expedited") ~> @outcome.notice
    }
  }

  action "archive" {
    """
    Terminal: archive the sealed case and stamp a final notice.
    """
    compute "archive_graph" {
      status:str <~ @outcome.status

      (true) ~> @outcome.archived

      final_notice:str := (status + " archived") ~> @outcome.notice
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 4: closed  (no overview block at all — a scene without a view)
# ---------------------------------------------------------------------------

scene "closed" {
  entry_action = close
  next_policy  = "first-match"

  action "close" {
    """
    Terminal end state for the whole pipeline.
    """
    compute "close_graph" {
      status:str := ("closed") ~> @outcome.status
    }
  }
}

# ---------------------------------------------------------------------------
# Route: support_pipeline
#
# Ties the four scenes together and demonstrates every route pattern form:
#   - direct two-segment path        (triage.auto_resolve)
#   - single-wildcard path           (triage.*.escalate)
#   - OR-joined paths sharing target (review.*.notify | review.*.log)
#   - multi-segment suffix path      (finalize.*.seal.archive)
#   - catch-all fallback             (_)
# ---------------------------------------------------------------------------

route "support_pipeline" {
  entry = triage

  match {
    triage.auto_resolve => finalize,
    triage.*.escalate   => review,
    triage.manual_queue => review,

    review.*.notify |
    review.*.log
      => finalize,

    finalize.*.seal.archive |
    finalize.*.seal.expedite_archive
      => closed,

    _ => closed
  }
}
