# ===========================================================================
# 03 — Warehouse pick-pack-ship, across three scenes
#
# One route tying three scenes together. A scene runs until no transition
# matches — that is what "terminal" means — and the route then reads the
# action path the scene just took and decides which scene comes next.
#
# STATE is global to the route: it is not reset at a scene boundary, so the
# scene entered next starts from exactly the STATE its predecessor left.
#
# Covers: multi-scene files, the `route` block, and every route path form —
# a direct two-segment path, a single-wildcard path, a multi-segment suffix,
# OR-joined branches sharing one target, and the `_` fallback.
# ===========================================================================

state {
  order {
    line_count:number = 0
    priority:bool = false
    address_valid:bool = false
  }
  pick {
    picked_count:number = 0
    short_picked:bool = false
    tote_id:str = ""
  }
  pack {
    carton:str = ""
    weight_kg:number = 0
    sealed:bool = false
  }
  ship {
    carrier:str = ""
    label:str = ""
    status:str = ""
  }
}

# ---------------------------------------------------------------------------
# Scene 1: picking
# ---------------------------------------------------------------------------

scene "picking" {
  entry_action = start_pick
  next_policy  = "first-match"

  overview at_least {
    start_pick |=> pick_complete
    start_pick |=> pick_short
  }

  action "start_pick" {
    """
    Walk the pick list and count what actually came off the shelf.
    """
    compute "start_pick_graph" {
      line_count:number <~ @order.line_count
      picked_count:number <~ @pick.picked_count

      complete:bool = picked_count >= line_count

      ("TOTE-A") ~> @pick.tote_id

      short:bool := (complete.not()) ~> @pick.short_picked
    }

    next short -> pick_short
    next pick_complete
  }

  action "pick_complete" {
    """
    Terminal for this scene: everything on the list is in the tote. The route
    sends this path onward to packing.
    """
    compute "pick_complete_graph" {
      tote_id:str <~ @pick.tote_id

      status:str := ("picked " + tote_id) ~> @ship.status
    }
  }

  action "pick_short" {
    """
    Terminal for this scene: the tote is short. The route diverts this path.
    """
    compute "pick_short_graph" {
      picked_count:number <~ @pick.picked_count

      status:str := ("short by count " + picked_count.toStr()) ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 2: packing
# ---------------------------------------------------------------------------

scene "packing" {
  entry_action = choose_carton
  next_policy  = "first-match"

  overview nodes_only {
    choose_carton |=> seal_carton
    seal_carton
  }

  action "choose_carton" {
    """
    Pick a carton size from the line count.
    """
    compute "choose_carton_graph" {
      line_count:number <~ @order.line_count

      large:bool = line_count >= 10

      carton:str = if(large, "L", "S")

      (carton) ~> @pack.carton

      weight:number := (line_count * 2) ~> @pack.weight_kg
    }

    next seal_carton
  }

  action "seal_carton" {
    """
    Terminal for this scene: tape it shut.
    """
    compute "seal_carton_graph" {
      carton:str <~ @pack.carton

      (true) ~> @pack.sealed

      status:str := ("packed in " + carton) ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 3: shipping
# ---------------------------------------------------------------------------

scene "shipping" {
  entry_action = select_carrier
  next_policy  = "first-match"

  action "select_carrier" {
    """
    Choose a carrier from priority and parcel weight.
    """
    compute "select_carrier_graph" {
      priority:bool <~ @order.priority
      weight_kg:number <~ @pack.weight_kg

      heavy:bool = weight_kg >= 20

      carrier:str = case(
        (priority, heavy),
        (true, _)  => "air",
        (_, true)  => "freight",
        _ => "ground"
      )

      (carrier) ~> @ship.carrier

      ready:bool := (true) ~> @pack.sealed
    }

    next on (carrier) match {
      "air" => print_express_label,
      _ => print_standard_label
    }
  }

  action "print_express_label" {
    """
    Terminal: express label, ready for the priority sort.
    """
    compute "express_label_graph" {
      carrier:str <~ @ship.carrier

      ("EXP-" + carrier.toUpperCase()) ~> @ship.label

      status:str := ("labelled express") ~> @ship.status
    }
  }

  action "print_standard_label" {
    """
    Terminal: standard label.
    """
    compute "standard_label_graph" {
      carrier:str <~ @ship.carrier

      ("STD-" + carrier.toUpperCase()) ~> @ship.label

      status:str := ("labelled standard") ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 4: handoff
# ---------------------------------------------------------------------------

scene "handoff" {
  entry_action = release_to_carrier
  next_policy  = "first-match"

  action "release_to_carrier" {
    """
    Terminal for the whole route: the parcel leaves the building.
    """
    compute "release_graph" {
      label:str <~ @ship.label

      status:str := ("released " + label) ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# The route
#
# Each arm matches the action path the just-terminated scene took. The last
# segment is always a concrete action id — a bare `scene.*` is rejected,
# because the runtime would have no way to know when to fire it.
#
# A route COMPLETES when no arm matches. That is why there is no `_` arm here:
# `_` matches unconditionally, so a route carrying one never finishes on its
# own and runs until the transition cap. Ending a route means leaving its last
# scene unmatched — here, nothing matches a terminated `handoff`.
# ---------------------------------------------------------------------------

route "fulfilment" {
  entry = picking

  match {
    # direct two-segment path: the scene's block is exactly this one action
    picking.pick_short => shipping,

    # single wildcard: any number of actions, ending at this one
    picking.*.pick_complete => packing,

    # multi-segment suffix: the block ends with this action sequence
    packing.*.choose_carton.seal_carton => shipping,

    # OR-joined branches sharing one target; every branch must share the
    # same `=>` scene
    shipping.*.print_express_label |
    shipping.*.print_standard_label
      => handoff
  }
}
