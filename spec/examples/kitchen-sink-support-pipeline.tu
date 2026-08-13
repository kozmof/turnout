# ===========================================================================
# Kitchen-sink example: a support-ticket triage pipeline.
#
# This single Turn DSL file is written to exercise EVERY surface construct of
# Turnout in one coherent program:
#
#   * state block  — all six field types (number/str/bool + arr<...> variants)
#   * scenes       — entry_actions, both next policies (first-match, all-match)
#   * overview     — all three enforce modes (strict, at_least, nodes_only),
#                    plus a scene with no overview block at all
#   * actions      — docstring sugar (""" """) AND explicit text = <<-EOT
#   * compute      — inline input/output arrows (<~, ~>) and contextual results (:=)
#   * expressions  — every infix operator (+ - * / % > >= < <= == != & |),
#                    every callable binary fn (max, min, bool_xor, str_*,
#                    arr_*), transform-method chains used as call arguments
#                    (.trim().toLowerCase(), .length(), .isEmpty(), .toStr(),
#                    .abs(), .floor(), .ceil(), .round(), .negate(),
#                    .toNumber(), .toUpperCase(), .not()), and the local
#                    forms if / case / pipe / #it
#   * effects      — prepare (from_state, from_hook), merge (to_state),
#                    publish (multiple hooks)
#   * transitions  — conditional next, deterministic next, and all three
#                    transition ingress sources (from_action, from_state,
#                    from_literal)
#   * route        — entry, direct/wildcard/multi-segment paths, OR (|), _
#
# Grammar reminders this file follows (enforced by the converter):
#   - A binding RHS is at most ONE binary operator, and its LEFT operand must
#     be a reference (the right operand may be a literal). Compound logic is
#     built from named intermediate bindings — there is no operator chaining
#     and no parentheses.
#   - Transform methods (.trim(), .length(), ...) are only valid INSIDE a
#     function-call argument, e.g. `max(subject.length(), 0)`.
#   - The := compute root (or transition condition) must be
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
  entry_actions = [intake]
  next_policy   = "first-match"

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
      (and one value, live_sentiment, from a prepare hook).
    - Normalize text, score the ticket, and classify it into a band/route.
    - Persist the derived fields, then branch first-match to one of three
      terminal actions.
    """

    compute {
      prog "intake_graph" {
        # --- ingress bindings (each needs a prepare entry) ---
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

        # --- numeric operators: * + min max - / % ---
        weighted_raw:number = toxicity * 3
        tox_plus:number     = weighted_raw + priority
        capped:number       = min(tox_plus, 100)
        floored:number      = max(capped, 0)
        gap:number          = capped - floored
        half:number         = floored / 2
        bucket:number       = floored % 10
        mood:number         = live_sentiment + 0
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

        # --- string builtins + transform-method chains (inside call args) ---
        normalized:str   = subject + "!"
        has_clean_kw:bool = str_includes(subject.trim().toLowerCase(), "urgent")
        reply_flag:bool   = str_starts(subject.toUpperCase(), "RE:")
        ends_flag:bool    = str_ends(normalized, "!")
        refund_flag:bool  = str_includes(body, "refund")
        tox_text_flag:bool = str_includes(toxicity.toStr(), "7")
        spam_text:bool    = str_includes(spam.toStr(), "true")
        subj_len:number   = max(subject.length(), 0)
        body_num:number   = min(body.toNumber(), 100)

        # --- number/bool transform methods (inside call args) ---
        abs_v:number   = max(sentiment.abs(), 0)
        floor_v:number = max(half.floor(), 0)
        ceil_v:number  = max(half.ceil(), 0)
        round_v:number = max(half.round(), 0)
        neg_v:number   = min(priority.negate(), 0)
        not_spam:bool  = bool_xor(spam.not(), spam)

        # --- array builtins + array transform methods ---
        seed_tags:arr<str> = ["audit"]
        tag_count:number   = max(tags.length(), 0)
        score_count:number = max(scores.length(), 0)
        flags_empty:bool   = bool_xor(flags.isEmpty(), spam)
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

        # --- fold the boolean features into one deterministic readiness flag ---
        r1:bool  = low_tox | mid
        r2:bool  = r1 | within
        r3:bool  = r2 | is_zero
        r4:bool  = r3 | vip_clean
        r5:bool  = r4 | has_clean_kw
        r6:bool  = r5 | reply_flag
        r7:bool  = r6 | ends_flag
        r8:bool  = r7 | refund_flag
        r9:bool  = r8 | tox_text_flag
        r10:bool = r9 | spam_text
        r11:bool = r10 | not_spam

        # --- fold the numeric features into one deterministic checksum ---
        c1:number  = weighted_raw + tox_plus
        c2:number  = c1 + gap
        c3:number  = c2 + half
        c4:number  = c3 + bucket
        c5:number  = c4 + mood
        c6:number  = c5 + subj_len
        c7:number  = c6 + body_num
        c8:number  = c7 + tag_count
        c9:number  = c8 + score_count
        c10:number = c9 + top_score
        c11:number = c10 + abs_v
        c12:number = c11 + floor_v
        c13:number = c12 + ceil_v
        c14:number = c13 + round_v
        c15:number = c14 + neg_v
        c16:number = c15 + pipe_score

        # --- named egress values plus anonymous write-only egresses ---
        score:number = (adjusted) ~> @triage.score
        (c16 + capped) ~> @triage.checksum
        (band) ~> @triage.band
        (route_label) ~> @triage.route_tag
        (normalized) ~> @triage.normalized_subject
        audit1:str           = first_tag + " | "
        (audit1 + allfirst) ~> @triage.audit
        g1:bool              = unsafe | has_urgent
        flagged:bool = (g1 | conflicting) ~> @triage.flagged

        # --- compute result: := binding, declared last ---
        ready:bool := r11 | flags_empty
      }
    }

    publish {
      hook = "audit_log"
      hook = "emit_metrics"
    }

    # conditional transition: mixes from_action, from_literal, and from_state
    next {
      compute {
        prog "to_auto_resolve" {
          score:number <~ action(score)
          threshold:number <~ 40
          flagged:bool <~ @triage.flagged
          cheap:bool = score < threshold
          safe:bool  = flagged == false
          go_auto:bool := cheap & safe
        }
      }
      action = auto_resolve
    }

    # conditional transition: from_action only
    next {
      compute {
        prog "to_escalate" {
          flagged:bool <~ action(flagged)
          go_escalate:bool := flagged
        }
      }
      action = escalate
    }

    # deterministic transition: no compute block (always-true fallthrough)
    next {
      action = manual_queue
    }
  }

  action "auto_resolve" {
    """
    Terminal: low-risk tickets are resolved automatically.
    """
    compute {
      prog "auto_resolve_graph" {
        status:str = ("auto_resolved") ~> @outcome.status
        notice:str := ("closed without human review") ~> @outcome.notice
      }
    }
    publish {
      hook = "emit_metrics"
    }
  }

  action "escalate" {
    """
    Terminal: risky tickets are escalated for review.
    """
    compute {
      prog "escalate_graph" {
        sla:number <~ @triage.sla_hours
        bumped:number = sla + 4
        status:str = ("escalated") ~> @outcome.status
        hours:number := (max(bumped, 24)) ~> @triage.sla_hours
      }
    }
  }

  action "manual_queue" {
    """
    Terminal: everything else waits in the manual queue.
    """
    compute {
      prog "manual_queue_graph" {
        status:str = ("queued") ~> @outcome.status
        owner:str := ("support_team") ~> @outcome.handled_by
      }
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
  entry_actions = [assess]
  next_policy   = "all-match"

  overview at_least {
    assess |=> notify
    assess |=> log
  }

  action "assess" {
    text = <<-EOT
      Read the triage verdict and decide, in parallel, whether to page the
      on-call reviewer and what to write to the audit log.
    EOT

    compute {
      prog "assess_graph" {
        flagged:bool <~ @triage.flagged
        route_tag:str <~ @triage.route_tag
        score:number <~ @triage.score

        hot:bool       = score >= 70
        (route_tag + " review") ~> @review.note
        reviewed:bool := (flagged | hot) ~> @review.parallel
      }
    }

    # all-match: this rule fires when the ticket is hot/flagged ...
    next {
      compute {
        prog "to_notify" {
          reviewed:bool <~ action(reviewed)
          go_notify:bool := reviewed
        }
      }
      action = notify
    }

    # ... and this deterministic rule always fires, so both can be selected.
    next {
      action = log
    }
  }

  action "notify" {
    """
    Terminal: page the on-call reviewer.
    """
    compute {
      prog "notify_graph" {
        reviewer:str := ("oncall") ~> @review.reviewer
      }
    }
    publish {
      hook = "page_oncall"
    }
  }

  action "log" {
    """
    Terminal: append an audit line.
    """
    compute {
      prog "log_graph" {
        note:str <~ @review.note
        line:str := (note + " logged") ~> @review.log_line
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 3: finalize  (next_policy = first-match, overview enforce = nodes_only)
#
# A deterministic two-step chain (seal -> archive). nodes_only enforcement
# checks only that the named node exists; edges are not pinned.
# ---------------------------------------------------------------------------

scene "finalize" {
  entry_actions = [seal]
  next_policy   = "first-match"

  overview nodes_only {
    seal |=> archive
  }

  action "seal" {
    """
    Seal the case, then chain unconditionally to archive.
    """
    compute {
      prog "seal_graph" {
        sealed:bool := (true) ~> @outcome.sealed
      }
    }
    next {
      action = archive
    }
  }

  action "archive" {
    """
    Terminal: archive the sealed case and stamp a final notice.
    """
    compute {
      prog "archive_graph" {
        status:str <~ @outcome.status
        archived:bool = (true) ~> @outcome.archived
        final_notice:str := (status + " archived") ~> @outcome.notice
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 4: closed  (no overview block at all — a scene without a view)
# ---------------------------------------------------------------------------

scene "closed" {
  entry_actions = [close]
  next_policy   = "first-match"

  action "close" {
    """
    Terminal end state for the whole pipeline.
    """
    compute {
      prog "close_graph" {
        status:str := ("closed") ~> @outcome.status
      }
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

    finalize.*.seal.archive => closed,

    _ => closed
  }
}
