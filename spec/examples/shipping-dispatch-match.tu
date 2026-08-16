# ===========================================================================
# Transition match blocks: a shipping dispatch router.
#
# This example is built around `next on (...) match { }` (scene-graph.md
# §5.0.1), the transition form for a decision made over VALUES rather than one
# boolean flag per branch.
#
# Without it, `classify_parcel` below would have to compute one flag per lane
# — go_air, go_ground, go_white_glove, go_hold — every one of them existing
# only to be named by a transition, and none of them showing that the four
# branches partition a single (zone, weight_band, fragile) decision.
#
# The form is surface sugar. Each arm expands to exactly the `next { }` rule it
# abbreviates, so a match block and the rules it stands for emit an identical
# model. The first arm below is spelled out longhand in a comment for
# comparison.
#
# Also shown:
#   * the single-subject form, `next on <subject> match { }`, in `hold_review`
#   * `_` as a whole-arm fallback and as an unconstrained column
#   * `case(...)` deriving a match subject, so the two pattern forms sit side
#     by side — `case` classifies a value, `match` selects an action
# ===========================================================================

state {
  parcel {
    zone:str          = ""
    weight_kg:number  = 0
    fragile:bool      = false
    declared_value:number = 0
  }
  dispatch {
    weight_band:str = ""
    lane:str        = ""
    handling:str    = ""
    manifest:str    = ""
    reviewed:bool   = false
  }
}

# ---------------------------------------------------------------------------
# Scene: dispatch_router
#
# `classify_parcel` reads the parcel, derives a weight band, and dispatches to
# one of four terminal lanes. next_policy is first-match, which a match block
# requires: arm order is what makes the arms mutually exclusive.
# ---------------------------------------------------------------------------

scene "dispatch_router" {
  entry_action = classify_parcel
  next_policy  = "first-match"

  overview strict {
    classify_parcel |=> air_express
    classify_parcel |=> ground_standard
    classify_parcel |=> white_glove
    classify_parcel |=> hold_review
    hold_review |=> ground_standard
    hold_review |=> manual_desk
    air_express
    ground_standard
    white_glove
    manual_desk
  }

  action "classify_parcel" {
    """
    Read the parcel, bucket its weight, and pick a shipping lane from the
    destination zone, that bucket, and whether the contents are fragile.
    """

    compute "classify_parcel_graph" {
      zone:str <~ @parcel.zone
      weight_kg:number <~ @parcel.weight_kg
      fragile:bool <~ @parcel.fragile

      # `case` classifies a value into a band; `match` below selects an action
      # from that band. The two share their pattern syntax — tuple patterns
      # included — and differ in what an arm produces: a value here, a
      # transition there.
      at_least_heavy:bool = weight_kg >= 30
      at_least_medium:bool = weight_kg >= 5

      weight_band:str = case(
        (at_least_heavy, at_least_medium),
        (true, _) => "heavy",
        (_, true) => "medium",
        _ => "light"
      )

      (weight_band) ~> @dispatch.weight_band

      routed:bool := (true) ~> @dispatch.reviewed
    }

    # ── the match block ────────────────────────────────────────────────────
    #
    # Four arms, evaluated in order. A `_` column is not read at all, so the
    # third arm's generated prog ingresses only `fragile`.
    next on (zone, weight_band, fragile) match {
      ("domestic", "light",  false) => air_express,
      ("domestic", "heavy",  false) => ground_standard,
      (_,          _,        true)  => white_glove,
      ("export",   "light",  false) => air_express,
      _ => hold_review
    }

    # For comparison, the first arm above expands to exactly this:
    #
    #   next {
    #     compute "..." {
    #       zone:str
    #       weight_band:str
    #       fragile:bool
    #       go:bool := zone == "domestic" & weight_band == "light" & fragile == false
    #     }
    #     prepare {
    #       zone        { from_action = zone }
    #       weight_band { from_action = weight_band }
    #       fragile     { from_action = fragile }
    #     }
    #     action = air_express
    #   }
    #
    # ...and the `_` arm to the bare `next hold_review`.
  }

  action "air_express" {
    """
    Terminal: small, sturdy parcels fly.
    """
    compute "air_express_graph" {
      band:str <~ @dispatch.weight_band

      ("air_express") ~> @dispatch.lane

      handling:str := ("standard " + band) ~> @dispatch.handling
    }
  }

  action "ground_standard" {
    """
    Terminal: heavy but sturdy parcels go by road.
    """
    compute "ground_standard_graph" {
      ("ground_standard") ~> @dispatch.lane

      handling:str := ("palletized") ~> @dispatch.handling
    }
  }

  action "white_glove" {
    """
    Terminal: anything fragile is handled by the specialist lane, whatever its
    zone or weight. This is the arm whose first two columns are `_`.
    """
    compute "white_glove_graph" {
      ("white_glove") ~> @dispatch.lane

      handling:str := ("hand_carried") ~> @dispatch.handling
    }
  }

  action "hold_review" {
    """
    Nothing matched a known lane. Bounce the parcel to a human unless its
    declared value is low enough to default onto the ground lane.
    """
    compute "hold_review_graph" {
      declared_value:number <~ @parcel.declared_value

      value_band:str = case(
        declared_value,
        v if v >= 1000 => "high",
        _ => "low"
      )

      ("hold_review") ~> @dispatch.lane

      held:bool := (true) ~> @dispatch.reviewed
    }

    # The single-subject form: one subject, and the parentheses are optional on
    # both the subject and the patterns.
    next on value_band match {
      "low" => ground_standard,
      _ => manual_desk
    }
  }

  action "manual_desk" {
    """
    Terminal: a person decides.
    """
    compute "manual_desk_graph" {
      band:str <~ @dispatch.weight_band

      manifest:str := ("manual: " + band) ~> @dispatch.manifest
    }
  }
}
