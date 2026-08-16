# ===========================================================================
# 04 — Sensor calibration
#
# An expression workout. A calibration rig reads a sensor array, scores it,
# and decides what to do about it. The graph shape is deliberately plain so
# the compute blocks are the interesting part.
#
# Covers: every infix operator with its precedence, the binary function
# catalogue (max/min/bool_xor/str_*/arr_*), transform-method chains on all
# four receiver types, `pipe` with the `#it` placeholder, `if` and `case`
# local forms, array state fields, and `next_policy = "all-match"`, which
# selects EVERY true rule rather than the first.
# ===========================================================================

state {
  sensor {
    raw_readings:arr<number> = []
    labels:arr<str> = []
    flags:arr<bool> = []
    serial:str = ""
    drift_ppm:number = 0
    ambient_c:number = 0
  }
  calibration {
    score:number = 0
    checksum:number = 0
    band:str = ""
    report:str = ""
    within_tolerance:bool = false
    needs_service:bool = false
    logged:bool = false
  }
}

scene "calibration_rig" {
  entry_action = evaluate_array
  next_policy  = "all-match"

  # all-match selects every rule whose condition is true, in declaration
  # order, so `evaluate_array` can enqueue both follow-ups in one step. This
  # is also why a `next on (...) match { }` block is rejected in an all-match
  # scene: arm order is what makes match arms exclusive, and all-match
  # discards it.

  overview at_least {
    evaluate_array |=> file_report
    evaluate_array |=> schedule_service
  }

  action "evaluate_array" {
    """
    Score the sensor array and decide whether it is still in tolerance.
    """

    compute "evaluate_graph" {
      raw_readings:arr<number> <~ @sensor.raw_readings
      labels:arr<str> <~ @sensor.labels
      flags:arr<bool> <~ @sensor.flags
      serial:str <~ @sensor.serial
      drift_ppm:number <~ @sensor.drift_ppm
      ambient_c:number <~ @sensor.ambient_c

      # ── arithmetic, with precedence ────────────────────────────────────
      # `*` and `/` bind tighter than `+` and `-`, which bind tighter than
      # the comparisons, which bind tighter than `&`, which binds tighter
      # than `|`. Nesting is free; parentheses around a COMPLETE right-hand
      # side are reserved for egress, so force a different grouping with a
      # named intermediate binding instead.
      compensated:number = drift_ppm - ambient_c * 2
      halved:number      = compensated / 2
      remainder:number   = drift_ppm % 10

      # ── transform chains ───────────────────────────────────────────────
      # number, str, bool and arr each carry their own method set. A chain
      # is a valid operand anywhere an operand is: standalone, as a call
      # argument, and on either side of an infix.
      magnitude:number = drift_ppm.abs()
      floored:number   = halved.floor()
      rounded:number   = halved.round()
      ceiling:number   = halved.ceil()
      inverted:number  = compensated.negate()

      reading_count:number = raw_readings.length()
      label_count:number   = labels.length()
      no_flags:bool        = flags.isEmpty()

      serial_len:number  = serial.length()
      serial_tag:str     = serial.trim().toUpperCase()
      serial_number:number = serial.toNumber()

      # ── binary functions ───────────────────────────────────────────────
      # A call argument is a reference, a literal, or a transform chain —
      # an infix expression inside one does not parse, so bind it first.
      capped:number  = min(magnitude, 500)
      floored_at:number = max(capped, 0)
      spread:number  = max(reading_count, label_count)

      # ── string functions ───────────────────────────────────────────────
      has_prefix:bool = str_starts(serial_tag, "CAL")
      has_suffix:bool = str_ends(serial_tag, "-B")
      mentions_rev:bool = str_includes(serial_tag, "REV")

      # ── array functions ────────────────────────────────────────────────
      first_reading:number = arr_get(raw_readings, 0)
      has_zero:bool = arr_includes(raw_readings, 0)
      all_labels:arr<str> = arr_concat(labels, labels)
      all_label_count:number = all_labels.length()

      # ── boolean algebra ────────────────────────────────────────────────
      exactly_one_marker:bool = bool_xor(has_prefix, has_suffix)

      # ── pipe with the #it placeholder ──────────────────────────────────
      # Each step feeds the previous result in wherever `#it` appears.
      normalized:number = pipe(
        first_reading,
        max(#it, 0),
        min(#it, 1000)
      )

      # ── if and case ────────────────────────────────────────────────────
      # A tuple subject with tuple patterns. Note that a binder name may not
      # repeat across arms of one case, so a multi-threshold classification
      # is written by hoisting each threshold into its own bool.
      severe_level:bool   = capped >= 400
      elevated_level:bool = capped >= 150

      band:str = case(
        (severe_level, elevated_level),
        (true, _) => "severe",
        (_, true) => "elevated",
        _ => "nominal"
      )

      # A scalar subject with a guarded binder arm — legal with one binder.
      array_note:str = case(
        reading_count,
        n if n >= 8 => "full array",
        _ => "partial array"
      )

      label_note:str = if(no_flags, "clean", "flagged")

      # ── outputs ────────────────────────────────────────────────────────
      (band) ~> @calibration.band
      (floored_at) ~> @calibration.score
      (serial_tag + " " + label_note + " " + array_note) ~> @calibration.report

      # A checksum folding the numeric features together, one long nested
      # infix expression.
      checksum:number = floored + rounded + ceiling + inverted + remainder + normalized + spread + all_label_count + serial_len + serial_number
      (checksum) ~> @calibration.checksum

      # ── the result binding, declared last ──────────────────────────────
      in_tolerance:bool = capped < 150 & has_zero == false

      within:bool := (in_tolerance & exactly_one_marker == false | mentions_rev) ~> @calibration.within_tolerance
    }

    # all-match: BOTH of these are evaluated, and both fire when true.
    next {
      compute "to_report" {
        band:str <~ action(band)
        nominal:str <~ "nominal"
        go:bool := band != nominal
      }
      action = file_report
    }

    next {
      compute "to_service" {
        score:number <~ action(floored_at)
        service_floor:number <~ 400
        go:bool := score >= service_floor
      }
      action = schedule_service
    }
  }

  action "file_report" {
    """
    Terminal: write the calibration record.
    """
    compute "file_report_graph" {
      band:str <~ @calibration.band
      score:number <~ @calibration.score

      line:str = band + " @ " + score.toStr()

      logged:bool := (true) ~> @calibration.logged

      # NOTE: `line` is consumed by the egress below via the report field.
    }
    merge {
      line { to_state = calibration.report }
    }
  }

  action "schedule_service" {
    """
    Terminal: the array has drifted far enough to need a technician.
    """
    compute "schedule_service_graph" {
      serial:str <~ @sensor.serial

      (serial + " queued for service") ~> @calibration.report

      needs_service:bool := (true) ~> @calibration.needs_service
    }
  }
}
